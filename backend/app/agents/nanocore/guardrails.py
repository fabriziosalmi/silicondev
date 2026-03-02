"""Loop guardrails for the NanoCore agent.

Prevents runaway loops by tracking token budgets, detecting repeated
errors, and injecting course-correction prompts when the agent is stuck.
"""

import hashlib
import logging
from dataclasses import dataclass, field

logger = logging.getLogger(__name__)

# Number of consecutive identical errors before intervention
MAX_CONSECUTIVE_SAME_ERROR = 3
# Max fix attempts per file before escalating
MAX_FIX_ATTEMPTS_PER_TARGET = 3


@dataclass
class LoopGuardrails:
    """Track token budget and detect error loops."""

    max_total_tokens: int = 50_000
    total_tokens: int = 0

    # Error tracking
    _error_hashes: list[str] = field(default_factory=list)
    _consecutive_same: int = 0
    _last_error_hash: str = ""

    # Per-file fix tracking
    _fix_attempts: dict[str, int] = field(default_factory=dict)

    def add_tokens(self, count: int) -> None:
        self.total_tokens += count

    def is_over_budget(self) -> bool:
        return self.total_tokens >= self.max_total_tokens

    def budget_fraction(self) -> float:
        """Returns 0.0 to 1.0 indicating how much budget has been used."""
        if self.max_total_tokens <= 0:
            return 1.0
        return min(1.0, self.total_tokens / self.max_total_tokens)

    def tokens_remaining(self) -> int:
        return max(0, self.max_total_tokens - self.total_tokens)

    def record_error(self, text: str) -> None:
        """Record an error for loop detection. Hash first 200 chars."""
        h = hashlib.md5(text[:200].encode()).hexdigest()[:12]
        self._error_hashes.append(h)

        if h == self._last_error_hash:
            self._consecutive_same += 1
        else:
            self._consecutive_same = 1
            self._last_error_hash = h

    def is_stuck_on_same_error(self) -> bool:
        return self._consecutive_same >= MAX_CONSECUTIVE_SAME_ERROR

    def rubber_duck_message(self) -> str:
        """Prompt injection to break the agent out of an error loop."""
        return (
            "[SYSTEM] You have hit the same error "
            f"{self._consecutive_same} times in a row. "
            "Stop and reconsider your approach:\n"
            "1. Re-read the error message carefully.\n"
            "2. Check if you are editing the right file.\n"
            "3. Try a completely different strategy.\n"
            "4. If stuck, explain the problem to the user and ask for help."
        )

    def record_fix_attempt(self, target: str) -> None:
        """Record a fix attempt for a specific file/target."""
        self._fix_attempts[target] = self._fix_attempts.get(target, 0) + 1

    def is_over_fix_limit(self, target: str) -> bool:
        return self._fix_attempts.get(target, 0) >= MAX_FIX_ATTEMPTS_PER_TARGET

    def fix_limit_message(self, target: str) -> str:
        count = self._fix_attempts.get(target, 0)
        return (
            f"[SYSTEM] You have tried to fix {target} {count} times. "
            "Stop retrying and ask the user for guidance."
        )

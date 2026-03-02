"""Context window management for NanoCore.

Keeps the conversation within the model's context limit by
summarizing older messages while preserving the system prompt
and recent turns.
"""

import logging

logger = logging.getLogger(__name__)

# Messages to always keep in full (first = system, last N = recent turns)
KEEP_TAIL_COUNT = 4


def count_tokens(text: str) -> int:
    """Estimate token count. Uses the active tokenizer if available,
    otherwise falls back to len/4 (rough average for English text)."""
    try:
        from app.api.engine import service
        if service.active_tokenizer:
            return len(service.active_tokenizer.encode(text))
    except Exception:
        pass
    return len(text) // 4


def _message_tokens(msg: dict) -> int:
    """Token count for a single message dict."""
    return count_tokens(msg.get("content", ""))


def _summarize_assistant(content: str) -> str:
    """Compress an assistant message to its first 200 chars."""
    if len(content) <= 200:
        return content
    return content[:200] + "..."


def _summarize_tool_result(content: str) -> str:
    """Compress a tool result message to just outcome lines."""
    lines = content.splitlines()
    outcome_lines = []
    for line in lines:
        stripped = line.strip()
        # Keep lines that look like results/summaries
        if stripped.startswith("[") or stripped.startswith("Applied") or stripped.startswith("Error"):
            outcome_lines.append(stripped)
    if outcome_lines:
        return "\n".join(outcome_lines)
    # Fallback: first 100 chars
    return content[:100] + "..." if len(content) > 100 else content


class ContextManager:
    """Fit a message list within a token budget.

    Strategy:
    1. Always keep messages[0] (system prompt) in full.
    2. Always keep the last KEEP_TAIL_COUNT messages in full.
    3. Summarize middle messages (assistant -> first 200 chars,
       tool results -> outcome lines only).
    4. If still over budget, drop oldest middle messages.
    5. Insert a marker showing how many messages were compressed.
    """

    def __init__(self, max_context_tokens: int = 6000):
        self.max_context_tokens = max_context_tokens

    def fit_messages(self, messages: list[dict]) -> list[dict]:
        """Return a new list of messages that fits within the token budget.

        Does not mutate the input list.
        """
        if len(messages) <= KEEP_TAIL_COUNT + 1:
            return list(messages)

        total = sum(_message_tokens(m) for m in messages)
        if total <= self.max_context_tokens:
            return list(messages)

        # Split into head (system), middle, tail
        head = [messages[0]]
        tail = messages[-KEEP_TAIL_COUNT:]
        middle = messages[1:-KEEP_TAIL_COUNT]

        # Phase 1: summarize middle messages
        summarized_middle = []
        for msg in middle:
            role = msg.get("role", "")
            content = msg.get("content", "")
            if role == "assistant":
                summarized_middle.append({"role": role, "content": _summarize_assistant(content)})
            elif role == "user" and content.startswith("Tool results:"):
                summarized_middle.append({"role": role, "content": _summarize_tool_result(content)})
            else:
                summarized_middle.append(dict(msg))

        # Check if it fits now
        result = head + summarized_middle + tail
        total = sum(_message_tokens(m) for m in result)
        if total <= self.max_context_tokens:
            return result

        # Phase 2: drop oldest middle messages until it fits
        dropped = 0
        while summarized_middle and total > self.max_context_tokens:
            removed = summarized_middle.pop(0)
            total -= _message_tokens(removed)
            dropped += 1

        # Build final list with compression marker
        marker = {"role": "user", "content": f"[{dropped} earlier messages compressed]"}
        if summarized_middle:
            result = head + [marker] + summarized_middle + tail
        else:
            result = head + [marker] + tail

        return result

"""Context window management for NanoCore.

Keeps the conversation within the model's context limit by
summarizing older messages while preserving the system prompt
and recent turns.
"""

import logging

logger = logging.getLogger(__name__)

# Messages to always keep in full (first = system, last N = recent turns)
KEEP_TAIL_COUNT = 8
DEFAULT_MAX_CONTEXT = 16384


def count_tokens(text: str) -> int:
    """Estimate token count. Uses the active tokenizer if available,
    otherwise falls back to len/4 (rough average for English text)."""
    try:
        from app.engine import service
        if hasattr(service, "active_tokenizer") and service.active_tokenizer:
            return len(service.active_tokenizer.encode(text))
    except Exception:
        pass
    return len(text) // 4


def _message_tokens(msg: dict) -> int:
    """Token count for a single message dict."""
    return count_tokens(msg.get("content", ""))


def _summarize_assistant(content: str) -> str:
    """Compress an assistant message, keeping plan/reasoning and conclusion."""
    if len(content) <= 800:
        return content
    return content[:400] + "\n[...compressed...]\n" + content[-300:]


def _summarize_tool_result(content: str) -> str:
    """Compress a tool result, keeping errors and key outcomes."""
    lines = content.splitlines()
    outcome_lines = []
    for line in lines:
        s = line.strip()
        if s.startswith("[") or s.startswith("Applied") or s.startswith("Error") \
                or s.startswith("Traceback") or s.startswith("File ") \
                or "error" in s.lower()[:20] or "success" in s.lower()[:20]:
            outcome_lines.append(s)
    if outcome_lines:
        return "\n".join(outcome_lines[:30])
    if len(content) > 500:
        return content[:250] + "\n[...]\n" + content[-250:]
    return content


class ContextManager:
    """Fit a message list within a token budget."""

    def __init__(self, max_context_tokens: int = DEFAULT_MAX_CONTEXT):
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
        marker = {"role": "user", "content": f"[{dropped} earlier messages compressed for context optimization]"}
        if summarized_middle:
            result = head + [marker] + summarized_middle + tail
        else:
            result = head + [marker] + tail

        return result


class HierarchicalContextManager(ContextManager):
    """Next-gen Context Manager for NanoCore.
    
    Organizes context into tiers to maximize Prefix Caching hits:
    Tier 0: System Prompt (Static)
    Tier 1: Repository Map / Long-term project rules (Semi-static)
    Tier 2: Historical turns (Compressed/Summarized)
    Tier 3: Current task context and user input (Dynamic)
    """
    
    def __init__(self, max_context_tokens: int = DEFAULT_MAX_CONTEXT):
        super().__init__(max_context_tokens)

    def fit_messages(self, messages: list[dict]) -> list[dict]:
        """Implements hierarchical stitching for prefix caching."""
        if not messages:
            return []
            
        # 1. Identify System (Tier 0)
        system_msg = messages[0] if messages[0].get("role") == "system" else None
        
        # 2. Identify Repo Map (Tier 1) - usually the first user message or a specific tag
        repo_map = None
        start_idx = 1 if system_msg else 0
        if len(messages) > start_idx:
            msg = messages[start_idx]
            content = msg.get("content", "")
            if msg.get("role") == "user" and ("Repository Structure" in content or "Repo Map" in content):
                repo_map = msg
                start_idx += 1

        # 3. Identify Recent Turns (Tier 3)
        tail_count = min(KEEP_TAIL_COUNT, len(messages) - start_idx)
        tail = messages[-tail_count:] if tail_count > 0 else []
        
        # 4. Middle ground (Tier 2)
        middle = messages[start_idx:-tail_count] if len(messages) > start_idx + tail_count else []
        
        # Construct stitched sequence
        head_tier = []
        if system_msg: head_tier.append(system_msg)
        if repo_map: head_tier.append(repo_map)
        
        # Summarize Tier 2 messages
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
                
        # Final stitching with token limit check
        result = head_tier + summarized_middle + tail
        total = sum(_message_tokens(m) for m in result)
        
        # If still over budget, prune Tier 2 (middle)
        dropped_middle = 0
        while summarized_middle and total > self.max_context_tokens:
            removed = summarized_middle.pop(0)
            total -= _message_tokens(removed)
            dropped_middle += 1
            
        if dropped_middle > 0:
            marker = {"role": "user", "content": f"[... {dropped_middle} Tier 2 messages pruned for prefix efficiency ...]"}
            result = head_tier + [marker] + summarized_middle + tail

        # If STILL over budget, we must prune Tier 3 (tail) - keeping at least the last 2 turns
        while len(tail) > 2 and total > self.max_context_tokens:
            removed = tail.pop(0)
            total -= _message_tokens(removed)
            
        return result

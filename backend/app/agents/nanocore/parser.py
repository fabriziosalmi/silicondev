"""Parser for XML-style tool calls in model output."""

import re
from dataclasses import dataclass, field


@dataclass
class ParsedToolCall:
    name: str
    args: dict = field(default_factory=dict)
    raw: str = ""


# Match a complete <tool name="...">...</tool> block
_TOOL_RE = re.compile(
    r'<tool\s+name="([^"]+)">(.*?)</tool>',
    re.DOTALL,
)

# Match <arg name="...">...</arg> inside a tool block
_ARG_RE = re.compile(
    r'<arg\s+name="([^"]+)">(.*?)</arg>',
    re.DOTALL,
)

# Stray/orphaned XML tag fragments to clean from streamed text
_STRAY_TAGS_RE = re.compile(r'</?(?:tool|arg)\b[^>]*>', re.DOTALL)

# The prefix we're watching for during streaming
_TOOL_TAG_START = "<tool "


def _unescape_arg(value: str) -> str:
    """Unescape literal \\n, \\t, \\\\  that small models emit inside arg tags."""
    # Only unescape if value contains literal backslash-n sequences but no actual newlines
    # (i.e. the model wrote "\\n" instead of a real newline)
    if "\\n" in value and "\n" not in value:
        value = value.replace("\\n", "\n")
    if "\\t" in value and "\t" not in value:
        value = value.replace("\\t", "\t")
    value = value.replace("\\\\", "\\")
    return value


def extract_tool_calls(text: str) -> list[ParsedToolCall]:
    """Extract all complete tool calls from text.

    Returns a list of ParsedToolCall with name, args dict, and raw matched string.
    """
    results = []
    for match in _TOOL_RE.finditer(text):
        tool_name = match.group(1)
        body = match.group(2)
        args = {}
        for arg_match in _ARG_RE.finditer(body):
            arg_name = arg_match.group(1)
            arg_value = _unescape_arg(arg_match.group(2).strip())
            args[arg_name] = arg_value
        results.append(ParsedToolCall(name=tool_name, args=args, raw=match.group(0)))
    return results


def has_partial_tool_tag(text: str) -> bool:
    """Check if text ends with a partial or incomplete tool tag.

    Detects both:
    - A fully opened but unclosed <tool name="...">...  (missing </tool>)
    - A prefix being typed: <, <t, <to, <too, <tool  (before the tag is formed)
    """
    tail = text[-500:] if len(text) > 500 else text

    # Check for an opening <tool that hasn't been closed yet
    last_open = tail.rfind("<tool ")
    if last_open != -1:
        after_open = tail[last_open:]
        if "</tool>" not in after_open:
            return True

    # Check if the text ends with a prefix of "<tool " being built up
    # (e.g. "<", "<t", "<to", "<too", "<tool")
    for length in range(1, len(_TOOL_TAG_START) + 1):
        if tail.endswith(_TOOL_TAG_START[:length]):
            return True

    return False


def strip_tool_calls(text: str, *, strip_whitespace: bool = False) -> str:
    """Remove all complete tool call blocks from text, leaving surrounding prose.

    By default preserves leading/trailing whitespace so that streamed tokens
    keep their inter-word spaces. Pass strip_whitespace=True for final output.
    """
    cleaned = _TOOL_RE.sub("", text)
    # Also remove any orphaned <tool>, </tool>, <arg>, </arg> fragments
    cleaned = _STRAY_TAGS_RE.sub("", cleaned)
    return cleaned.strip() if strip_whitespace else cleaned

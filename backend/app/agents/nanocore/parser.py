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


# Shell command prefixes that small models sometimes emit as tool args
_SHELL_CMD_RE = re.compile(r'^\s*\$\s+\w+')  # e.g. "$ cat /path/to/file"
_SHELL_PIPE_RE = re.compile(r'^\s*(?:cat|echo|head|tail|sed|awk|grep|curl|wget)\s+', re.IGNORECASE)


def sanitize_path_arg(value: str) -> tuple[str, str | None]:
    """Validate a path argument from a tool call.

    Returns (cleaned_path, error). If error is not None, the path is invalid.
    """
    stripped = value.strip()
    if not stripped:
        return "", "Empty file path. You must provide the full path to the file."
    # Detect shell commands used as path (e.g. "$ cat /path/to/file")
    if _SHELL_CMD_RE.match(stripped) or _SHELL_PIPE_RE.match(stripped):
        return "", (
            f"Invalid path: '{stripped[:80]}' looks like a shell command. "
            "Provide just the file path, e.g. /path/to/file.py"
        )
    return stripped, None


def sanitize_patch_args(args: dict) -> str | None:
    """Validate patch_file args. Returns error string or None if valid."""
    search = args.get("search", "")
    replace = args.get("replace", "")
    # Detect shell commands stuffed into search/replace
    for label, val in [("search", search), ("replace", replace)]:
        if _SHELL_CMD_RE.match(val.strip()) and "\n" not in val.strip():
            return (
                f"Invalid {label} arg: '{val.strip()[:80]}' looks like a shell command. "
                "The search arg must contain the exact code text to find in the file, "
                "and replace must contain the new code text."
            )
    return None


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

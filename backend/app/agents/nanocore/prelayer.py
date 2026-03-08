"""Pre-LLM intelligence layer — processes the prompt before the model sees it.

Extracts structured information, pre-reads files, classifies intent,
and adjusts agent parameters to reduce wasted iterations.
"""

import os
import re
import logging

logger = logging.getLogger(__name__)

# --- File path extraction ---

# Match absolute paths like /Users/fab/project/main.py or ~/project/main.py
_ABS_PATH_RE = re.compile(r'(?:^|\s|[`"\'])(/[\w./-]+\.[\w]+)')
_HOME_PATH_RE = re.compile(r'(?:^|\s|[`"\'])(~/[\w./-]+\.[\w]+)')
# Match relative paths like src/main.py, ./utils.py
_REL_PATH_RE = re.compile(r'(?:^|\s|[`"\'])(\.{0,2}/[\w./-]+\.[\w]+)')
# Match bare filenames with extensions mentioned in prompts
_BARE_FILE_RE = re.compile(r'\b([\w-]+\.(?:py|js|ts|tsx|jsx|rs|go|c|cpp|h|hpp|java|rb|sh|yaml|yml|toml|json|md|txt|css|html|sql))\b')
# Match "line N" or ":N" references
_LINE_REF_RE = re.compile(r'(?:line\s+|:)(\d+)')


def extract_file_paths(prompt: str, workspace_dir: str) -> list[str]:
    """Extract file paths mentioned in the user's prompt.

    Returns a list of resolved absolute paths that actually exist on disk.
    """
    candidates: set[str] = set()

    # Absolute paths
    for m in _ABS_PATH_RE.finditer(prompt):
        candidates.add(m.group(1))

    # Home-relative paths
    for m in _HOME_PATH_RE.finditer(prompt):
        candidates.add(os.path.expanduser(m.group(1)))

    # Relative paths (resolve against workspace)
    for m in _REL_PATH_RE.finditer(prompt):
        candidates.add(os.path.join(workspace_dir, m.group(1)))

    # Bare filenames — search in workspace
    for m in _BARE_FILE_RE.finditer(prompt):
        bare = m.group(1)
        # Don't treat common words as filenames
        if bare in ("README.md", "package.json", "setup.py", "main.py"):
            full = os.path.join(workspace_dir, bare)
            if os.path.isfile(full):
                candidates.add(full)
        else:
            # Search up to 3 levels deep
            for root, _dirs, files in os.walk(workspace_dir):
                depth = root.replace(workspace_dir, "").count(os.sep)
                if depth > 3:
                    continue
                if bare in files:
                    candidates.add(os.path.join(root, bare))
                    break

    # Filter to only existing files
    existing = []
    for p in candidates:
        resolved = os.path.realpath(p)
        if os.path.isfile(resolved):
            existing.append(resolved)

    return sorted(set(existing))


def pre_read_files(paths: list[str], max_lines: int = 150, max_files: int = 3) -> str:
    """Read file contents for injection into the system prompt.

    Returns formatted context string. Limits total content to avoid
    blowing up the context window.
    """
    if not paths:
        return ""

    sections = []
    for path in paths[:max_files]:
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as f:
                lines = f.readlines()
            total = len(lines)
            content = "".join(lines[:max_lines])
            if total > max_lines:
                content += f"\n[...{total - max_lines} more lines]\n"
            sections.append(f"--- {path} ({total} lines)\n{content}")
        except Exception as e:
            logger.debug(f"Pre-read failed for {path}: {e}")

    if not sections:
        return ""

    return "## Pre-loaded File Context\n\n" + "\n\n".join(sections) + "\n"


# --- Intent classification ---

# Patterns for read-only intents
_REVIEW_INTENTS = re.compile(
    r'^\s*(?:explain|review|check|analyze|describe|what\s+does|how\s+does|show\s+me|read|look\s+at|understand)',
    re.IGNORECASE,
)

# Patterns for simple/quick tasks
_SIMPLE_INTENTS = re.compile(
    r'^\s*(?:fix\s+(?:the\s+)?(?:typo|indent|spacing|import)|rename\s+\w+|remove\s+(?:unused|dead)|add\s+(?:a\s+)?(?:comment|docstring|type\s+hint))',
    re.IGNORECASE,
)

# Patterns for complex tasks
_COMPLEX_INTENTS = re.compile(
    r'(?:refactor|redesign|rewrite|implement|architect|migrate|add\s+(?:a\s+)?(?:feature|system|module|endpoint|api)|create\s+(?:a\s+)?(?:test\s+suite|module|package))',
    re.IGNORECASE,
)


class PromptProfile:
    """Result of analyzing a prompt before sending to the model."""

    def __init__(self):
        self.intent: str = "edit"           # edit, review, create
        self.complexity: str = "normal"     # simple, normal, complex
        self.suggested_mode: str | None = None
        self.suggested_max_iterations: int | None = None
        self.suggested_temperature: float | None = None
        self.extracted_paths: list[str] = []
        self.pre_read_context: str = ""

    def __repr__(self):
        return f"PromptProfile(intent={self.intent}, complexity={self.complexity}, paths={len(self.extracted_paths)})"


def classify_prompt(prompt: str) -> tuple[str, str]:
    """Classify prompt intent and complexity.

    Returns (intent, complexity) where:
    - intent: "review", "edit", or "create"
    - complexity: "simple", "normal", or "complex"
    """
    # Intent
    if _REVIEW_INTENTS.match(prompt):
        intent = "review"
    elif re.match(r'^\s*(?:create|write|make|generate|new|put|add\s+(?:some|a|the|code|content))\b', prompt, re.IGNORECASE):
        intent = "create"
    else:
        intent = "edit"

    # Complexity
    word_count = len(prompt.split())
    if _SIMPLE_INTENTS.match(prompt):
        complexity = "simple"
    elif intent == "create" and word_count < 20:
        # Short creation prompts targeting one file are simple
        complexity = "simple"
    elif _COMPLEX_INTENTS.search(prompt) and word_count >= 3:
        complexity = "complex"
    elif len(prompt) > 300:
        complexity = "complex"
    else:
        complexity = "normal"

    return intent, complexity


def analyze_prompt(prompt: str, workspace_dir: str) -> PromptProfile:
    """Full pre-LLM analysis of a user prompt.

    Extracts file paths, classifies intent/complexity,
    and suggests agent parameters.
    """
    profile = PromptProfile()

    # 1. Classify intent and complexity
    profile.intent, profile.complexity = classify_prompt(prompt)

    # 2. Suggest mode override for review intents
    if profile.intent == "review":
        profile.suggested_mode = "review"

    # 3. Adjust iterations based on complexity
    if profile.complexity == "simple":
        profile.suggested_max_iterations = 3
        profile.suggested_temperature = 0.2
    elif profile.complexity == "complex":
        profile.suggested_max_iterations = 15
        profile.suggested_temperature = 0.4

    # 4. Extract and pre-read file paths
    profile.extracted_paths = extract_file_paths(prompt, workspace_dir)
    if profile.extracted_paths:
        profile.pre_read_context = pre_read_files(profile.extracted_paths)

    logger.info(f"Prompt profile: {profile}")
    return profile

"""Detect project type and suggest a dev server command.

Scans workspace for package.json, pyproject.toml, index.html, etc.
Returns the project type and a command to start a dev server.
"""

import json
import logging
from enum import Enum
from pathlib import Path
from typing import Optional, Tuple

logger = logging.getLogger(__name__)


class ProjectType(str, Enum):
    VITE = "vite"
    NEXTJS = "nextjs"
    CRA = "create-react-app"
    NUXT = "nuxt"
    SVELTE = "svelte"
    ASTRO = "astro"
    FLASK = "flask"
    FASTAPI = "fastapi"
    STATIC = "static"
    UNKNOWN = "unknown"


def detect_project(workspace_dir: str) -> Tuple[ProjectType, Optional[str], Optional[int]]:
    """Detect project type from workspace directory.

    Returns (project_type, start_command, default_port).
    start_command is None if detection fails.
    """
    root = Path(workspace_dir)
    pkg_json = root / "package.json"

    # ── Node.js projects ────────────────────────────────────
    if pkg_json.exists():
        try:
            pkg = json.loads(pkg_json.read_text())
            deps = {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}
            scripts = pkg.get("scripts", {})

            # Check for specific frameworks in order of specificity
            if "next" in deps:
                return ProjectType.NEXTJS, _npm_or_pnpm(root, "dev"), 3000

            if "nuxt" in deps or "@nuxt/core" in deps:
                return ProjectType.NUXT, _npm_or_pnpm(root, "dev"), 3000

            if "@sveltejs/kit" in deps or "svelte" in deps:
                return ProjectType.SVELTE, _npm_or_pnpm(root, "dev"), 5173

            if "astro" in deps:
                return ProjectType.ASTRO, _npm_or_pnpm(root, "dev"), 4321

            if "vite" in deps:
                return ProjectType.VITE, _npm_or_pnpm(root, "dev"), 5173

            if "react-scripts" in deps:
                return ProjectType.CRA, _npm_or_pnpm(root, "start"), 3000

            # Generic: if there's a "dev" script, use it
            if "dev" in scripts:
                return ProjectType.VITE, _npm_or_pnpm(root, "dev"), 3000

            if "start" in scripts:
                return ProjectType.VITE, _npm_or_pnpm(root, "start"), 3000

        except (json.JSONDecodeError, OSError) as e:
            logger.debug("Failed to parse package.json: %s", e)

    # ── Python projects ─────────────────────────────────────
    pyproject = root / "pyproject.toml"
    requirements = root / "requirements.txt"

    if pyproject.exists():
        try:
            content = pyproject.read_text()
            if "fastapi" in content.lower():
                main = _find_python_main(root)
                return ProjectType.FASTAPI, f"python -m uvicorn {main}:app --reload --port 8000", 8000
            if "flask" in content.lower():
                main = _find_python_main(root)
                return ProjectType.FLASK, f"python -m flask --app {main} run --reload --port 5000", 5000
        except OSError:
            pass

    if requirements.exists():
        try:
            content = requirements.read_text().lower()
            if "fastapi" in content:
                main = _find_python_main(root)
                return ProjectType.FASTAPI, f"python -m uvicorn {main}:app --reload --port 8000", 8000
            if "flask" in content:
                main = _find_python_main(root)
                return ProjectType.FLASK, f"python -m flask --app {main} run --reload --port 5000", 5000
        except OSError:
            pass

    # ── Static HTML ─────────────────────────────────────────
    if (root / "index.html").exists():
        return ProjectType.STATIC, f"python3 -m http.server 3000 --directory {workspace_dir}", 3000

    return ProjectType.UNKNOWN, None, None


def _npm_or_pnpm(root: Path, script: str) -> str:
    """Return the right package manager command."""
    if (root / "pnpm-lock.yaml").exists():
        return f"pnpm {script}"
    if (root / "bun.lockb").exists():
        return f"bun run {script}"
    if (root / "yarn.lock").exists():
        return f"yarn {script}"
    return f"npm run {script}"


def _find_python_main(root: Path) -> str:
    """Try to find the main Python module for uvicorn/flask."""
    for candidate in ["main", "app", "server", "api"]:
        if (root / f"{candidate}.py").exists():
            return candidate
    # Check src/ subdirectory
    if (root / "src" / "main.py").exists():
        return "src.main"
    return "main"

"""API endpoints for the code workspace (file tree, read, save)."""

import logging
import os
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()

# Extensions to detect language for Monaco
LANGUAGE_MAP = {
    ".py": "python", ".pyw": "python",
    ".js": "javascript", ".mjs": "javascript", ".cjs": "javascript",
    ".ts": "typescript", ".tsx": "typescriptreact", ".jsx": "javascriptreact",
    ".json": "json", ".jsonl": "json",
    ".html": "html", ".htm": "html",
    ".css": "css", ".scss": "scss", ".less": "less",
    ".md": "markdown", ".mdx": "markdown",
    ".yaml": "yaml", ".yml": "yaml",
    ".toml": "toml",
    ".sh": "shell", ".bash": "shell", ".zsh": "shell",
    ".sql": "sql",
    ".rs": "rust", ".go": "go", ".java": "java",
    ".c": "c", ".cpp": "cpp", ".h": "c", ".hpp": "cpp",
    ".rb": "ruby", ".php": "php", ".swift": "swift",
    ".r": "r", ".R": "r",
    ".xml": "xml", ".svg": "xml",
    ".graphql": "graphql",
    ".dockerfile": "dockerfile",
    ".tf": "hcl",
    ".txt": "plaintext",
    ".csv": "plaintext",
    ".ini": "ini", ".cfg": "ini",
    ".env": "plaintext",
}

# Directories to skip in file tree
SKIP_DIRS = {
    "node_modules", ".git", ".venv", "venv", "__pycache__", ".mypy_cache",
    ".pytest_cache", "dist", "build", ".next", ".nuxt", "coverage",
    ".tox", ".eggs", ".cache", ".turbo",
}

MAX_FILE_SIZE = 2 * 1024 * 1024  # 2 MB


def _detect_language(path: str) -> str:
    ext = Path(path).suffix.lower()
    # Handle Dockerfile without extension
    if Path(path).name.lower() == "dockerfile":
        return "dockerfile"
    if Path(path).name.lower() == "makefile":
        return "makefile"
    return LANGUAGE_MAP.get(ext, "plaintext")


def _validate_path(requested: str, workspace_root: str) -> Path:
    """Resolve and validate that the path is under the workspace root."""
    root = Path(workspace_root).resolve()
    target = Path(requested).resolve()
    if not str(target).startswith(str(root)):
        raise HTTPException(status_code=403, detail="Path is outside workspace root")
    return target


def _build_tree(directory: Path, max_depth: int, current_depth: int = 0) -> dict:
    """Recursively build a file tree dict."""
    node = {
        "name": directory.name,
        "path": str(directory),
        "type": "dir",
    }

    if current_depth >= max_depth:
        return node

    children = []
    try:
        entries = sorted(directory.iterdir(), key=lambda e: (not e.is_dir(), e.name.lower()))
    except PermissionError:
        return node

    for entry in entries:
        if entry.name.startswith(".") and entry.name not in (".env",):
            # Skip hidden files/dirs except .env
            if entry.is_dir():
                continue
        if entry.is_dir():
            if entry.name in SKIP_DIRS:
                continue
            children.append(_build_tree(entry, max_depth, current_depth + 1))
        else:
            children.append({
                "name": entry.name,
                "path": str(entry),
                "type": "file",
            })

    node["children"] = children
    return node


class TreeRequest(BaseModel):
    directory: str = Field(min_length=1, max_length=4096)
    max_depth: int = Field(default=5, ge=1, le=10)


class ReadRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class CreateRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class RenameRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    new_name: str = Field(min_length=1, max_length=255)


class DeleteRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)


class SaveRequest(BaseModel):
    path: str = Field(min_length=1, max_length=4096)
    content: str


@router.post("/tree")
async def get_tree(req: TreeRequest):
    """Return the file tree for a directory."""
    root = Path(req.directory).resolve()
    if not root.is_dir():
        raise HTTPException(status_code=400, detail="Not a directory")
    return _build_tree(root, req.max_depth)


@router.post("/read")
async def read_file(req: ReadRequest):
    """Read a file and return its content with detected language."""
    path = Path(req.path).resolve()
    if not path.is_file():
        raise HTTPException(status_code=404, detail="File not found")
    if path.stat().st_size > MAX_FILE_SIZE:
        raise HTTPException(status_code=413, detail="File too large (>2MB)")

    try:
        content = path.read_text(encoding="utf-8", errors="replace")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot read file: {e}")

    return {
        "content": content,
        "language": _detect_language(req.path),
    }


@router.post("/create")
async def create_file(req: CreateRequest):
    """Create a new empty file. Parent directories are created automatically."""
    path = Path(req.path).resolve()
    if path.exists():
        raise HTTPException(status_code=409, detail="File already exists")
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text("", encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot create file: {e}")
    return {"ok": True, "path": str(path)}


@router.post("/rename")
async def rename_file(req: RenameRequest):
    """Rename a file or directory. new_name is the new filename (not full path)."""
    path = Path(req.path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    new_path = path.parent / req.new_name
    if new_path.exists():
        raise HTTPException(status_code=409, detail="A file with that name already exists")
    try:
        path.rename(new_path)
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot rename: {e}")
    return {"ok": True, "old_path": str(path), "new_path": str(new_path)}


@router.post("/delete")
async def delete_file(req: DeleteRequest):
    """Delete a file or empty directory."""
    path = Path(req.path).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    try:
        if path.is_dir():
            import shutil
            shutil.rmtree(path)
        else:
            path.unlink()
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot delete: {e}")
    return {"ok": True, "path": str(path)}


@router.post("/save")
async def save_file(req: SaveRequest):
    """Save content to a file. The file must already exist (no creating new files via this endpoint)."""
    path = Path(req.path).resolve()

    # Safety: only allow saving to existing files
    if not path.exists():
        raise HTTPException(status_code=404, detail="File does not exist. Use the terminal to create new files.")

    try:
        written = path.write_text(req.content, encoding="utf-8")
    except OSError as e:
        raise HTTPException(status_code=500, detail=f"Cannot save file: {e}")

    return {"ok": True, "bytes": written}

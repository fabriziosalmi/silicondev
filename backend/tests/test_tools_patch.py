"""Tests for apply_patch_content fuzzy matching and error messages."""

import os
import tempfile
import pytest
from app.agents.nanocore.tools import apply_patch_content


@pytest.fixture
def temp_file():
    """Create a temp file in a non-protected directory."""
    test_dir = os.path.join(os.path.expanduser("~"), ".silicon-studio-test")
    os.makedirs(test_dir, exist_ok=True)
    path = os.path.join(test_dir, "test_patch.py")
    with open(path, "w") as f:
        f.write("def hello():\n    print('hello')  \n    return True\n")
    yield path
    os.unlink(path)
    try:
        os.rmdir(test_dir)
    except OSError:
        pass


@pytest.mark.asyncio
async def test_exact_match(temp_file):
    result = await apply_patch_content(temp_file, "print('hello')  ", "print('world')")
    assert result["error"] is None
    assert "print('world')" in result["new"]


@pytest.mark.asyncio
async def test_fuzzy_trailing_whitespace(temp_file):
    """Model sends search without trailing spaces — should still match."""
    result = await apply_patch_content(temp_file, "print('hello')", "print('world')")
    assert result["error"] is None
    assert "print('world')" in result["new"]


@pytest.mark.asyncio
async def test_search_not_found_shows_preview(temp_file):
    result = await apply_patch_content(temp_file, "totally_wrong_text", "replacement")
    assert result["error"] is not None
    assert "read_file" in result["error"]
    assert "def hello():" in result["error"]  # shows file preview


@pytest.mark.asyncio
async def test_empty_path():
    result = await apply_patch_content("", "search", "replace")
    assert result["error"] is not None
    assert "Empty" in result["error"]


@pytest.mark.asyncio
async def test_nonexistent_file():
    path = os.path.join(os.path.expanduser("~"), "nonexistent_abc123.py")
    result = await apply_patch_content(path, "search", "replace")
    assert result["error"] is not None
    assert "not found" in result["error"]

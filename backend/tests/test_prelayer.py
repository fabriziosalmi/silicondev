"""Tests for the pre-LLM intelligence layer."""

import os
import tempfile
from app.agents.nanocore.prelayer import (
    extract_file_paths,
    classify_prompt,
    analyze_prompt,
)


def test_extract_absolute_path():
    with tempfile.NamedTemporaryFile(suffix=".py", delete=False) as f:
        f.write(b"print('hello')")
        path = f.name
    try:
        result = extract_file_paths(f"fix the bug in {path}", "/tmp")
        assert os.path.realpath(path) in result
    finally:
        os.unlink(path)


def test_extract_bare_filename():
    with tempfile.TemporaryDirectory() as d:
        fpath = os.path.join(d, "main.py")
        with open(fpath, "w") as f:
            f.write("print('hello')")
        result = extract_file_paths("fix main.py", d)
        assert os.path.realpath(fpath) in result


def test_extract_no_paths():
    result = extract_file_paths("just fix the bug", "/tmp")
    assert result == []


def test_extract_nonexistent_path():
    result = extract_file_paths("fix /nonexistent/path/foo.py", "/tmp")
    assert result == []


def test_classify_review_intent():
    assert classify_prompt("explain this code")[0] == "review"
    assert classify_prompt("what does this function do")[0] == "review"
    assert classify_prompt("review the changes")[0] == "review"
    assert classify_prompt("check for bugs")[0] == "review"


def test_classify_edit_intent():
    assert classify_prompt("fix the bug in main.py")[0] == "edit"
    assert classify_prompt("add error handling")[0] == "edit"


def test_classify_create_intent():
    assert classify_prompt("create a new test file")[0] == "create"
    assert classify_prompt("write a function that sorts")[0] == "create"


def test_classify_simple_complexity():
    assert classify_prompt("fix the typo in line 5")[1] == "simple"
    assert classify_prompt("rename foo to bar")[1] == "simple"


def test_classify_complex_complexity():
    assert classify_prompt("refactor the authentication system")[1] == "complex"
    assert classify_prompt("implement a caching layer for the API")[1] == "complex"


def test_classify_normal_complexity():
    assert classify_prompt("fix the bug")[1] == "normal"


def test_analyze_prompt_review():
    profile = analyze_prompt("explain how the parser works", "/tmp")
    assert profile.intent == "review"
    assert profile.suggested_mode == "review"


def test_analyze_prompt_simple():
    profile = analyze_prompt("fix the typo", "/tmp")
    assert profile.complexity == "simple"
    assert profile.suggested_max_iterations == 3
    assert profile.suggested_temperature == 0.2


def test_analyze_prompt_complex():
    profile = analyze_prompt("refactor the entire authentication module to use JWT tokens", "/tmp")
    assert profile.complexity == "complex"
    assert profile.suggested_max_iterations == 15

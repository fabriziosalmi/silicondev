"""Concurrent write atomicity tests.

Fires 100 concurrent save operations on the same resource
to verify that os.replace prevents JSON corruption.
"""

import pytest
import asyncio
import json
import tempfile
import shutil
from pathlib import Path
from app.conversations.service import ConversationService
from app.notes.service import NotesService


@pytest.fixture
def temp_conversations_dir():
    d = tempfile.mkdtemp(prefix="silicon-test-conv-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def temp_notes_dir():
    d = tempfile.mkdtemp(prefix="silicon-test-notes-")
    yield d
    shutil.rmtree(d, ignore_errors=True)


def test_concurrent_conversation_saves(temp_conversations_dir):
    """100 concurrent saves to the same conversation should not corrupt JSON."""
    svc = ConversationService()
    svc.conversations_dir = Path(temp_conversations_dir)

    # Create the conversation first
    conv = svc.create_conversation(title="Stress Test")
    conv_id = conv["id"]

    # Fire 100 concurrent updates
    import concurrent.futures

    def update_title(i):
        svc.update_conversation(conv_id, title=f"Update-{i}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        futures = [pool.submit(update_title, i) for i in range(100)]
        concurrent.futures.wait(futures)
        # Check no exceptions were raised
        for f in futures:
            f.result()  # re-raises if the task threw

    # File should be valid JSON with one of the titles
    result = svc.get_conversation(conv_id)
    assert result is not None
    assert result["title"].startswith("Update-")

    # Verify the file on disk is valid JSON
    file_path = Path(temp_conversations_dir) / f"{conv_id}.json"
    with open(file_path) as f:
        data = json.load(f)
    assert data["id"] == conv_id
    assert data["title"].startswith("Update-")


def test_concurrent_note_saves(temp_notes_dir):
    """100 concurrent saves to the same note should not corrupt JSON."""
    svc = NotesService()
    svc.notes_dir = Path(temp_notes_dir)

    # Create the note first
    note = svc.create_note(title="Stress Note", content="initial")
    note_id = note["id"]

    import concurrent.futures

    def update_content(i):
        svc.update_note(note_id, content=f"Content version {i}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=20) as pool:
        futures = [pool.submit(update_content, i) for i in range(100)]
        concurrent.futures.wait(futures)
        for f in futures:
            f.result()

    result = svc.get_note(note_id)
    assert result is not None
    assert result["content"].startswith("Content version ")

    # Verify on-disk validity
    file_path = Path(temp_notes_dir) / f"{note_id}.json"
    with open(file_path) as f:
        data = json.load(f)
    assert data["id"] == note_id


def test_no_temp_files_left_after_concurrent_saves(temp_conversations_dir):
    """After concurrent writes, no .tmp files should remain."""
    svc = ConversationService()
    svc.conversations_dir = Path(temp_conversations_dir)

    conv = svc.create_conversation(title="Temp Cleanup Test")
    conv_id = conv["id"]

    import concurrent.futures

    def update(i):
        svc.update_conversation(conv_id, title=f"T-{i}")

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(update, i) for i in range(50)]
        concurrent.futures.wait(futures)

    # No .tmp files should remain
    tmp_files = list(Path(temp_conversations_dir).glob("*.tmp"))
    assert len(tmp_files) == 0, f"Leftover temp files: {tmp_files}"


def test_concurrent_create_and_delete(temp_conversations_dir):
    """Creating and deleting conversations concurrently should not crash."""
    svc = ConversationService()
    svc.conversations_dir = Path(temp_conversations_dir)

    import concurrent.futures

    created_ids = []

    def create_conv(i):
        conv = svc.create_conversation(title=f"Conv-{i}")
        created_ids.append(conv["id"])
        return conv["id"]

    # Create 20 conversations
    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(create_conv, i) for i in range(20)]
        concurrent.futures.wait(futures)
        ids = [f.result() for f in futures]

    # Delete half concurrently
    def delete_conv(conv_id):
        return svc.delete_conversation(conv_id)

    with concurrent.futures.ThreadPoolExecutor(max_workers=10) as pool:
        futures = [pool.submit(delete_conv, cid) for cid in ids[:10]]
        concurrent.futures.wait(futures)

    # Remaining 10 should still be valid
    remaining = [svc.get_conversation(cid) for cid in ids[10:]]
    assert all(r is not None for r in remaining)

    # Deleted ones should be gone
    deleted = [svc.get_conversation(cid) for cid in ids[:10]]
    assert all(d is None for d in deleted)

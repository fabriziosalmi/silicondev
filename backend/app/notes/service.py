import json
import os
import tempfile
import uuid
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

SCHEMA_VERSION = 1


class NotesService:
    def __init__(self):
        self.workspace_dir = Path.home() / ".silicon-studio"
        self.notes_dir = self.workspace_dir / "notes"
        self.notes_dir.mkdir(parents=True, exist_ok=True)

    def list_notes(self) -> List[Dict[str, Any]]:
        """Return all notes sorted by pinned + updated_at desc, without content."""
        results = []
        for path in self.notes_dir.glob("*.json"):
            try:
                with open(path, "r") as f:
                    data = json.load(f)
                results.append({
                    "id": data["id"],
                    "title": data.get("title", "Untitled"),
                    "created_at": data.get("created_at"),
                    "updated_at": data.get("updated_at"),
                    "pinned": data.get("pinned", False),
                    "char_count": len(data.get("content", "")),
                })
            except Exception as e:
                logger.warning(f"Failed to read note {path.name}: {e}")
        results.sort(
            key=lambda n: (n.get("pinned", False), n.get("updated_at", "")),
            reverse=True,
        )
        return results

    def _migrate(self, data: Dict[str, Any]) -> Dict[str, Any]:
        """Migrate note data to current schema. Re-saves if changed."""
        version = data.get("_schema_version", 0)
        if version >= SCHEMA_VERSION:
            return data

        now = datetime.now(timezone.utc).isoformat()
        if version < 1:
            if "id" not in data or not isinstance(data.get("id"), str):
                data["id"] = str(data.get("id", uuid.uuid4()))
            if "pinned" not in data:
                data["pinned"] = False
            if "created_at" not in data:
                data["created_at"] = now
            if "updated_at" not in data:
                data["updated_at"] = now
            if "content" not in data:
                data["content"] = ""
            data["_schema_version"] = 1

        self._save(data)
        logger.info(f"Migrated note {data['id']} to schema v{SCHEMA_VERSION}")
        return data

    def get_note(self, note_id: str) -> Optional[Dict[str, Any]]:
        """Return full note including content."""
        path = self.notes_dir / f"{note_id}.json"
        if not path.exists():
            return None
        try:
            with open(path, "r") as f:
                data = json.load(f)
            return self._migrate(data)
        except Exception as e:
            logger.error(f"Failed to load note {note_id}: {e}")
            return None

    def create_note(self, title: str = "Untitled", content: str = "") -> Dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        note = {
            "_schema_version": SCHEMA_VERSION,
            "id": str(uuid.uuid4()),
            "title": title,
            "content": content,
            "created_at": now,
            "updated_at": now,
            "pinned": False,
        }
        self._save(note)
        return note

    def update_note(self, note_id: str, updates: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """Partial update: title, content, pinned."""
        note = self.get_note(note_id)
        if not note:
            return None
        allowed_keys = {"title", "content", "pinned"}
        for key in allowed_keys:
            if key in updates:
                note[key] = updates[key]
        note["updated_at"] = datetime.now(timezone.utc).isoformat()
        self._save(note)
        return note

    def delete_note(self, note_id: str) -> bool:
        path = self.notes_dir / f"{note_id}.json"
        if path.exists():
            path.unlink()
            return True
        return False

    def _save(self, note: Dict[str, Any]):
        """Atomic write: temp file + os.replace to prevent corruption on crash."""
        path = self.notes_dir / f"{note['id']}.json"
        fd, tmp_path = tempfile.mkstemp(dir=str(self.notes_dir), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(note, f, indent=2)
            os.replace(tmp_path, path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

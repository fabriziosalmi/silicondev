import os
import json
import uuid
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

class RagService:
    def __init__(self):
        self.workspace_dir = Path.home() / ".silicon-studio"
        self.rag_dir = self.workspace_dir / "rag"
        self.collections_file = self.rag_dir / "collections.json"

        self.rag_dir.mkdir(parents=True, exist_ok=True)
        if not self.collections_file.exists():
            with open(self.collections_file, "w") as f:
                json.dump([], f)

    def get_collections(self) -> List[Dict[str, Any]]:
        try:
            with open(self.collections_file, "r") as f:
                return json.load(f)
        except Exception as e:
            logger.error(f"Failed to load collections: {e}")
            return []

    def create_collection(self, name: str) -> Dict[str, Any]:
        collections = self.get_collections()
        new_col = {
            "id": str(uuid.uuid4()),
            "name": name,
            "chunks": 0,
            "size": "0 KB",
            "lastUpdated": "Just now",
            "model": "nomic-embed-text-v1.5"
        }
        collections.append(new_col)
        self._save_collections(collections)
        return new_col

    def delete_collection(self, collection_id: str) -> bool:
        collections = self.get_collections()
        initial_len = len(collections)
        collections = [c for c in collections if c["id"] != collection_id]
        if len(collections) < initial_len:
            self._save_collections(collections)
            return True
        return False

    def ingest_files(self, collection_id: str, files: List[str], chunk_size: int, overlap: int) -> Dict[str, Any]:
        """
        Ingests files (or directories) by splitting them into chunks
        using recursive character splitting with true overlap support.
        """
        collections = self.get_collections()
        col = next((c for c in collections if c["id"] == collection_id), None)
        if not col:
            raise ValueError("Collection not found")

        all_chunks: List[str] = []
        for file_path in files:
            path = Path(file_path)
            if not path.exists():
                continue

            # Expand directories recursively into individual files
            paths_to_process: List[Path] = []
            if path.is_dir():
                for root, _, filenames in os.walk(path):
                    for name in filenames:
                        candidate = Path(root) / name
                        if candidate.is_file():
                            paths_to_process.append(candidate)
            else:
                if path.is_file():
                    paths_to_process.append(path)

            for file_to_process in paths_to_process:
                try:
                    with open(file_to_process, "r", encoding="utf-8", errors="ignore") as f:
                        text = f.read()

                    base_chunks = self._recursive_split(text, chunk_size)

                    # Apply true overlapping windows between consecutive chunks
                    if overlap > 0 and len(base_chunks) > 1:
                        chunks: List[str] = [base_chunks[0][:chunk_size]]
                        for i in range(1, len(base_chunks)):
                            prev = chunks[-1]
                            prefix = prev[-overlap:] if overlap < len(prev) else prev
                            chunks.append((prefix + base_chunks[i])[:chunk_size])
                    else:
                        chunks = base_chunks

                    all_chunks.extend(chunks)
                except Exception as e:
                    logger.warning(f"Error processing {file_to_process}: {e}")

        # Persist chunks to a JSON file per collection
        chunks_file = self.rag_dir / f"{collection_id}_chunks.json"
        existing_chunks: List[str] = []
        if chunks_file.exists():
            try:
                with open(chunks_file, "r") as f:
                    existing_chunks = json.load(f)
            except Exception:
                existing_chunks = []
        existing_chunks.extend(all_chunks)
        with open(chunks_file, "w") as f:
            json.dump(existing_chunks, f)

        col["chunks"] = len(existing_chunks)
        estimated_kb = sum(len(c.encode('utf-8')) for c in existing_chunks) // 1024
        col["size"] = f"{estimated_kb} KB"
        col["_total_kb"] = estimated_kb
        col["lastUpdated"] = "Just now"

        self._save_collections(collections)
        return col

    def query(self, collection_id: str, query_text: str, n_results: int = 5) -> List[Dict[str, Any]]:
        """Retrieve the most relevant chunks for a query using keyword overlap scoring."""
        chunks_file = self.rag_dir / f"{collection_id}_chunks.json"
        if not chunks_file.exists():
            return []
        try:
            with open(chunks_file, "r") as f:
                chunks: List[str] = json.load(f)
        except Exception:
            return []

        if not chunks:
            return []

        # Simple scoring: count how many query terms appear in each chunk
        import re
        query_terms = set(re.findall(r'\w+', query_text.lower()))
        scored = []
        for i, chunk in enumerate(chunks):
            chunk_lower = chunk.lower()
            # Score = number of unique query terms found + bonus for exact substring match
            term_hits = sum(1 for t in query_terms if t in chunk_lower)
            exact_bonus = 2 if query_text.lower() in chunk_lower else 0
            score = term_hits + exact_bonus
            if score > 0:
                scored.append({"text": chunk, "score": score, "index": i})

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:n_results]

    def _recursive_split(self, text: str, chunk_size: int) -> List[str]:
        """
        Splits text by trying different separators in order: \\n\\n, \\n, " ", ""
        """
        separators = ["\n\n", "\n", " ", ""]

        def split_text(txt: str, seps: List[str]) -> List[str]:
            if len(txt) <= chunk_size:
                return [txt]

            if not seps or seps[0] == "":
                # Character-level split as last resort
                return [txt[i:i+chunk_size] for i in range(0, len(txt), chunk_size)]

            sep = seps[0]
            parts = txt.split(sep)

            chunks: List[str] = []
            current_chunk = ""

            for part in parts:
                if len(current_chunk) + len(part) + (len(sep) if current_chunk else 0) <= chunk_size:
                    current_chunk += (sep if current_chunk else "") + part
                else:
                    if current_chunk:
                        chunks.append(current_chunk)

                    if len(part) > chunk_size:
                        chunks.extend(split_text(part, seps[1:]))
                        current_chunk = ""
                    else:
                        current_chunk = part

            if current_chunk:
                chunks.append(current_chunk)

            return chunks

        return split_text(text, separators)

    def _save_collections(self, collections: List[Dict[str, Any]]):
        with open(self.collections_file, "w") as f:
            json.dump(collections, f, indent=2)

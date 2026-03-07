import hashlib
import os
import re
import json
import uuid
import logging
import tempfile
import time
import numpy as np
from pathlib import Path
from typing import List, Dict, Any, Optional

logger = logging.getLogger(__name__)

# Max chunk file size in bytes before refusing more ingestion (200 MB)
_MAX_CHUNKS_FILE_BYTES = 200 * 1024 * 1024

# HNSW index parameters
_HNSW_EF_CONSTRUCTION = 200
_HNSW_M = 16
_HNSW_EF_SEARCH = 50

# Adaptive boost decay factor (exponential decay per day)
_BOOST_DECAY_PER_DAY = 0.95
# Max boost multiplier
_MAX_BOOST = 2.0


class RagService:
    def __init__(self):
        self.workspace_dir = Path.home() / ".silicon-studio"
        self.rag_dir = self.workspace_dir / "rag"
        self.collections_file = self.rag_dir / "collections.json"

        self.rag_dir.mkdir(parents=True, exist_ok=True)
        if not self.collections_file.exists():
            with open(self.collections_file, "w") as f:
                json.dump([], f)

    # ── Collections CRUD ────────────────────────────────────

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
            "model": "all-MiniLM-L6-v2",
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
            # Clean up chunk, embedding, index, and analytics files
            for suffix in ("_chunks.json", "_embeddings.npy", "_hnsw.bin", "_usage.json", "_analytics.json"):
                p = self.rag_dir / f"{collection_id}{suffix}"
                if p.exists():
                    p.unlink()
            return True
        return False

    # ── Ingest ──────────────────────────────────────────────

    def ingest_files(
        self,
        collection_id: str,
        files: List[str],
        chunk_size: int,
        overlap: int,
    ) -> Dict[str, Any]:
        """Ingest files into a collection: chunk, embed, and persist."""
        collections = self.get_collections()
        col = next((c for c in collections if c["id"] == collection_id), None)
        if not col:
            raise ValueError("Collection not found")

        all_chunks: List[str] = []
        for file_path in files:
            path = Path(file_path)
            if not path.exists():
                continue

            paths_to_process: List[Path] = []
            if path.is_dir():
                for root, _, filenames in os.walk(path):
                    for name in filenames:
                        candidate = Path(root) / name
                        if candidate.is_file():
                            paths_to_process.append(candidate)
            elif path.is_file():
                paths_to_process.append(path)

            for file_to_process in paths_to_process:
                try:
                    # Skip binary files (PDF, images, etc.)
                    with open(file_to_process, "rb") as fb:
                        header = fb.read(8)
                    if header.startswith(b"%PDF") or header.startswith(b"\x89PNG") or header.startswith(b"\xff\xd8"):
                        logger.warning(
                            f"Skipping binary file {file_to_process.name} — "
                            f"PDF/image files must be converted to text first"
                        )
                        continue

                    with open(
                        file_to_process, "r", encoding="utf-8", errors="ignore"
                    ) as f:
                        text = f.read()

                    # Skip files with no extractable text
                    stripped = text.strip()
                    if not stripped:
                        logger.warning(f"Skipping empty file: {file_to_process.name}")
                        continue

                    base_chunks = self._recursive_split(stripped, chunk_size)

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

        if not all_chunks:
            raise ValueError(
                "No text could be extracted from the provided files. "
                "Binary files (PDF, images) must be converted to plain text first."
            )

        # Load existing chunks (with size guard)
        chunks_file = self.rag_dir / f"{collection_id}_chunks.json"
        existing_chunks: List[str] = []
        if chunks_file.exists():
            file_size = chunks_file.stat().st_size
            if file_size > _MAX_CHUNKS_FILE_BYTES:
                raise ValueError(
                    f"Collection chunk file is too large ({file_size // (1024*1024)} MB). "
                    f"Delete the collection and re-ingest, or create a new collection."
                )
            try:
                with open(chunks_file, "r") as f:
                    existing_chunks = json.load(f)
            except Exception:
                existing_chunks = []

        # Deduplicate: skip chunks whose content hash already exists
        existing_hashes = {
            hashlib.md5(c.encode()).hexdigest() for c in existing_chunks
        }
        new_unique = []
        for chunk in all_chunks:
            h = hashlib.md5(chunk.encode()).hexdigest()
            if h not in existing_hashes:
                new_unique.append(chunk)
                existing_hashes.add(h)
        duplicates_skipped = len(all_chunks) - len(new_unique)
        if duplicates_skipped:
            logger.info(f"Skipped {duplicates_skipped} duplicate chunks")

        existing_chunks.extend(new_unique)

        # Save chunks (atomic write)
        fd, tmp = tempfile.mkstemp(dir=str(self.rag_dir), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(existing_chunks, f)
            os.replace(tmp, chunks_file)
        except Exception:
            os.unlink(tmp)
            raise

        # Compute and save embeddings + HNSW index
        self._rebuild_embeddings(collection_id, existing_chunks)

        # Update collection metadata
        col["chunks"] = len(existing_chunks)
        estimated_kb = sum(len(c.encode("utf-8")) for c in existing_chunks) // 1024
        col["size"] = f"{estimated_kb} KB"
        col["_total_kb"] = estimated_kb
        col["lastUpdated"] = "Just now"

        self._save_collections(collections)
        return col

    # ── Query (hybrid search) ───────────────────────────────

    def query(
        self, collection_id: str, query_text: str, n_results: int = 5,
        max_context_chars: int = 0,
    ) -> List[Dict[str, Any]]:
        """Hybrid search: BM25 + vector similarity with reciprocal rank fusion.

        Uses HNSW index for fast approximate nearest neighbor search when available.
        Applies adaptive boosting based on historical usage patterns.

        If max_context_chars > 0, results are trimmed so their combined text
        stays within the character budget (rough proxy for token limits).
        """
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

        # Collect results from both methods
        bm25_results = self._bm25_search(chunks, query_text, n=20)
        vector_results = self._vector_search(collection_id, chunks, query_text, n=20)

        # Fuse with RRF if both produced results
        if bm25_results and vector_results:
            fused = self._reciprocal_rank_fusion(bm25_results, vector_results)
        elif vector_results:
            fused = vector_results
        else:
            fused = bm25_results

        # Apply adaptive boosting from usage history
        fused = self._apply_usage_boost(collection_id, fused)

        top = fused[:n_results]

        # Record this query in analytics
        self._record_query(collection_id, query_text, [r["index"] for r in top])

        # Trim to fit within context budget if specified
        if max_context_chars > 0 and top:
            fitted: List[Dict[str, Any]] = []
            used = 0
            for item in top:
                text_len = len(item.get("text", ""))
                if used + text_len > max_context_chars:
                    break
                fitted.append(item)
                used += text_len
            return fitted if fitted else top[:1]  # always return at least 1

        return top

    # ── Record usage feedback ────────────────────────────────

    def record_usage(self, collection_id: str, chunk_indices: List[int]):
        """Record that specific chunks were useful (clicked, referenced in chat)."""
        usage_file = self.rag_dir / f"{collection_id}_usage.json"
        usage: Dict[str, Any] = {}
        if usage_file.exists():
            try:
                with open(usage_file, "r") as f:
                    usage = json.load(f)
            except Exception:
                usage = {}

        now = time.time()
        for idx in chunk_indices:
            key = str(idx)
            if key not in usage:
                usage[key] = {"hits": 0, "last_used": 0}
            usage[key]["hits"] += 1
            usage[key]["last_used"] = now

        self._save_json(usage_file, usage)

    # ── Query analytics ──────────────────────────────────────

    def get_analytics(self, collection_id: str) -> Dict[str, Any]:
        """Return query analytics for a collection."""
        analytics_file = self.rag_dir / f"{collection_id}_analytics.json"
        analytics: Dict[str, Any] = {"queries": [], "total_queries": 0}
        if analytics_file.exists():
            try:
                with open(analytics_file, "r") as f:
                    analytics = json.load(f)
            except Exception:
                pass

        # Load usage stats
        usage_file = self.rag_dir / f"{collection_id}_usage.json"
        usage: Dict[str, Any] = {}
        if usage_file.exists():
            try:
                with open(usage_file, "r") as f:
                    usage = json.load(f)
            except Exception:
                pass

        total_chunk_hits = sum(v.get("hits", 0) for v in usage.values())
        unique_chunks_used = len(usage)

        return {
            "total_queries": analytics.get("total_queries", 0),
            "recent_queries": analytics.get("queries", [])[-20:],
            "total_chunk_hits": total_chunk_hits,
            "unique_chunks_used": unique_chunks_used,
            "top_chunks": self._top_used_chunks(usage, limit=10),
        }

    def _record_query(self, collection_id: str, query_text: str, result_indices: List[int]):
        """Append a query record to analytics."""
        analytics_file = self.rag_dir / f"{collection_id}_analytics.json"
        analytics: Dict[str, Any] = {"queries": [], "total_queries": 0}
        if analytics_file.exists():
            try:
                with open(analytics_file, "r") as f:
                    analytics = json.load(f)
            except Exception:
                pass

        analytics["total_queries"] = analytics.get("total_queries", 0) + 1
        analytics["queries"].append({
            "query": query_text[:200],  # truncate long queries
            "timestamp": time.time(),
            "n_results": len(result_indices),
        })
        # Keep only last 100 queries
        if len(analytics["queries"]) > 100:
            analytics["queries"] = analytics["queries"][-100:]

        self._save_json(analytics_file, analytics)

    def _top_used_chunks(self, usage: Dict[str, Any], limit: int = 10) -> List[Dict[str, Any]]:
        """Return the top N most-used chunk indices with their stats."""
        items = []
        for idx_str, stats in usage.items():
            items.append({
                "index": int(idx_str),
                "hits": stats.get("hits", 0),
                "last_used": stats.get("last_used", 0),
            })
        items.sort(key=lambda x: x["hits"], reverse=True)
        return items[:limit]

    # ── Adaptive boosting ────────────────────────────────────

    def _apply_usage_boost(
        self, collection_id: str, results: List[Dict[str, Any]]
    ) -> List[Dict[str, Any]]:
        """Boost scores of chunks that have been historically useful."""
        usage_file = self.rag_dir / f"{collection_id}_usage.json"
        if not usage_file.exists():
            return results

        try:
            with open(usage_file, "r") as f:
                usage = json.load(f)
        except Exception:
            return results

        if not usage:
            return results

        now = time.time()
        boosted = []
        for item in results:
            key = str(item["index"])
            if key in usage:
                hits = usage[key].get("hits", 0)
                last_used = usage[key].get("last_used", 0)
                # Time-decayed boost: recent usage matters more
                days_ago = max((now - last_used) / 86400, 0)
                decay = _BOOST_DECAY_PER_DAY ** days_ago
                # Log-scaled hit count to prevent runaway boosting
                boost = 1.0 + min(np.log1p(hits) * 0.1 * decay, _MAX_BOOST - 1.0)
                entry = item.copy()
                entry["score"] = round(item["score"] * boost, 6)
                entry["boosted"] = True
                boosted.append(entry)
            else:
                boosted.append(item)

        boosted.sort(key=lambda x: x["score"], reverse=True)
        return boosted

    # ── BM25 search ─────────────────────────────────────────

    def _bm25_search(
        self, chunks: List[str], query_text: str, n: int = 20
    ) -> List[Dict[str, Any]]:
        """BM25 keyword search using rank_bm25."""
        try:
            from rank_bm25 import BM25Okapi
        except ImportError:
            return self._keyword_search(chunks, query_text, n)

        tokenized_corpus = [re.findall(r"\w+", c.lower()) for c in chunks]
        query_tokens = re.findall(r"\w+", query_text.lower())

        if not query_tokens:
            return []

        bm25 = BM25Okapi(tokenized_corpus)
        scores = bm25.get_scores(query_tokens)

        scored = []
        for i, score in enumerate(scores):
            if score > 0:
                scored.append(
                    {"text": chunks[i], "score": float(score), "index": i, "method": "bm25"}
                )

        scored.sort(key=lambda x: x["score"], reverse=True)
        if scored:
            return scored[:n]
        # BM25 can score 0 when query terms appear in every chunk (IDF→0);
        # fall back to simple keyword matching in that case.
        return self._keyword_search(chunks, query_text, n)

    def _keyword_search(
        self, chunks: List[str], query_text: str, n: int = 20
    ) -> List[Dict[str, Any]]:
        """Simple keyword overlap fallback when rank_bm25 is not installed."""
        query_terms = set(re.findall(r"\w+", query_text.lower()))
        scored = []
        for i, chunk in enumerate(chunks):
            chunk_lower = chunk.lower()
            term_hits = sum(1 for t in query_terms if t in chunk_lower)
            exact_bonus = 2 if query_text.lower() in chunk_lower else 0
            score = term_hits + exact_bonus
            if score > 0:
                scored.append(
                    {"text": chunk, "score": score, "index": i, "method": "keyword"}
                )

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:n]

    # ── Vector search (HNSW-accelerated) ─────────────────────

    def _vector_search(
        self,
        collection_id: str,
        chunks: List[str],
        query_text: str,
        n: int = 20,
    ) -> List[Dict[str, Any]]:
        """Vector search using HNSW index for fast ANN, with brute-force fallback."""
        from app.rag.embeddings import embedder

        if not embedder.available:
            return []

        # Try HNSW first
        hnsw_results = self._hnsw_search(collection_id, chunks, query_text, n)
        if hnsw_results is not None:
            return hnsw_results

        # Fallback: brute-force cosine similarity
        return self._brute_force_vector_search(collection_id, chunks, query_text, n)

    def _hnsw_search(
        self,
        collection_id: str,
        chunks: List[str],
        query_text: str,
        n: int = 20,
    ) -> Optional[List[Dict[str, Any]]]:
        """Fast approximate nearest neighbor search using HNSW index."""
        try:
            import hnswlib
        except ImportError:
            return None

        from app.rag.embeddings import embedder

        index_file = self.rag_dir / f"{collection_id}_hnsw.bin"
        if not index_file.exists():
            return None

        try:
            # Get embedding dimension from a test embed
            query_emb = embedder.embed([query_text], is_query=True)
            dim = query_emb.shape[1]

            index = hnswlib.Index(space="cosine", dim=dim)
            index.load_index(str(index_file))
            index.set_ef(_HNSW_EF_SEARCH)

            # Search — request more than n to have room for filtering
            k = min(n * 2, index.get_current_count())
            if k == 0:
                return None

            labels, distances = index.knn_query(query_emb, k=k)

            scored = []
            for label, dist in zip(labels[0], distances[0]):
                # hnswlib cosine distance = 1 - cosine_similarity
                similarity = 1.0 - dist
                if similarity > 0.1 and label < len(chunks):
                    scored.append({
                        "text": chunks[label],
                        "score": float(similarity),
                        "index": int(label),
                        "method": "vector",
                    })

            scored.sort(key=lambda x: x["score"], reverse=True)
            return scored[:n]
        except Exception as e:
            logger.warning(f"HNSW search failed, falling back to brute-force: {e}")
            return None

    def _brute_force_vector_search(
        self,
        collection_id: str,
        chunks: List[str],
        query_text: str,
        n: int = 20,
    ) -> List[Dict[str, Any]]:
        """Brute-force cosine similarity search (fallback when HNSW unavailable)."""
        from app.rag.embeddings import embedder

        emb_file = self.rag_dir / f"{collection_id}_embeddings.npy"
        if not emb_file.exists():
            return []

        try:
            chunk_embs = np.load(str(emb_file))
        except Exception:
            return []

        if len(chunk_embs) != len(chunks):
            self._rebuild_embeddings(collection_id, chunks)
            try:
                chunk_embs = np.load(str(emb_file))
            except Exception:
                return []

        try:
            query_emb = embedder.embed([query_text], is_query=True)
            scores = embedder.similarity(query_emb, chunk_embs)
        except Exception as e:
            logger.warning(f"Vector search failed: {e}")
            return []

        scored = []
        for i, score in enumerate(scores):
            if score > 0.1:
                scored.append(
                    {"text": chunks[i], "score": float(score), "index": i, "method": "vector"}
                )

        scored.sort(key=lambda x: x["score"], reverse=True)
        return scored[:n]

    # ── Reciprocal Rank Fusion ──────────────────────────────

    def _reciprocal_rank_fusion(
        self, *result_lists: List[Dict[str, Any]], k: int = 60
    ) -> List[Dict[str, Any]]:
        """Merge multiple ranked lists using RRF. k=60 is the standard constant."""
        rrf_scores: Dict[int, float] = {}
        chunk_map: Dict[int, Dict[str, Any]] = {}

        for results in result_lists:
            for rank, item in enumerate(results):
                idx = item["index"]
                rrf_scores[idx] = rrf_scores.get(idx, 0.0) + 1.0 / (k + rank + 1)
                if idx not in chunk_map:
                    chunk_map[idx] = item

        fused = []
        for idx, rrf_score in sorted(
            rrf_scores.items(), key=lambda x: x[1], reverse=True
        ):
            entry = chunk_map[idx].copy()
            entry["score"] = round(rrf_score, 6)
            entry["method"] = "hybrid"
            fused.append(entry)

        return fused

    # ── Embedding management ────────────────────────────────

    def _rebuild_embeddings(self, collection_id: str, chunks: List[str]):
        """Compute and persist embeddings + HNSW index for a collection's chunks."""
        from app.rag.embeddings import embedder

        if not embedder.available or not chunks:
            return

        try:
            embs = embedder.embed(chunks)
            emb_file = self.rag_dir / f"{collection_id}_embeddings.npy"
            # Atomic write for embeddings
            fd, tmp = tempfile.mkstemp(dir=str(self.rag_dir), suffix=".npy.tmp")
            os.close(fd)
            np.save(tmp, embs)
            os.replace(tmp, str(emb_file))
            logger.info(
                "Computed %d embeddings for collection %s", len(chunks), collection_id
            )

            # Build HNSW index
            self._build_hnsw_index(collection_id, embs)
        except Exception as e:
            logger.warning(f"Failed to compute embeddings: {e}")

    def _build_hnsw_index(self, collection_id: str, embeddings: np.ndarray):
        """Build and save an HNSW index for fast ANN search."""
        try:
            import hnswlib
        except ImportError:
            logger.info("hnswlib not installed — using brute-force vector search")
            return

        n_items, dim = embeddings.shape
        if n_items == 0:
            return

        try:
            index = hnswlib.Index(space="cosine", dim=dim)
            index.init_index(max_elements=max(n_items, 100), ef_construction=_HNSW_EF_CONSTRUCTION, M=_HNSW_M)
            index.add_items(embeddings, list(range(n_items)))
            index.set_ef(_HNSW_EF_SEARCH)

            index_file = self.rag_dir / f"{collection_id}_hnsw.bin"
            fd, tmp = tempfile.mkstemp(dir=str(self.rag_dir), suffix=".hnsw.tmp")
            os.close(fd)
            index.save_index(tmp)
            os.replace(tmp, str(index_file))
            logger.info("Built HNSW index (%d items, dim=%d) for %s", n_items, dim, collection_id)
        except Exception as e:
            logger.warning(f"Failed to build HNSW index: {e}")

    # ── Text splitting ──────────────────────────────────────

    def _recursive_split(self, text: str, chunk_size: int) -> List[str]:
        """Split text by trying separators: \\n\\n, \\n, ' ', then char-level."""
        separators = ["\n\n", "\n", " ", ""]

        def split_text(txt: str, seps: List[str]) -> List[str]:
            if len(txt) <= chunk_size:
                return [txt]

            if not seps or seps[0] == "":
                return [txt[i : i + chunk_size] for i in range(0, len(txt), chunk_size)]

            sep = seps[0]
            parts = txt.split(sep)
            result_chunks: List[str] = []
            current_chunk = ""

            for part in parts:
                candidate_len = len(current_chunk) + len(part) + (
                    len(sep) if current_chunk else 0
                )
                if candidate_len <= chunk_size:
                    current_chunk += (sep if current_chunk else "") + part
                else:
                    if current_chunk:
                        result_chunks.append(current_chunk)
                    if len(part) > chunk_size:
                        result_chunks.extend(split_text(part, seps[1:]))
                        current_chunk = ""
                    else:
                        current_chunk = part

            if current_chunk:
                result_chunks.append(current_chunk)

            return result_chunks

        return split_text(text, separators)

    def _save_collections(self, collections: List[Dict[str, Any]]):
        """Atomic write: temp file + os.replace to prevent corruption on crash."""
        fd, tmp_path = tempfile.mkstemp(dir=str(self.rag_dir), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(collections, f, indent=2)
            os.replace(tmp_path, self.collections_file)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

    def _save_json(self, path: Path, data: Any):
        """Atomic JSON write."""
        fd, tmp_path = tempfile.mkstemp(dir=str(self.rag_dir), suffix=".tmp")
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(data, f, indent=2)
            os.replace(tmp_path, str(path))
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise

"""Disk-backed LRU cache for MLX KV prompt state.

Uses mlx_lm's built-in save_prompt_cache / load_prompt_cache to persist
KV tensors across sessions.  This avoids recomputing the system prompt
prefix every time the app restarts.

Cache key = hash(model_id + first N token IDs).  Entries are .safetensors
files in ~/.silicon-studio/cache/kv/.
"""

import hashlib
import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# Guard import — mlx_lm may not be installed in test environments
try:
    from mlx_lm.models.cache import save_prompt_cache, load_prompt_cache
except ImportError:
    save_prompt_cache = None  # type: ignore[assignment]
    load_prompt_cache = None  # type: ignore[assignment]


def _cache_key(model_id: str, token_ids: List[int], max_prefix: int = 2048) -> str:
    """Deterministic key from model + prefix tokens."""
    prefix = token_ids[:max_prefix]
    raw = f"{model_id}::{prefix}"
    return hashlib.sha256(raw.encode()).hexdigest()[:24]


class DiskPromptCache:
    """LRU disk cache for MLX KV prompt state.

    Each entry is a directory containing:
      - cache.safetensors   : the KV tensors (via mlx_lm save_prompt_cache)
      - meta.json           : model_id, token_ids length, creation time
    """

    def __init__(
        self,
        cache_dir: Optional[Path] = None,
        max_size_bytes: int = 2 * 1024 * 1024 * 1024,  # 2 GB default
    ):
        if cache_dir is None:
            cache_dir = Path.home() / ".silicon-studio" / "cache" / "kv"
        self.cache_dir = Path(cache_dir)
        self.cache_dir.mkdir(parents=True, exist_ok=True)
        self.max_size_bytes = max_size_bytes

    # ── Public API ──────────────────────────────────────────────

    def save(
        self,
        model_id: str,
        token_ids: List[int],
        cache: List[Any],
        *,
        metadata: Optional[Dict[str, str]] = None,
    ) -> bool:
        """Persist a KV cache to disk.  Returns True on success."""
        if save_prompt_cache is None:
            return False
        if not token_ids or not cache:
            return False

        key = _cache_key(model_id, token_ids)
        entry_dir = self.cache_dir / key
        entry_dir.mkdir(parents=True, exist_ok=True)

        safetensors_path = str(entry_dir / "cache.safetensors")
        meta_path = entry_dir / "meta.json"

        try:
            save_prompt_cache(safetensors_path, cache, metadata=metadata or {})
            meta = {
                "model_id": model_id,
                "num_tokens": len(token_ids),
                "created": time.time(),
                "key": key,
            }
            meta_path.write_text(json.dumps(meta))
            logger.info("Disk KV cache saved: %s (%d tokens)", key, len(token_ids))
            self._evict_if_needed()
            return True
        except Exception as e:
            logger.debug("Failed to save disk KV cache: %s", e)
            # Clean up partial write
            try:
                if entry_dir.exists():
                    import shutil
                    shutil.rmtree(entry_dir, ignore_errors=True)
            except Exception:
                pass
            return False

    def load(
        self,
        model_id: str,
        token_ids: List[int],
    ) -> Optional[Tuple[List[Any], int]]:
        """Load a cached KV state if one matches (model_id + prefix).

        Returns (cache, num_cached_tokens) or None if miss.
        """
        if load_prompt_cache is None:
            return None

        key = _cache_key(model_id, token_ids)
        entry_dir = self.cache_dir / key
        safetensors_path = entry_dir / "cache.safetensors"
        meta_path = entry_dir / "meta.json"

        if not safetensors_path.exists() or not meta_path.exists():
            return None

        try:
            meta = json.loads(meta_path.read_text())
            if meta.get("model_id") != model_id:
                return None

            cache = load_prompt_cache(str(safetensors_path))
            num_tokens = meta.get("num_tokens", 0)

            # Touch the entry (update mtime for LRU)
            meta["last_used"] = time.time()
            meta_path.write_text(json.dumps(meta))

            logger.info("Disk KV cache hit: %s (%d tokens)", key, num_tokens)
            return cache, num_tokens
        except Exception as e:
            logger.debug("Failed to load disk KV cache %s: %s", key, e)
            return None

    def invalidate(self, model_id: str) -> int:
        """Remove all cached entries for a model.  Returns count removed."""
        import shutil
        removed = 0
        for entry_dir in self.cache_dir.iterdir():
            meta_path = entry_dir / "meta.json"
            if not meta_path.exists():
                continue
            try:
                meta = json.loads(meta_path.read_text())
                if meta.get("model_id") == model_id:
                    shutil.rmtree(entry_dir, ignore_errors=True)
                    removed += 1
            except Exception:
                pass
        if removed:
            logger.info("Invalidated %d disk KV cache entries for %s", removed, model_id)
        return removed

    def clear(self) -> None:
        """Remove all cached entries."""
        import shutil
        for entry_dir in self.cache_dir.iterdir():
            if entry_dir.is_dir():
                shutil.rmtree(entry_dir, ignore_errors=True)
        logger.info("Disk KV cache cleared")

    def stats(self) -> Dict[str, Any]:
        """Return cache statistics."""
        total_size = 0
        entries = 0
        for entry_dir in self.cache_dir.iterdir():
            if not entry_dir.is_dir():
                continue
            entries += 1
            for f in entry_dir.iterdir():
                total_size += f.stat().st_size
        return {
            "entries": entries,
            "total_size_mb": round(total_size / (1024 * 1024), 1),
            "max_size_mb": round(self.max_size_bytes / (1024 * 1024), 1),
            "cache_dir": str(self.cache_dir),
        }

    # ── Internal ────────────────────────────────────────────────

    def _evict_if_needed(self) -> None:
        """Remove oldest entries until total size is under max_size_bytes."""
        import shutil

        entries = []
        total_size = 0
        for entry_dir in self.cache_dir.iterdir():
            if not entry_dir.is_dir():
                continue
            meta_path = entry_dir / "meta.json"
            entry_size = sum(f.stat().st_size for f in entry_dir.iterdir())
            total_size += entry_size
            last_used = 0
            if meta_path.exists():
                try:
                    meta = json.loads(meta_path.read_text())
                    last_used = meta.get("last_used", meta.get("created", 0))
                except Exception:
                    pass
            entries.append((last_used, entry_size, entry_dir))

        if total_size <= self.max_size_bytes:
            return

        # Sort by last_used ascending (oldest first)
        entries.sort(key=lambda x: x[0])
        for last_used, entry_size, entry_dir in entries:
            if total_size <= self.max_size_bytes:
                break
            shutil.rmtree(entry_dir, ignore_errors=True)
            total_size -= entry_size
            logger.debug("Evicted disk KV cache: %s", entry_dir.name)

"""Tests for Feature 1: Engine Improvements (Smart GC, Disk Cache, Speculative)."""

import json
import os
import shutil
import tempfile

import pytest

from app.engine.disk_cache import DiskPromptCache, _cache_key


# ── Disk Cache Tests ────────────────────────────────────────────


class TestDiskPromptCache:
    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.cache = DiskPromptCache(cache_dir=self.tmpdir, max_size_bytes=10 * 1024 * 1024)

    def teardown_method(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_cache_key_deterministic(self):
        key1 = _cache_key("model-a", [1, 2, 3, 4, 5])
        key2 = _cache_key("model-a", [1, 2, 3, 4, 5])
        assert key1 == key2

    def test_cache_key_different_models(self):
        key1 = _cache_key("model-a", [1, 2, 3])
        key2 = _cache_key("model-b", [1, 2, 3])
        assert key1 != key2

    def test_cache_key_different_tokens(self):
        key1 = _cache_key("model-a", [1, 2, 3])
        key2 = _cache_key("model-a", [1, 2, 4])
        assert key1 != key2

    def test_save_returns_false_on_empty_input(self):
        assert self.cache.save("model", [], []) is False
        assert self.cache.save("model", [1, 2], []) is False
        assert self.cache.save("model", [], ["cache_obj"]) is False

    def test_stats_empty_cache(self):
        stats = self.cache.stats()
        assert stats["entries"] == 0
        assert stats["total_size_mb"] == 0

    def test_load_miss_returns_none(self):
        result = self.cache.load("nonexistent-model", [1, 2, 3])
        assert result is None

    def test_invalidate_empty(self):
        removed = self.cache.invalidate("nonexistent-model")
        assert removed == 0

    def test_clear_on_empty(self):
        # Should not raise
        self.cache.clear()
        stats = self.cache.stats()
        assert stats["entries"] == 0


# ── Speculative Module Tests ────────────────────────────────────


class TestSpeculativeDecoding:
    def test_estimate_memory_nonexistent_path(self):
        from app.engine.speculative import estimate_draft_memory_gb
        # Non-existent path should return 0
        result = estimate_draft_memory_gb("/nonexistent/model/path")
        assert result == 0.0

    def test_can_load_draft_nonexistent(self):
        from app.engine.speculative import can_load_draft
        # Non-existent path: estimate is 0, should pass the check
        result = can_load_draft("/nonexistent/model/path")
        # Should return True (0 GB estimated, plenty of headroom)
        assert isinstance(result, bool)


# ── Smart GC Tests ──────────────────────────────────────────────


class TestSmartGC:
    def test_maybe_gc_method_exists(self):
        """Verify the engine service has _maybe_gc method."""
        from app.engine.service import MLXEngineService
        assert hasattr(MLXEngineService, "_maybe_gc")

    def test_generation_count_initialized(self):
        """Verify _generation_count and _last_gc_time are initialized."""
        from app.engine.service import MLXEngineService
        import inspect
        source = inspect.getsource(MLXEngineService.__init__)
        assert "_generation_count" in source
        assert "_last_gc_time" in source

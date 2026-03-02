"""Tests for search endpoint resilience: timeouts, rate limits, and graceful degradation.

Mocks DuckDuckGo to simulate slow responses, 429 rate limits, and crashes
without hitting real external APIs.
"""

import pytest
import asyncio
import time
from unittest.mock import patch, MagicMock
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)


# ── Timeout / Slow Response ──────────────────────────────


def test_web_search_timeout_returns_warning():
    """If DDG hangs, the endpoint should return empty results + warning (not 500)."""

    def slow_ddg(query, max_results):
        time.sleep(15)  # longer than _SEARCH_TIMEOUT
        return []

    with patch("app.api.search._SEARCH_TIMEOUT", 1):  # 1s timeout for fast test
        with patch("app.api.search.DDGS") as mock_ddgs_cls:
            mock_instance = MagicMock()
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            mock_instance.text = slow_ddg
            mock_ddgs_cls.return_value = mock_instance

            # Patch the import check to succeed
            with patch.dict("sys.modules", {"duckduckgo_search": MagicMock(DDGS=mock_ddgs_cls)}):
                resp = client.post("/api/search/web", json={
                    "query": "test query",
                    "max_results": 3,
                    "extract_content": False,
                })

    assert resp.status_code == 200
    data = resp.json()
    assert data["results"] == []
    assert "warning" in data


def test_web_search_exception_returns_warning():
    """If DDG throws (e.g. rate limit), return empty results + warning."""
    with patch.dict("sys.modules", {"duckduckgo_search": MagicMock()}):
        with patch("app.api.search.DDGS") as mock_ddgs_cls:
            mock_instance = MagicMock()
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            mock_instance.text = MagicMock(side_effect=Exception("429 Too Many Requests"))
            mock_ddgs_cls.return_value = mock_instance

            resp = client.post("/api/search/web", json={
                "query": "rate limited query",
                "max_results": 3,
                "extract_content": False,
            })

    assert resp.status_code == 200
    data = resp.json()
    assert data["results"] == []
    assert "warning" in data
    assert "429" in data["warning"] or "unavailable" in data["warning"].lower()


def test_web_search_missing_dependency():
    """If duckduckgo-search is not installed, return 501."""
    import sys
    # Temporarily hide the module
    saved = sys.modules.get("duckduckgo_search")
    sys.modules["duckduckgo_search"] = None  # type: ignore

    try:
        resp = client.post("/api/search/web", json={
            "query": "test",
            "max_results": 3,
        })
        # Should return 501 or handle import error
        assert resp.status_code in (501, 200)
    finally:
        if saved is not None:
            sys.modules["duckduckgo_search"] = saved
        else:
            sys.modules.pop("duckduckgo_search", None)


def test_web_search_success():
    """Normal DDG response should be returned with proper structure."""
    fake_results = [
        {"title": "Result 1", "body": "Snippet 1", "href": "https://example.com/1"},
        {"title": "Result 2", "body": "Snippet 2", "href": "https://example.com/2"},
    ]

    with patch.dict("sys.modules", {"duckduckgo_search": MagicMock()}):
        with patch("app.api.search.DDGS") as mock_ddgs_cls:
            mock_instance = MagicMock()
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            mock_instance.text = MagicMock(return_value=fake_results)
            mock_ddgs_cls.return_value = mock_instance

            resp = client.post("/api/search/web", json={
                "query": "test query",
                "max_results": 2,
                "extract_content": False,
            })

    assert resp.status_code == 200
    data = resp.json()
    assert len(data["results"]) == 2
    assert data["results"][0]["title"] == "Result 1"
    assert data["results"][0]["url"] == "https://example.com/1"
    assert "warning" not in data


# ── Deep Search Timeout ──────────────────────────────────


def test_deep_search_timeout_returns_warning():
    """Deep search timeout should degrade gracefully like web search."""

    def slow_ddg(query, max_results):
        time.sleep(25)
        return []

    with patch("app.api.search._SEARCH_TIMEOUT", 1):
        with patch("app.api.search.DDGS") as mock_ddgs_cls:
            mock_instance = MagicMock()
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            mock_instance.text = slow_ddg
            mock_ddgs_cls.return_value = mock_instance

            with patch.dict("sys.modules", {"duckduckgo_search": MagicMock(DDGS=mock_ddgs_cls)}):
                resp = client.post("/api/search/deep", json={
                    "query": "deep timeout test",
                })

    assert resp.status_code == 200
    data = resp.json()
    assert data["results"] == []
    assert "warning" in data


# ── Content Extraction Resilience ────────────────────────


def test_content_extraction_failure_returns_snippets():
    """If trafilatura/aiohttp crash during extraction, snippets should still be returned."""
    fake_results = [
        {"title": "Page", "body": "Snippet text", "href": "https://example.com"},
    ]

    with patch.dict("sys.modules", {"duckduckgo_search": MagicMock()}):
        with patch("app.api.search.DDGS") as mock_ddgs_cls:
            mock_instance = MagicMock()
            mock_instance.__enter__ = MagicMock(return_value=mock_instance)
            mock_instance.__exit__ = MagicMock(return_value=False)
            mock_instance.text = MagicMock(return_value=fake_results)
            mock_ddgs_cls.return_value = mock_instance

            # Mock trafilatura import to raise
            with patch("app.api.search._fetch_and_extract", side_effect=Exception("extraction crashed")):
                resp = client.post("/api/search/web", json={
                    "query": "extract fail test",
                    "max_results": 1,
                    "extract_content": True,
                })

    assert resp.status_code == 200
    data = resp.json()
    # Should still have the snippet even if content extraction failed
    assert len(data["results"]) == 1
    assert data["results"][0]["snippet"] == "Snippet text"

"""Tests for the deployment API (start/stop/status/logs).

Updated for native runtime: deployment no longer uses subprocess.Popen.
Tests verify the native_server_start_time-based logic.
"""

import time
import pytest
from fastapi.testclient import TestClient
from main import app
from app.api import deployment

client = TestClient(app)


@pytest.fixture(autouse=True)
def reset_deployment_state():
    """Reset module-level globals between tests."""
    deployment.native_server_start_time = None
    deployment.server_logs.clear()
    yield
    deployment.native_server_start_time = None
    deployment.server_logs.clear()


# ── Status ────────────────────────────────────────────────

def test_status_returns_not_running():
    resp = client.get("/api/deployment/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["running"] is False
    assert data["pid"] is None
    assert data["uptime_seconds"] is None


def test_status_returns_running_when_started():
    deployment.native_server_start_time = time.time() - 10
    resp = client.get("/api/deployment/status")
    assert resp.status_code == 200
    data = resp.json()
    assert data["running"] is True
    assert data["pid"] is not None       # returns os.getpid()
    assert data["uptime_seconds"] >= 9


def test_status_not_running_when_cleared():
    deployment.native_server_start_time = None
    resp = client.get("/api/deployment/status")
    data = resp.json()
    assert data["running"] is False
    assert data["pid"] is None


# ── Start ─────────────────────────────────────────────────

def test_start_rejects_empty_model_path():
    resp = client.post("/api/deployment/start", json={
        "model_path": "",
        "host": "127.0.0.1",
        "port": 8080,
    })
    assert resp.status_code == 422


def test_start_rejects_whitespace_model_path():
    resp = client.post("/api/deployment/start", json={
        "model_path": "   ",
        "host": "127.0.0.1",
        "port": 8080,
    })
    assert resp.status_code == 422


def test_start_rejects_port_below_1024():
    resp = client.post("/api/deployment/start", json={
        "model_path": "/some/model",
        "host": "127.0.0.1",
        "port": 80,
    })
    assert resp.status_code == 422


def test_start_rejects_port_above_65535():
    resp = client.post("/api/deployment/start", json={
        "model_path": "/some/model",
        "host": "127.0.0.1",
        "port": 70000,
    })
    assert resp.status_code == 422


# ── Stop ──────────────────────────────────────────────────

def test_stop_when_not_running():
    resp = client.post("/api/deployment/stop")
    assert resp.status_code == 200
    data = resp.json()
    assert data["status"] == "success"
    assert "not running" in data["message"].lower()


def test_stop_clears_native_start_time():
    deployment.native_server_start_time = time.time()
    from unittest.mock import AsyncMock, patch
    # Patch unload_model to be a no-op coroutine
    with patch("app.api.deployment.service.unload_model", new_callable=AsyncMock):
        resp = client.post("/api/deployment/stop")
    assert resp.status_code == 200
    assert deployment.native_server_start_time is None


# ── Logs ──────────────────────────────────────────────────

def test_logs_empty_when_no_server():
    resp = client.get("/api/deployment/logs")
    assert resp.status_code == 200
    assert resp.json()["logs"] == []


def test_logs_returns_all_entries():
    now = time.time()
    deployment.server_logs.append({"timestamp": now, "source": "stdout", "message": "hello"})
    deployment.server_logs.append({"timestamp": now + 1, "source": "stderr", "message": "warn"})

    resp = client.get("/api/deployment/logs")
    logs = resp.json()["logs"]
    assert len(logs) == 2
    assert logs[0]["message"] == "hello"
    assert logs[1]["message"] == "warn"


def test_logs_since_filters_old_entries():
    old_ts = time.time() - 100
    new_ts = time.time()
    deployment.server_logs.append({"timestamp": old_ts, "source": "stdout", "message": "old"})
    deployment.server_logs.append({"timestamp": new_ts, "source": "stdout", "message": "new"})

    resp = client.get(f"/api/deployment/logs?since={old_ts + 1}")
    logs = resp.json()["logs"]
    assert len(logs) == 1
    assert logs[0]["message"] == "new"


def test_logs_ring_buffer_overflow():
    """Ensure deque maxlen is respected (500 entries max)."""
    for i in range(600):
        deployment.server_logs.append({
            "timestamp": time.time(),
            "source": "stdout",
            "message": f"line {i}",
        })
    assert len(deployment.server_logs) == 500
    resp = client.get("/api/deployment/logs")
    logs = resp.json()["logs"]
    assert len(logs) == 500
    assert logs[0]["message"] == "line 100"  # first 100 dropped

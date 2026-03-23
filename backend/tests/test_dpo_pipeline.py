"""End-to-end tests for the DPO pipeline: log pairs -> export -> API acceptance."""

import json
import os
import shutil
import tempfile

import pytest
from unittest.mock import patch, AsyncMock

from app.agents.nanocore.dataset_engine import DatasetEngine


# ── DatasetEngine: log_dpo_pair ──────────────────────────────


class TestDatasetEngineDPO:
    """Unit tests for DatasetEngine DPO pair logging."""

    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine = DatasetEngine(storage_dir=self.tmpdir)

    def teardown_method(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_log_dpo_pair_writes_jsonl(self):
        self.engine.log_dpo_pair(
            prompt="Fix the login bug",
            chosen="patch_file auth.py\n-old\n+new",
            rejected="[no change] auth.py",
            metadata={"tool": "patch_file", "file": "auth.py"},
        )
        dpo_file = os.path.join(self.tmpdir, "dpo_pairs.jsonl")
        assert os.path.exists(dpo_file)

        with open(dpo_file) as f:
            lines = f.readlines()
        assert len(lines) == 1

        entry = json.loads(lines[0])
        assert entry["prompt"] == "Fix the login bug"
        assert entry["chosen"] == "patch_file auth.py\n-old\n+new"
        assert entry["rejected"] == "[no change] auth.py"
        assert "timestamp" in entry
        assert entry["metadata"]["tool"] == "patch_file"

    def test_log_dpo_pair_skips_empty(self):
        self.engine.log_dpo_pair(prompt="", chosen="x", rejected="y")
        self.engine.log_dpo_pair(prompt="x", chosen="", rejected="y")
        self.engine.log_dpo_pair(prompt="x", chosen="y", rejected="")
        dpo_file = os.path.join(self.tmpdir, "dpo_pairs.jsonl")
        assert not os.path.exists(dpo_file)

    def test_log_multiple_pairs(self):
        for i in range(25):
            self.engine.log_dpo_pair(
                prompt=f"prompt {i}",
                chosen=f"chosen {i}",
                rejected=f"rejected {i}",
            )
        dpo_file = os.path.join(self.tmpdir, "dpo_pairs.jsonl")
        with open(dpo_file) as f:
            lines = f.readlines()
        assert len(lines) == 25

        # Verify each line is valid JSON with required DPO fields
        for line in lines:
            entry = json.loads(line)
            assert "prompt" in entry
            assert "chosen" in entry
            assert "rejected" in entry

    def test_dpo_file_format_is_sillm_compatible(self):
        """The JSONL format must be loadable by SiLLM's dataset loader."""
        self.engine.log_dpo_pair(
            prompt="Add error handling",
            chosen="try:\n    result = api_call()\nexcept Exception as e:\n    log(e)",
            rejected="result = api_call()",
        )
        dpo_file = os.path.join(self.tmpdir, "dpo_pairs.jsonl")
        with open(dpo_file) as f:
            entry = json.loads(f.readline())

        # SiLLM expects exactly these three keys
        assert set(entry.keys()) >= {"prompt", "chosen", "rejected"}
        assert isinstance(entry["prompt"], str)
        assert isinstance(entry["chosen"], str)
        assert isinstance(entry["rejected"], str)


# ── DPO API endpoint ─────────────────────────────────────────


class TestDPOEndpoint:
    """Test the /api/engine/dpo endpoint."""

    def setup_method(self):
        # Import here to avoid import-time side effects
        from fastapi.testclient import TestClient
        from main import app

        self.client = TestClient(app)

    @patch("app.api.engine.safe_user_file")
    @patch("app.api.engine.service")
    def test_dpo_endpoint_accepts_valid_request(self, mock_service, mock_safe):
        mock_service.start_dpo_training = AsyncMock(
            return_value={"job_id": "test-123", "status": "started", "job_name": "dpo-test"}
        )
        mock_safe.return_value = None  # bypass path security for test

        resp = self.client.post("/api/engine/dpo", json={
            "model_id": "test-model",
            "dataset_path": "/tmp/dpo_pairs.jsonl",
            "epochs": 1,
            "dpo_beta": 0.1,
            "job_name": "dpo-test",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "started"
        assert "job_id" in data

    @patch("app.api.engine.service")
    def test_dpo_endpoint_validates_beta(self, mock_service):
        resp = self.client.post("/api/engine/dpo", json={
            "model_id": "test-model",
            "dataset_path": "/tmp/fake.jsonl",
            "dpo_beta": -1.0,  # invalid
        })
        assert resp.status_code == 422  # pydantic validation

    @patch("app.api.engine.service")
    def test_dpo_endpoint_validates_model_id(self, mock_service):
        resp = self.client.post("/api/engine/dpo", json={
            "model_id": "",  # empty
            "dataset_path": "/tmp/fake.jsonl",
        })
        assert resp.status_code == 422


# ── Full pipeline: log -> count -> verify readiness ──────────


class TestDPOPipelineIntegration:
    """Integration test: log DPO pairs, check status endpoint, verify format."""

    def setup_method(self):
        self.tmpdir = tempfile.mkdtemp()
        self.engine = DatasetEngine(storage_dir=self.tmpdir)

    def teardown_method(self):
        shutil.rmtree(self.tmpdir, ignore_errors=True)

    def test_full_pipeline_log_to_count(self):
        """Simulate real usage: log 30 pairs, verify count and file integrity."""
        # Phase 1: Simulate agent interactions producing DPO pairs
        for i in range(30):
            approved = i % 3 != 0  # 2/3 approved, 1/3 rejected
            diff = f"patch_file file_{i}.py\n-old_line\n+new_line_{i}"
            if approved:
                self.engine.log_dpo_pair(
                    prompt=f"Fix issue #{i}",
                    chosen=diff,
                    rejected=f"[no change] file_{i}.py",
                    metadata={"tool": "patch_file", "file": f"file_{i}.py"},
                )
            else:
                self.engine.log_dpo_pair(
                    prompt=f"Fix issue #{i}",
                    chosen=f"[no change] file_{i}.py",
                    rejected=diff,
                    metadata={"tool": "patch_file", "file": f"file_{i}.py", "reason": "bad style"},
                )

        # Phase 2: Count pairs (simulates /dataset/dpo-status endpoint)
        dpo_file = self.engine.storage_dir / "dpo_pairs.jsonl"
        assert dpo_file.exists()
        with open(dpo_file) as f:
            count = sum(1 for _ in f)
        assert count == 30

        # Phase 3: Verify all entries are valid JSON with required fields
        with open(dpo_file) as f:
            for line in f:
                entry = json.loads(line)
                assert len(entry["prompt"]) > 0
                assert len(entry["chosen"]) > 0
                assert len(entry["rejected"]) > 0
                # Metadata preserved
                assert "metadata" in entry
                assert entry["metadata"]["tool"] == "patch_file"

    def test_concurrent_sft_and_dpo_logging(self):
        """SFT and DPO logging should not interfere with each other."""
        # Log SFT interactions
        for i in range(10):
            self.engine.log_interaction(
                [{"role": "user", "content": f"q{i}"}, {"role": "assistant", "content": f"a{i}"}],
                metadata={"tool": "bash"},
            )
        # Log DPO pairs
        for i in range(10):
            self.engine.log_dpo_pair(f"p{i}", f"c{i}", f"r{i}")

        # Verify separate files
        session_files = list(self.engine.storage_dir.glob("session_*.jsonl"))
        dpo_file = self.engine.storage_dir / "dpo_pairs.jsonl"

        assert len(session_files) == 1
        assert dpo_file.exists()

        with open(session_files[0]) as f:
            sft_count = sum(1 for _ in f)
        with open(dpo_file) as f:
            dpo_count = sum(1 for _ in f)

        assert sft_count == 10
        assert dpo_count == 10

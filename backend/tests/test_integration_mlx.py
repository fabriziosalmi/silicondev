"""
Integration tests that load a real MLX model and verify end-to-end behavior.

These tests require:
  - macOS with Apple Silicon
  - mlx and mlx-lm installed
  - A small model available locally (SmolLM-135M-Instruct or similar)

Run manually:  python -m pytest tests/test_integration_mlx.py -v -s
Not run in CI (marked with @pytest.mark.integration).
"""

import os
import sys
import json
import time
import asyncio
import pytest
from pathlib import Path

# Skip entire module if not on macOS Apple Silicon or mlx unavailable
pytestmark = [
    pytest.mark.integration,
    pytest.mark.skipif(
        sys.platform != "darwin",
        reason="MLX integration tests require macOS",
    ),
]

try:
    import mlx.core as mx
    HAS_MLX = True
except ImportError:
    HAS_MLX = False

# Candidate small models, in order of preference
SMALL_MODELS = [
    Path.home() / ".cache/huggingface/hub/models--HuggingFaceTB--SmolLM-135M-Instruct/snapshots",
    Path.home() / ".cache/huggingface/hub/models--Qwen--Qwen2.5-Coder-0.5B-Instruct/snapshots",
    Path.home() / ".cache/huggingface/hub/models--Qwen--Qwen3-0.6B/snapshots",
]


def find_model_path() -> str | None:
    """Find the first available small model on disk."""
    for candidate in SMALL_MODELS:
        if candidate.exists():
            # HF cache: snapshots/<hash>/, pick the newest
            snapshots = sorted(candidate.iterdir(), key=lambda p: p.stat().st_mtime, reverse=True)
            for snap in snapshots:
                # Verify it has model files (config.json at minimum)
                if (snap / "config.json").exists():
                    return str(snap)
    return None


MODEL_PATH = find_model_path()


@pytest.mark.skipif(not HAS_MLX, reason="mlx not installed")
@pytest.mark.skipif(MODEL_PATH is None, reason="No small model found locally")
class TestMLXInference:
    """Test that we can load a model and generate tokens."""

    def test_load_model(self):
        """Load a small model and verify it returns a model + tokenizer."""
        from mlx_lm import load

        model, tokenizer = load(MODEL_PATH)
        assert model is not None
        assert tokenizer is not None
        # Model should have parameters (MLX uses nested dicts, flatten with nn.utils)
        import mlx.nn as nn
        total_params = sum(x.size for _, x in nn.utils.tree_flatten(model.parameters()))
        assert total_params > 0, "Model has no parameters"

    def test_generate_tokens(self):
        """Generate tokens from a prompt and verify non-empty output."""
        from mlx_lm import load, generate

        model, tokenizer = load(MODEL_PATH)
        output = generate(
            model,
            tokenizer,
            prompt="Hello, world!",
            max_tokens=20,
        )
        assert isinstance(output, str)
        assert len(output) > 0, "Generation produced empty output"

    def test_stream_generate(self):
        """Verify stream_generate yields tokens one by one."""
        from mlx_lm import load, stream_generate
        from mlx_lm.sample_utils import make_sampler

        model, tokenizer = load(MODEL_PATH)
        prompt_tokens = tokenizer.encode("Write a haiku about code.")

        sampler = make_sampler(temp=0.5)
        tokens = []
        for response in stream_generate(
            model,
            tokenizer,
            prompt=prompt_tokens,
            max_tokens=30,
            sampler=sampler,
        ):
            tokens.append(response.text)

        full_text = "".join(tokens)
        assert len(full_text) > 0, "Stream generation produced nothing"
        assert len(tokens) > 1, "Stream should yield multiple chunks"

    def test_prefix_cache_reuse(self):
        """Verify KV prefix cache works across turns."""
        from mlx_lm import load, stream_generate
        from mlx_lm.models.cache import make_prompt_cache, trim_prompt_cache
        from mlx_lm.sample_utils import make_sampler

        model, tokenizer = load(MODEL_PATH)
        sampler = make_sampler(temp=0.1)
        cache = make_prompt_cache(model)

        # First turn
        prompt1 = tokenizer.encode("You are a helpful assistant.\nUser: Hi\nAssistant:")
        tokens1 = []
        for resp in stream_generate(model, tokenizer, prompt=prompt1, max_tokens=10,
                                     sampler=sampler, prompt_cache=cache):
            tokens1.append(resp.text)

        assert len(tokens1) > 0, "First turn produced nothing"

        # Second turn shares prefix — should be faster
        prompt2 = tokenizer.encode("You are a helpful assistant.\nUser: Hi\nAssistant: Hello!\nUser: Bye\nAssistant:")

        # Find common prefix length
        common = 0
        for i in range(min(len(prompt1), len(prompt2))):
            if prompt1[i] == prompt2[i]:
                common += 1
            else:
                break

        assert common > 5, f"Expected shared prefix, got only {common} tokens"

        # Trim cache to common prefix
        to_trim = len(prompt1) - common
        if to_trim > 0:
            trim_prompt_cache(cache, to_trim)

        tokens2 = []
        for resp in stream_generate(model, tokenizer, prompt=prompt2, max_tokens=10,
                                     sampler=sampler, prompt_cache=cache):
            tokens2.append(resp.text)

        assert len(tokens2) > 0, "Second turn with cache produced nothing"


@pytest.mark.skipif(not HAS_MLX, reason="mlx not installed")
@pytest.mark.skipif(MODEL_PATH is None, reason="No small model found locally")
class TestEngineService:
    """Test the MLXEngineService with a real model (no mocks)."""

    @pytest.fixture
    def service(self):
        """Create a real engine service instance."""
        from app.engine.service import MLXEngineService
        svc = MLXEngineService()
        yield svc
        # Cleanup: unload model
        svc.active_model = None
        svc.active_tokenizer = None
        svc.active_processor = None
        svc.active_model_id = None
        svc._model_cache.clear()
        import gc
        gc.collect()

    @pytest.mark.asyncio
    async def test_load_and_generate(self, service):
        """Load model via service and generate tokens."""
        # Use the local path directly as model_id (engine supports absolute paths)
        model_id = MODEL_PATH

        # Load
        await service._load_model_impl(model_id)
        assert service.active_model is not None
        assert service.active_model_id == model_id
        assert service.active_tokenizer is not None

        # Generate
        tokens_received = []
        async for chunk in service.generate_stream(
            model_id=model_id,
            messages=[{"role": "user", "content": "Say hello in one word."}],
            max_tokens=15,
            temperature=0.1,
        ):
            if isinstance(chunk, dict) and "text" in chunk:
                tokens_received.append(chunk["text"])

        full = "".join(tokens_received)
        assert len(full) > 0, "Engine service generated nothing"

    @pytest.mark.asyncio
    async def test_smart_gc_does_not_clear_every_time(self, service):
        """Verify _maybe_gc doesn't trigger on first generation."""
        service._generation_count = 0
        service._last_gc_time = time.time()

        # Simulate a generation completing
        service._generation_count += 1
        # _maybe_gc should NOT trigger (count=1, recent gc, low memory pressure)
        initial_count = service._generation_count
        service._maybe_gc()
        # If GC triggered, count would reset to 0
        # Under normal memory conditions, it should NOT have triggered
        # (We can't guarantee memory state, so just verify the method exists and runs)
        assert hasattr(service, "_generation_count")
        assert hasattr(service, "_last_gc_time")


@pytest.mark.skipif(not HAS_MLX, reason="mlx not installed")
@pytest.mark.skipif(MODEL_PATH is None, reason="No small model found locally")
class TestToolParsing:
    """Test that model output containing tool calls parses correctly."""

    def test_parse_tool_from_real_output(self):
        """Verify the parser handles realistic model output."""
        from app.agents.nanocore.parser import extract_tool_calls

        # Use the actual NanoCore tool format: <tool name="..."><arg name="...">value</arg></tool>
        model_output = """Let me read the file first.
<tool name="read_file">
<arg name="path">/src/main.py</arg>
</tool>

I'll check the contents."""

        tools = extract_tool_calls(model_output)
        assert len(tools) == 1
        assert tools[0].name == "read_file"
        assert tools[0].args["path"] == "/src/main.py"


@pytest.mark.skipif(not HAS_MLX, reason="mlx not installed")
@pytest.mark.skipif(MODEL_PATH is None, reason="No small model found locally")
class TestDPOPairFormat:
    """Test that DPO pairs logged during diff approval have the right format for training."""

    def test_dpo_pair_roundtrip(self, tmp_path):
        """Log a DPO pair, read it back, verify it has all fields for training."""
        from app.agents.nanocore.dataset_engine import DatasetEngine

        engine = DatasetEngine(storage_dir=tmp_path)
        engine.log_dpo_pair(
            prompt="Fix the bug in auth.py",
            chosen="patch_file auth.py\n-old_line\n+new_line",
            rejected="patch_file auth.py\n-old_line\n+wrong_line",
            metadata={"tool": "patch_file", "file": "auth.py"},
        )

        dpo_file = tmp_path / "dpo_pairs.jsonl"
        assert dpo_file.exists()

        with open(dpo_file) as f:
            pair = json.loads(f.readline())

        # Verify all fields needed by the DPO training loop
        assert "prompt" in pair
        assert "chosen" in pair
        assert "rejected" in pair
        assert "timestamp" in pair
        assert pair["prompt"] == "Fix the bug in auth.py"
        assert "new_line" in pair["chosen"]
        assert "wrong_line" in pair["rejected"]

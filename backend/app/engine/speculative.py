"""Speculative decoding support for MLX inference.

Uses mlx_lm's built-in `draft_model` parameter in `stream_generate`.
The draft model is a small (~0.5-1B) model that shares the same tokenizer
as the main model.  It generates candidate tokens quickly, and the main
model verifies them in a single forward pass.

Memory-aware: only loads the draft model if there's enough headroom.
Falls back silently to normal generation if the draft can't be loaded.
"""

import logging
import psutil
from pathlib import Path
from typing import Optional, Tuple, Any

logger = logging.getLogger(__name__)

# Rough size estimates per parameter count (Q4 quantization)
_SIZE_ESTIMATES_GB = {
    "0.5b": 0.4,
    "1b": 0.7,
    "1.5b": 1.0,
    "3b": 2.0,
}

# Default: minimum 4 GB free after loading draft model
_MIN_FREE_AFTER_DRAFT_GB = 4.0


def estimate_draft_memory_gb(draft_path: str) -> float:
    """Estimate how much RAM a draft model will need.

    Uses config.json if available, otherwise falls back to disk size.
    """
    import json
    config_path = Path(draft_path) / "config.json"
    if config_path.exists():
        try:
            config = json.loads(config_path.read_text())
            num_params = config.get("num_parameters", 0)
            if not num_params:
                # Rough estimate from hidden_size * num_layers
                hidden = config.get("hidden_size", 0)
                layers = config.get("num_hidden_layers", 0)
                vocab = config.get("vocab_size", 0)
                # Very rough: params ~ hidden^2 * layers * 4 + vocab * hidden
                num_params = (hidden * hidden * layers * 4 + vocab * hidden) if hidden else 0

            if num_params > 0:
                # Q4 quantization: ~0.5 bytes per parameter + overhead
                return (num_params * 0.6) / (1024 ** 3)
        except Exception:
            pass

    # Fallback: estimate from total file size on disk
    total = sum(f.stat().st_size for f in Path(draft_path).rglob("*.safetensors"))
    return (total * 1.2) / (1024 ** 3)  # 20% overhead for runtime buffers


def can_load_draft(draft_path: str, min_free_gb: float = _MIN_FREE_AFTER_DRAFT_GB) -> bool:
    """Check if there's enough free memory to load the draft model."""
    draft_gb = estimate_draft_memory_gb(draft_path)
    mem = psutil.virtual_memory()
    available_gb = mem.available / (1024 ** 3)
    headroom = available_gb - draft_gb

    if headroom < min_free_gb:
        logger.info(
            "Draft model skipped: need %.1f GB, have %.1f GB available, "
            "would leave %.1f GB (min: %.1f GB)",
            draft_gb, available_gb, headroom, min_free_gb,
        )
        return False
    logger.info(
        "Draft model fits: %.1f GB estimated, %.1f GB available",
        draft_gb, available_gb,
    )
    return True


def load_draft_model(draft_model_id: str, models_dir: Path) -> Optional[Tuple[Any, Any]]:
    """Load a draft model for speculative decoding.

    Returns (draft_model, draft_tokenizer) or None if it can't be loaded.
    """
    try:
        from mlx_lm import load

        # Resolve path (same logic as main model)
        if Path(draft_model_id).is_absolute() and Path(draft_model_id).exists():
            draft_path = draft_model_id
        else:
            sanitized = draft_model_id.replace("/", "--")
            local_path = models_dir / sanitized
            if (local_path / ".completed").exists():
                draft_path = str(local_path)
            else:
                logger.info("Draft model %s not downloaded yet", draft_model_id)
                return None

        if not can_load_draft(draft_path):
            return None

        logger.info("Loading draft model: %s", draft_model_id)
        model, tokenizer = load(draft_path)
        logger.info("Draft model loaded: %s", draft_model_id)
        return model, tokenizer
    except Exception as e:
        logger.warning("Failed to load draft model %s: %s", draft_model_id, e)
        return None

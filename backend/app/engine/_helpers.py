"""Module-level helpers for the MLX engine.

Pure functions and small typed records that the engine depends on but that
have no MLXEngineService state of their own. Extracted from service.py to
keep the main service file focused on orchestration.
"""
from __future__ import annotations

import logging
import shutil
from pathlib import Path
from typing import Any, NamedTuple

import mlx.core as mx

logger = logging.getLogger(__name__)


# Minimum free disk space required for heavy I/O operations (1 GB)
MIN_DISK_SPACE_BYTES = 1_073_741_824


class CachedModel(NamedTuple):
    """Typed entry for the multi-model LRU cache."""
    model: Any
    tokenizer: Any
    processor: Any
    is_vision: bool
    last_used: float


def check_disk_space(target_path: Path, min_bytes: int = MIN_DISK_SPACE_BYTES) -> None:
    """Raise OSError if disk has less than min_bytes free at target_path."""
    check_path = target_path if target_path.exists() else target_path.parent
    while not check_path.exists() and check_path != check_path.parent:
        check_path = check_path.parent
    usage = shutil.disk_usage(str(check_path))
    if usage.free < min_bytes:
        free_gb = usage.free / (1024 ** 3)
        min_gb = min_bytes / (1024 ** 3)
        raise OSError(
            f"Not enough disk space: {free_gb:.1f} GB free, need at least {min_gb:.1f} GB"
        )


def init_mlx_thread() -> None:
    """Initializer for the dedicated MLX worker thread.

    MLX maintains a default device globally, but the GPU stream is per-thread
    and is only created lazily on the first op. Pinning the device here makes
    failure modes obvious if MLX ever changes its lazy-init behaviour.
    """
    try:
        mx.set_default_device(mx.gpu)
    except Exception as e:
        logger.warning(f"MLX worker thread init: failed to set default device to GPU: {e}")


_vlm_compat_patched = False


def patch_transformers_vlm_compat() -> None:
    """Patch transformers to handle models whose video processor isn't available.

    transformers >= 5.x registers video processor mappings as None for some
    model types (e.g. qwen3_5).  This causes three crashes:
    1. ``video_processor_class_from_name`` does ``class_name in None``
    2. Even after fixing (1), the actual processor class may require
       PyTorch / Torchvision which aren't present in an MLX-only env.
    3. ``ProcessorMixin.__init__`` rejects None for the video_processor arg.

    The patches below are no-ops when everything works normally and only
    activate when the above conditions are hit.
    """
    global _vlm_compat_patched
    if _vlm_compat_patched:
        return
    _vlm_compat_patched = True

    try:
        import importlib
        import transformers.models.auto.video_processing_auto as vpa
        import transformers.processing_utils as pu

        # (1) Guard against None in VIDEO_PROCESSOR_MAPPING_NAMES values
        _orig_mapping = vpa.VIDEO_PROCESSOR_MAPPING_NAMES
        def _safe_vpcfn(class_name):
            for module_name, extractors in _orig_mapping.items():
                if extractors is not None and class_name in extractors:
                    mn = vpa.model_type_to_module_name(module_name)
                    module = importlib.import_module(f".{mn}", "transformers.models")
                    try:
                        return getattr(module, class_name)
                    except AttributeError:
                        continue
            for extractor in vpa.VIDEO_PROCESSOR_MAPPING._extra_content.values():
                if getattr(extractor, "__name__", None) == class_name:
                    return extractor
            main_module = importlib.import_module("transformers")
            if hasattr(main_module, class_name):
                return getattr(main_module, class_name)
            return None
        vpa.video_processor_class_from_name = _safe_vpcfn

        # (2) AutoVideoProcessor.from_pretrained -> None when backend missing
        _orig_avp = vpa.AutoVideoProcessor.from_pretrained.__func__
        @classmethod
        def _safe_avp(cls, *args, **kwargs):
            try:
                return _orig_avp(cls, *args, **kwargs)
            except ImportError:
                return None
        vpa.AutoVideoProcessor.from_pretrained = _safe_avp

        # (3) Allow None video_processor through type check
        _orig_check = pu.ProcessorMixin.check_argument_for_proper_class
        def _safe_check(self, argument_name, arg):
            if argument_name == "video_processor" and arg is None:
                return
            return _orig_check(self, argument_name, arg)
        pu.ProcessorMixin.check_argument_for_proper_class = _safe_check

        logger.debug("Applied transformers VLM compatibility patches")
    except (ImportError, AttributeError) as e:
        logger.debug(f"Skipped transformers VLM compat patches: {e}")

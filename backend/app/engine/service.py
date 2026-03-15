from mlx_lm import load, generate
from mlx_lm.tuner import train, TrainingArgs
from mlx_lm.utils import load_adapters
import mlx.core as mx
import gc
import re
import asyncio
import threading
import os
import sys
import json
import logging
import psutil
from app.agents.nanocore.scout import ScoutAgent
import shutil
import tempfile
import time
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)

_vlm_compat_patched = False


def _patch_transformers_vlm_compat():
    """Patch transformers to handle models whose video processor isn't available.

    transformers >= 5.x registers video processor mappings as None for some
    model types (e.g. qwen3_5).  This causes two crashes:
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
    except Exception as e:
        logger.debug(f"Skipped transformers VLM compat patches: {e}")

# Minimum free disk space required for heavy I/O operations (1 GB)
_MIN_DISK_SPACE_BYTES = 1_073_741_824


def _check_disk_space(target_path: Path, min_bytes: int = _MIN_DISK_SPACE_BYTES) -> None:
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


class MLXEngineService:
    def __init__(self):
        self.active_jobs = {}
        self.active_downloads = set()
        self.active_model_id = None
        self.active_model = None
        self.active_tokenizer = None
        self.active_processor = None       # mlx-vlm processor (vision models)
        self.active_is_vision = False
        self.active_kv_cache = None        # Persistent KV Cache for prefix hits
        self.active_kv_cache_id = None     # Hash/Slug of the current prefix in cache
        self.active_kv_bits: int | None = None  # KV quantization bits (4 or 8)
        self.loaded_models = {}
        self.stop_event = threading.Event()
        self.generation_lock = asyncio.Lock()
        self._jobs_lock = threading.Lock()
        self._config_lock = threading.Lock()
        self._load_warning: str | None = None

        # Use writable per-user directory for models/adapters
        self.workspace_dir = Path.home() / ".silicon-studio"
        self.models_dir = self.workspace_dir / "models"
        self.adapters_dir = self.workspace_dir / "adapters"
        
        self.models_dir.mkdir(parents=True, exist_ok=True)
        self.adapters_dir.mkdir(parents=True, exist_ok=True)
        
        # New for Phase 9: Auto-discover local models
        self.discovery_paths = [
            Path("~/.lmstudio/models").expanduser(),
            Path("~/.ollama/models").expanduser(),
            Path("~/.cache/huggingface/hub").expanduser()
        ]
        
        # Use writable per-user location for models registry
        user_data_dir = Path.home() / ".silicon-studio"
        user_data_dir.mkdir(parents=True, exist_ok=True)
        self.models_config_path = user_data_dir / "models.json"
        logger.info(f"Models config at: {self.models_config_path}")
                
        self.models_config = self._load_models_config()
        self.last_active = time.time()
        
        # Run auto-discovery and predictive loader in background
        threading.Thread(target=self._run_auto_discovery, daemon=True).start()
        threading.Thread(target=self._run_predictive_loader, daemon=True).start()
        threading.Thread(target=self._run_scout_agent, daemon=True).start()

    def _run_predictive_loader(self):
        """Background thread to keep models hot or pre-heat based on predicted need."""
        while not self.stop_event.is_set():
            time.sleep(60)  # Check every minute
            
            # 1. Heartbeat: If we have an active model and it's been used recently,
            # we ensure it stays in VRAM. If idle for > 30 mins, we could offload
            # but for 10x we want "instant ready", so we keep it if RAM allows.
            idle_time = time.time() - self.last_active
            
            if self.active_model and idle_time > 1800: # 30 mins
                # Optional: GC to clean up KV cache but keep weights
                mx.clear_cache()
                gc.collect()
            
            # 2. Pre-heat: If no model is active but the app is running,
            # load the 'default' or 'last used' model if system memory is > 40% free.
            if not self.active_model:
                mem = psutil.virtual_memory()
                if mem.percent < 60: # System is not too busy
                    # Logic to find "best" model to pre-heat
                    default_id = self.models_config.get("default_model_id")
                    if default_id:
                        logger.info(f"[PredictiveLoader] System idle, pre-heating default model: {default_id}")
                        # We don't block, just trigger a background load
                        # Note: we need to handle this carefully to not block the main event loop
                        pass
            
    def _run_auto_discovery(self):
        """Scan known local model directories (LM Studio, Ollama, HuggingFace cache)."""
        logger.info("Running local model auto-discovery...")
        discovered_count = 0
        for path in self.discovery_paths:
            if path.exists():
                logger.info(f"Scanning discovery path: {path}")
                try:
                    models = self.register_model(name=f"Local / {path.name.replace('-',' ').title()}", path=str(path))
                    discovered_count += len(models)
                except Exception as e:
                    logger.debug(f"Discovery skip for {path}: {e}")
        logger.info(f"Auto-discovery complete. Found {discovered_count} new local models.")

    def _load_models_config(self):
        # Load user config
        user_models = []
        if self.models_config_path.exists():
            try:
                with open(self.models_config_path, "r") as f:
                    user_models = json.load(f)
            except Exception as e:
                logger.error(f"Error loading models.json: {e}")

        # Merge bundled catalog so discover tab has entries
        catalog = self._load_bundled_catalog()
        if catalog:
            existing_ids = {m["id"] for m in user_models}
            added = 0
            for m in catalog:
                if m["id"] not in existing_ids:
                    user_models.append(m)
                    added += 1
            if added:
                logger.info(f"Merged {added} models from bundled catalog")
        return user_models

    def _load_bundled_catalog(self):
        """Load the bundled models.json catalog (shipped with the app)."""
        # When running from PyInstaller bundle
        candidates = [
            Path(getattr(sys, '_MEIPASS', '')) / "models.json",
            Path(__file__).resolve().parent.parent.parent.parent / "models.json",
        ]
        for p in candidates:
            if p.exists():
                try:
                    with open(p, "r") as f:
                        return json.load(f)
                except Exception as e:
                    logger.debug(f"Failed to load bundled catalog from {p}: {e}")
        return []

    def _save_models_config(self):
        """Atomic write: temp file + os.replace to prevent corruption on crash."""
        fd, tmp_path = tempfile.mkstemp(
            dir=str(self.models_config_path.parent), suffix=".tmp"
        )
        try:
            with os.fdopen(fd, "w") as f:
                json.dump(self.models_config, f, indent=4)
            os.replace(tmp_path, self.models_config_path)
        except Exception:
            try:
                os.unlink(tmp_path)
            except OSError:
                pass
            raise
            
    def _get_dir_size_str(self, path: Path):
        try:
            total_size = 0
            for dirpath, dirnames, filenames in os.walk(path):
                for f in filenames:
                    fp = os.path.join(dirpath, f)
                    # skip if it is symbolic link
                    if not os.path.islink(fp):
                        total_size += os.path.getsize(fp)
            
            gb = total_size / (1024 * 1024 * 1024)
            if gb < 1:
                return f"{gb:.2f}GB"
            return f"{gb:.1f}GB"
        except Exception as e:
            logger.warning(f"Error calculating size for {path}: {e}")
            return "Unknown"

    def _get_model_metadata(self, model_path: Path) -> Dict[str, Any]:
        """
        Extracts metadata from model files.
        Supports: config.json (Transformers), .gguf (Llama.cpp), .safetensors (HF)
        """
        meta = {
            "architecture": "Unknown",
            "context_window": "Unknown",
            "quantization": "Standard",
            "is_vision": False,
        }
        
        # 1. Transformers config.json
        config_path = model_path / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r") as f:
                    config = json.load(f)
                    if not isinstance(config, dict):
                        raise ValueError("config.json is not a JSON object")
                    if "model_type" in config:
                        meta["architecture"] = config["model_type"].capitalize()
                    for key in ["max_position_embeddings", "model_max_length", "n_ctx", "max_sequence_length"]:
                        if key in config:
                            val = config[key]
                            meta["context_window"] = f"{val // 1024}k" if val > 1000 else str(val)
                            break
                    if "quantization" in config:
                        q = config["quantization"]
                        meta["quantization"] = f"{q['bits']}-bit" if isinstance(q, dict) and "bits" in q else str(q)
                    # Vision model detection
                    vision_keys = ["vision_config", "visual", "image_size",
                                   "vision_tower", "mm_projector_type", "visual_encoder"]
                    meta["is_vision"] = any(k in config and config[k] is not None for k in vision_keys)
            except Exception as e:
                logger.debug(f"Failed to parse config.json for {model_path}: {e}")

        # 2. GGUF Parsing (Quick Scanner)
        gguf_files = list(model_path.glob("*.gguf"))
        if gguf_files:
            try:
                # GGUF has a specific binary header. We just peek for the 'GGUF' magic and common keys
                with open(gguf_files[0], "rb") as f:
                    chunk = f.read(1024).decode('utf-8', 'ignore')
                    if "GGUF" in chunk:
                        meta["architecture"] = "GGUF"
                        if "q4_k_m" in chunk.lower(): meta["quantization"] = "Q4_K_M"
                        elif "q8_0" in chunk.lower(): meta["quantization"] = "Q8_0"
            except Exception as e:
                logger.debug(f"Failed to parse GGUF header for {gguf_files[0]}: {e}")

        # 3. Refine by folder/file names
        name_lower = model_path.name.lower()
        if meta["quantization"] == "Standard":
            if "4bit" in name_lower or "q4" in name_lower: meta["quantization"] = "4-bit"
            elif "8bit" in name_lower or "q8" in name_lower: meta["quantization"] = "8-bit"
            elif "fp16" in name_lower: meta["quantization"] = "FP16"

        return meta

    @staticmethod
    def _validate_model_format(model_path: Path) -> str | None:
        """Check if model has MLX-compatible weights. Returns warning message or None."""
        safetensors = list(model_path.glob("*.safetensors"))
        if safetensors:
            return None  # Compatible

        gguf_files = list(model_path.glob("*.gguf"))
        if gguf_files:
            return "GGUF format (Ollama/llama.cpp) — must be converted to MLX safetensors before loading"

        bin_files = list(model_path.glob("*.bin"))
        if bin_files:
            return "PyTorch .bin format — must be converted to MLX safetensors before loading"

        return "No weight files (.safetensors) found — may not be a valid MLX model"

    @staticmethod
    def _estimate_model_size_bytes(model_path: Path) -> int:
        """Estimate model size by summing .safetensors files."""
        total = 0
        for f in model_path.glob("*.safetensors"):
            try:
                total += f.stat().st_size
            except OSError:
                pass
        return total

    def scan_directory(self, path: str, max_depth=4) -> List[Dict[str, Any]]:
        """
        Scans a directory for MLX models and returns a list of found models with metadata.
        Does NOT register them.
        """
        target_path = Path(path).expanduser().resolve()
        if not target_path.exists():
            return []
            
        found_models = []
        
        def _scan(dir_path: Path, depth: int):
            if depth > max_depth:
                return
            
            # Check if this folder is a model
            if (dir_path / "config.json").exists():
                meta = self._get_model_metadata(dir_path)
                found_models.append({
                    "id": str(dir_path),
                    "name": dir_path.name,
                    "path": str(dir_path),
                    "size": "",  # computed lazily on first API request
                    "architecture": meta.get("architecture"),
                    "context_window": meta.get("context_window"),
                    "quantization": meta.get("quantization")
                })
                # Don't recurse into model folders
                return
            
            # Check for GGUF folder (informational)
            if any(dir_path.glob("*.gguf")):
                # We could add GGUF detection here if we want to show them in UI
                pass

            try:
                for child in sorted(list(dir_path.iterdir())):
                    if child.is_dir() and not child.name.startswith('.'):
                        if child.name.lower() in ["node_modules", "venv", ".git", "__pycache__", "site-packages"]:
                            continue
                        _scan(child, depth + 1)
            except PermissionError:
                logger.debug(f"Permission denied scanning: {dir_path}")

        _scan(target_path, 0)
        return found_models

    def register_model(self, name: str, path: str, url: str = ""):
        """
        Registers a custom model from a local path.
        If path is a directory of models, it registers all found models.
        """
        target_path = Path(path).expanduser().resolve()
        if not target_path.exists():
            raise ValueError(f"Directory {path} does not exist.")
            
        # If the path itself is a model, register just it
        if (target_path / "config.json").exists():
            return [self._register_single_path(target_path, name, url)]
            
        # Otherwise scan and register all
        found = self.scan_directory(str(target_path))
        if not found:
             raise ValueError(f"No valid MLX models found in {path}. Make sure the folders contain 'config.json'.")
             
        added = []
        for m in found:
            added.append(self._register_single_path(Path(m["path"]), name, url))
        
        self._save_models_config()
        return added

    def _register_single_path(self, model_path: Path, group_name: str, url: str):
        with self._config_lock:
            # Check if already registered
            for m in self.models_config:
                if m['id'] == str(model_path):
                    return m

            model_name = model_path.name
            size_str = self._get_dir_size_str(model_path)
            meta = self._get_model_metadata(model_path)
            format_warning = self._validate_model_format(model_path)

            new_model = {
                "id": str(model_path),
                "name": f"{group_name} / {model_name}" if group_name and group_name.lower() not in ["", "ollama models", "lm studio models"] else model_name,
                "size": size_str,
                "family": meta.get("architecture", "Custom"),
                "architecture": meta.get("architecture", "Unknown"),
                "context_window": meta.get("context_window", "Unknown"),
                "quantization": meta.get("quantization", "Standard"),
                "url": url,
                "external": False,
                "is_custom": True,
            }
            if format_warning:
                new_model["format_warning"] = format_warning
                logger.warning(f"Model {model_name}: {format_warning}")
            self.models_config.append(new_model)
            return new_model

    async def load_active_model(self, model_id: str, **kwargs):
        """
        Loads a model and tokenizer into active memory, replacing any previously loaded model.
        Includes VRAM cleanup for Apple Silicon.
        """
        if self.generation_lock.locked():
            # A generation may be running — signal it to stop and wait briefly
            self.stop_event.set()
            try:
                await asyncio.wait_for(self.generation_lock.acquire(), timeout=5.0)
                self.generation_lock.release()
            except asyncio.TimeoutError:
                raise RuntimeError("Cannot switch models while generation is in progress")

        async with self.generation_lock:
            await self._load_model_impl(model_id, **kwargs)

    async def _load_model_impl(self, model_id: str, **kwargs):
        """Internal model loading without lock (caller must hold the lock)."""
        if self.active_model_id == model_id and self.active_model and (self.active_tokenizer or self.active_processor):
            logger.info(f"Model {model_id} is already active.")
            return

        # 0. VRAM Cleanup
        if self.active_model:
            logger.info(f"Unloading previous model {self.active_model_id}...")
            self.active_model = None
            self.active_tokenizer = None
            self.active_processor = None
            self.active_is_vision = False
            self.active_model_id = None
            self.active_kv_cache = None
            self.active_kv_cache_id = None
            self.active_kv_bits = None
            gc.collect()
            mx.metal.clear_cache()
            logger.info("VRAM cache cleared.")

        logger.info(f"Loading model: {model_id}")
        
        # 1. Resolve Path
        path_to_load = model_id
        if Path(model_id).is_absolute() and Path(model_id).exists():
             path_to_load = model_id
        else:
            sanitized_name = model_id.replace("/", "--")
            local_path = self.models_dir / sanitized_name
            if (local_path / ".completed").exists() or local_path.exists():
                path_to_load = str(local_path.absolute())
        
        # Final safety check: ensure path is absolute
        p = Path(path_to_load)
        if not p.is_absolute():
            # If not absolute and not found in models_dir, it might be a HuggingFace ID
            # mlx_lm.load handles HF IDs, but we prefer local absolute paths if they exist
            logger.warning(f"Loading via ID or relative path: {path_to_load}")
        else:
            path_to_load = str(p.absolute())

        logger.info(f"Loading from: {path_to_load}")

        # Pre-load validation
        self._load_warning = None
        load_path = Path(path_to_load)

        # Fail early if local path doesn't exist (instead of cryptic HF repo ID error)
        if load_path.is_absolute() and not load_path.exists():
            raise FileNotFoundError(
                f"Model directory not found: {path_to_load}. "
                f"It may have been moved or deleted."
            )

        if load_path.is_absolute() and load_path.is_dir():
            # Check config.json exists
            if not (load_path / "config.json").exists():
                raise FileNotFoundError(
                    f"Model directory missing config.json (download may be incomplete): {path_to_load}"
                )
            # Check weight format compatibility
            fmt_warn = self._validate_model_format(load_path)
            if fmt_warn:
                raise ValueError(f"Incompatible model format: {fmt_warn}")
            # Memory pre-check: block if OOM certain, warn if swap likely
            model_bytes = self._estimate_model_size_bytes(load_path)
            if model_bytes > 0:
                mem = psutil.virtual_memory()
                total = mem.total
                available = mem.available
                # Hard block: model larger than total system RAM
                if model_bytes > total:
                    raise MemoryError(
                        f"Model size ({model_bytes / 1e9:.1f} GB) exceeds total system RAM "
                        f"({total / 1e9:.1f} GB). Loading this model would crash the system."
                    )
                # Hard block: model > available and would use > 90% of total
                if model_bytes > available and (model_bytes / total) > 0.90:
                    raise MemoryError(
                        f"Model size ({model_bytes / 1e9:.1f} GB) exceeds available RAM "
                        f"({available / 1e9:.1f} GB) with only {total / 1e9:.1f} GB total. "
                        f"Loading would likely cause a kernel panic."
                    )
                # Warn: swap likely
                if model_bytes > available * 0.8:
                    self._load_warning = (
                        f"Model size ({model_bytes / 1e9:.1f} GB) exceeds available RAM "
                        f"({available / 1e9:.1f} GB) — heavy swap expected, system may become slow"
                    )
                    logger.warning(self._load_warning)

        # Detect vision model from config.json
        is_vision = False
        config_file = Path(path_to_load) / "config.json"
        if config_file.exists():
            try:
                with open(config_file, "r") as f:
                    cfg = json.load(f)
                if isinstance(cfg, dict):
                    vision_keys = ["vision_config", "visual", "image_size",
                                   "vision_tower", "mm_projector_type", "visual_encoder"]
                    is_vision = any(k in cfg and cfg[k] is not None for k in vision_keys)
            except Exception:
                pass

        loop = asyncio.get_running_loop()
        kv_quant_bits = kwargs.get("kv_quantization") # 4 or 8
        
        try:
            if is_vision:
                try:
                    from mlx_vlm import load as vlm_load
                except ImportError:
                    raise ImportError(
                        "mlx-vlm is required for vision models but not installed. "
                        "Install it with: pip install 'silicon-studio-backend[vision]' "
                        "or: pip install mlx-vlm"
                    )
                _patch_transformers_vlm_compat()
                logger.info(f"Loading vision model via mlx-vlm: {model_id}")
                model, processor = await loop.run_in_executor(None, vlm_load, path_to_load)
                self.active_model = model
                self.active_tokenizer = None
                self.active_processor = processor
                self.active_is_vision = True
            else:
                # Support KV Quantization for memory efficiency
                if kv_quant_bits in (4, 8):
                    logger.info(f"KV Cache Quantization enabled: {kv_quant_bits}-bit (applied at generation time)")
                    self.active_kv_bits = kv_quant_bits
                else:
                    self.active_kv_bits = None

                model, tokenizer = await loop.run_in_executor(
                    None,
                    lambda: load(path_to_load)
                )
                self.active_model = model
                self.active_tokenizer = tokenizer
                self.active_processor = None
                self.active_is_vision = False

            self.active_model_id = model_id
            logger.info(f"Model {model_id} loaded and set as active (vision={is_vision}).")

            # Post-load memory pressure check
            mem = psutil.virtual_memory()
            if mem.percent > 85:
                self._load_warning = (
                    f"High memory pressure after loading ({mem.percent:.0f}% used). "
                    f"System may be slow due to swapping."
                )
                logger.warning(self._load_warning)
        except (MemoryError, Exception) as e:
            if isinstance(e, MemoryError):
                logger.warning(f"OOM detected during load of {model_id}. Unloading everything and retrying...")
                self.active_model = None
                self.active_tokenizer = None
                self.active_processor = None
                self.active_model_id = None
                gc.collect()
                mx.metal.clear_cache()
                
                # One-time retry after cleanup
                try:
                    if is_vision:
                        model, processor = await loop.run_in_executor(None, vlm_load, path_to_load)
                        self.active_model = model
                        self.active_processor = processor
                        self.active_is_vision = True
                    else:
                        model, tokenizer = await loop.run_in_executor(None, load, path_to_load)
                        self.active_model = model
                        self.active_tokenizer = tokenizer
                        self.active_is_vision = False
                    self.active_model_id = model_id
                    return
                except Exception as retry_e:
                    logger.error(f"OOM Retry failed for {model_id}: {retry_e}")
                    raise retry_e

            # Reset state so we don't appear to have a loaded model
            self.active_model_id = None
            self.active_model = None
            self.active_tokenizer = None
            self.active_processor = None
            self.active_is_vision = False
            logger.error(f"Failed to load model {model_id}: {e}")
            raise

    def get_active_model_metadata(self) -> Dict[str, Any]:
        """Returns metadata for the currently loaded model, including numeric context_window."""
        if not self.active_model_id:
            return {}
        # Find model in config
        for m in self.models_config:
            if m["id"] == self.active_model_id:
                cw_str = m.get("context_window", "Unknown")
                cw_num = None
                if cw_str and cw_str != "Unknown":
                    match = re.match(r"^(\d+)k$", cw_str, re.IGNORECASE)
                    if match:
                        cw_num = int(match.group(1)) * 1024
                    else:
                        try:
                            cw_num = int(cw_str)
                        except ValueError:
                            pass
                result: Dict[str, Any] = {
                    "context_window": cw_num,
                    "architecture": m.get("architecture"),
                    "quantization": m.get("quantization"),
                    "is_vision": m.get("is_vision", False),
                }
                if self._load_warning:
                    result["warning"] = self._load_warning
                    self._load_warning = None
                return result
        return {}

    async def unload_model(self):
        """Explicitly unload the active model and free VRAM."""
        async with self.generation_lock:
            if self.active_model:
                logger.info(f"Unloading model {self.active_model_id}...")
                self.active_model = None
                self.active_tokenizer = None
                self.active_processor = None
                self.active_is_vision = False
                self.active_model_id = None
                self.active_kv_cache = None
                self.active_kv_cache_id = None
                self.active_kv_bits = None
                gc.collect()
                mx.metal.clear_cache()
                logger.info("Model unloaded and VRAM cache cleared.")
            else:
                logger.info("No model currently loaded.")

    def stop_generation(self):
        """Sets the stop event to interrupt MLX generation."""
        self.stop_event.set()
        logger.info("Stop signal sent to generation loop.")

    def _extract_vision_content(self, messages: list) -> tuple:
        """
        Parse messages with OpenAI-style content parts.
        Returns (image_file_paths, text_messages).

        Handles both:
        - content: str  (text only, legacy)
        - content: list[{type: "text", text: "..."}, {type: "image_url", image_url: {url: "data:..."}}]
        """
        image_paths = []
        text_messages = []

        for msg in messages:
            content = msg.get("content", "")
            role = msg.get("role", "user")

            if isinstance(content, str):
                text_messages.append({"role": role, "content": content})
            elif isinstance(content, list):
                msg_text = ""
                for part in content:
                    if isinstance(part, dict):
                        if part.get("type") == "text":
                            msg_text += part.get("text", "")
                        elif part.get("type") == "image_url":
                            url = ""
                            image_url = part.get("image_url")
                            if isinstance(image_url, dict):
                                url = image_url.get("url", "")
                            elif isinstance(image_url, str):
                                url = image_url
                            if url.startswith("data:"):
                                path = self._save_base64_image(url)
                                if path:
                                    image_paths.append(path)
                text_messages.append({"role": role, "content": msg_text})
            else:
                text_messages.append({"role": role, "content": str(content)})

        return image_paths, text_messages

    @staticmethod
    def _save_base64_image(data_url: str) -> str | None:
        """Decode a data: URL to a temp file, return the file path."""
        import base64
        try:
            header, b64data = data_url.split(",", 1)
            # Extract extension from mime type: "data:image/png;base64" → "png"
            mime = header.split(":")[1].split(";")[0] if ":" in header else "image/png"
            ext = mime.split("/")[1] if "/" in mime else "png"
            if ext not in ("png", "jpg", "jpeg", "gif", "webp", "bmp"):
                ext = "png"

            img_bytes = base64.b64decode(b64data)
            fd, path = tempfile.mkstemp(suffix=f".{ext}", prefix="silicon_vlm_")
            with os.fdopen(fd, "wb") as f:
                f.write(img_bytes)
            return path
        except Exception as e:
            logger.error(f"Failed to decode base64 image: {e}")
            return None

    @staticmethod
    def _flatten_messages_to_text(messages: list) -> list:
        """
        Ensure all message content is plain strings.
        Extracts text from multipart content, ignores images.
        """
        flat = []
        for msg in messages:
            content = msg.get("content", "")
            role = msg.get("role", "user")
            if isinstance(content, str):
                flat.append({"role": role, "content": content})
            elif isinstance(content, list):
                text_parts = []
                for part in content:
                    if isinstance(part, dict) and part.get("type") == "text":
                        text_parts.append(part.get("text", ""))
                flat.append({"role": role, "content": " ".join(text_parts)})
            else:
                flat.append({"role": role, "content": str(content)})
        return flat

    def _run_scout_agent(self):
        """Runs the ScoutAgent in a separate thread with its own event loop."""
        # Simple placeholder for workspace path
        current_workspace = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        scout = ScoutAgent(workspace_path=current_workspace)
        
        # We need a new event loop for this thread
        loop = asyncio.new_event_loop()
        asyncio.set_event_loop(loop)
        try:
            logger.info("Scout Agent thread starting...")
            loop.run_until_complete(scout.start())
            # Keep event loop running until the scout's background task completes
            if hasattr(scout, '_task'):
                loop.run_until_complete(scout._task)
        except Exception as e:
            logger.error(f"ScoutAgent thread failed: {e}")
        finally:
            loop.close()

    async def generate_response(self, model_id: str, messages: list, **kwargs):
        """Standard non-streaming generation for internal tools like Swarm."""
        self.last_active = time.time()
        # Ensure model is matched/loaded
        async with self.generation_lock:
            try:
                # 1. Ensure model is loaded
                if self.active_model_id != model_id:
                    await self._load_model_impl(model_id)
                
                model = self.active_model
                tokenizer = self.active_tokenizer
                processor = self.active_processor
                is_vision = self.active_is_vision

                if not model or not (tokenizer or processor):
                    raise RuntimeError("Model not loaded")

                # Common generation parameters
                temp = kwargs.get("temperature", 0.7)
                if temp < 0.01:
                    temp = 0.01
                max_tokens = kwargs.get("max_tokens", 512)
                top_p = kwargs.get("top_p", 0.9)
                repetition_penalty = kwargs.get("repetition_penalty", 1.1)
                seed = kwargs.get("seed")
                if seed is not None:
                    mx.random.seed(int(seed))

                # Reset Stop Event
                self.stop_event.clear()

                loop = asyncio.get_running_loop()

                if is_vision:
                    # ── Vision model path (mlx-vlm) ──
                    image_paths, text_messages = self._extract_vision_content(messages)

                    try:
                        from mlx_vlm import generate as vlm_generate
                        from mlx_vlm.prompt_utils import get_message_json, get_chat_template

                        # Build the text prompt from the last user message
                        last_text = ""
                        for msg in reversed(text_messages):
                            if msg.get("role") == "user":
                                last_text = msg.get("content", "")
                                break

                        model_type = getattr(model.config, "model_type", "")
                        vlm_messages = [get_message_json(model_type, last_text, num_images=len(image_paths))]

                        _vlm_enable_thinking = False # Small models produce garbled output
                        try:
                            formatted_prompt = get_chat_template(
                                processor, vlm_messages, True,
                                enable_thinking=_vlm_enable_thinking,
                            )
                        except TypeError:
                            formatted_prompt = get_chat_template(
                                processor, vlm_messages, True,
                            )

                        vlm_top_p = 0.8 if top_p == 0.9 else top_p
                        vlm_rep_penalty = repetition_penalty if repetition_penalty and repetition_penalty > 1.0 else 1.15

                        response_text = await loop.run_in_executor(
                            None,
                            lambda: vlm_generate(
                                model, processor, formatted_prompt,
                                image=image_paths if image_paths else None,
                                max_tokens=max_tokens,
                                temperature=temp,
                                top_p=vlm_top_p,
                                repetition_penalty=vlm_rep_penalty,
                                repetition_context_size=64,
                            )
                        )
                        return {"text": response_text}

                    finally:
                        for p in image_paths:
                            try:
                                os.unlink(p)
                            except OSError:
                                pass

                else:
                    # ── Text-only model path (mlx-lm) ──
                    has_images = any(
                        isinstance(m.get("content"), list)
                        and any(p.get("type") == "image_url" for p in m["content"] if isinstance(p, dict))
                        for m in messages
                    )
                    if has_images:
                        logger.warning("Images received but active model is text-only. Ignoring images.")

                    # Use the same logic as generate_stream for text-only models
                    # to prepare the prompt and call the generate function.
                    # This avoids code duplication for prompt formatting.
                    # The actual generation call will be non-streaming.
                    from mlx_lm import generate as lm_generate
                    from mlx_lm.utils import get_model_path, load, generate_step, get_chat_template

                    model_path = get_model_path(self.active_model_id)
                    model_config = self.active_model.config
                    
                    # Detect model's max context from config
                    max_context_window = getattr(model_config, "max_sequence_length", 2048)
                    if max_context_window == 0: # Some models have 0, use a sensible default
                        max_context_window = 2048

                    # Apply chat template
                    chat_template = getattr(model_config, "chat_template", None)
                    if chat_template is None and hasattr(tokenizer, "chat_template"):
                        chat_template = tokenizer.chat_template

                    if chat_template is None:
                        # Fallback to default if no template is found
                        logger.warning(f"No chat template found for model {self.active_model_id}. Using default.")
                        formatted_prompt = tokenizer.apply_chat_template(
                            messages, tokenize=False, add_generation_prompt=True
                        )
                    else:
                        formatted_prompt = tokenizer.apply_chat_template(
                            messages, tokenize=False, add_generation_prompt=True, chat_template=chat_template
                        )

                    # Tokenize the input
                    input_ids = tokenizer.encode(formatted_prompt, add_special_tokens=False)
                    
                    # Truncate if too long
                    if len(input_ids) > max_context_window - max_tokens:
                        input_ids = input_ids[-(max_context_window - max_tokens):]
                        logger.warning(f"Truncated input from {len(input_ids) + max_tokens} to {max_context_window} tokens.")

                    # Generate
                    response_text = await loop.run_in_executor(
                        None,
                        lambda: lm_generate(
                            model,
                            tokenizer,
                            input_ids,
                            temp=temp,
                            max_tokens=max_tokens,
                            top_p=top_p,
                            repetition_penalty=repetition_penalty,
                            repetition_context_size=64,
                            stop_event=self.stop_event,
                        )
                    )
                    return {"text": response_text}

            except Exception as e:
                logger.error(f"Error during non-streaming generation for {model_id}: {e}")
                raise

    async def generate_stream(self, model_id: str, messages: list, **kwargs):
        """
        Token-by-token streaming inference via SSE.
        """
        async with self.generation_lock:
            try:
                # 1. Ensure model is loaded
                if self.active_model_id != model_id:
                    await self._load_model_impl(model_id)
                
                model = self.active_model
                tokenizer = self.active_tokenizer
                processor = self.active_processor
                is_vision = self.active_is_vision

                if not model or not (tokenizer or processor):
                    yield {"error": "Model not loaded"}
                    return

                # Memory pressure warning at generation start
                mem = psutil.virtual_memory()
                if mem.percent > 85:
                    yield {
                        "warning": f"High memory usage ({mem.percent:.0f}%). Generation may be slow.",
                        "done": False,
                    }

                # Common generation parameters
                temp = kwargs.get("temperature", 0.7)
                if temp < 0.01:
                    temp = 0.01
                max_tokens = kwargs.get("max_tokens", 512)
                top_p = kwargs.get("top_p", 0.9)
                repetition_penalty = kwargs.get("repetition_penalty", 1.1)
                seed = kwargs.get("seed")
                if seed is not None:
                    mx.random.seed(int(seed))

                # Reset Stop Event
                self.stop_event.clear()

                loop = asyncio.get_running_loop()

                # Sentinel for async iteration
                _SENTINEL = object()

                def _next_token(gen):
                    try:
                        return next(gen)
                    except StopIteration:
                        return _SENTINEL

                if is_vision:
                    # ── Vision model path (mlx-vlm) ──
                    image_paths, text_messages = self._extract_vision_content(messages)

                    try:
                        from mlx_vlm import stream_generate as vlm_stream_generate
                        from mlx_vlm.prompt_utils import get_message_json, get_chat_template

                        # Build the text prompt from the last user message
                        last_text = ""
                        for msg in reversed(text_messages):
                            if msg.get("role") == "user":
                                last_text = msg.get("content", "")
                                break

                        model_type = getattr(model.config, "model_type", "")
                        vlm_messages = [get_message_json(model_type, last_text, num_images=len(image_paths))]

                        # Disable thinking for VLM — small models (0.8B-8B)
                        # produce garbled output with enable_thinking=True.
                        # Qwen3.5 recommended non-thinking VL params:
                        # temperature=0.7, top_p=0.80, presence_penalty=1.5
                        _vlm_enable_thinking = False
                        try:
                            formatted_prompt = get_chat_template(
                                processor, vlm_messages, True,
                                enable_thinking=_vlm_enable_thinking,
                            )
                        except TypeError:
                            # Older mlx-vlm without enable_thinking param
                            formatted_prompt = get_chat_template(
                                processor, vlm_messages, True,
                            )

                        _thinking_active = _vlm_enable_thinking and formatted_prompt.rstrip().endswith("<think>")
                        _think_budget = min(max(256, len(last_text.split()) * 8), 2048)

                        def _vlm_generate_iter():
                            first = True
                            token_count = 0
                            accumulated = ""
                            content_after_think = ""
                            suppressing = False
                            think_done = not _thinking_active

                            # Qwen3.5 recommended VL non-thinking params.
                            # presence_penalty not available in mlx-vlm,
                            # use repetition_penalty as substitute.
                            vlm_top_p = 0.8 if top_p == 0.9 else top_p  # default 0.8 for VL
                            vlm_rep_penalty = repetition_penalty if repetition_penalty and repetition_penalty > 1.0 else 1.15

                            for response in vlm_stream_generate(
                                model, processor, formatted_prompt,
                                image=image_paths if image_paths else None,
                                max_tokens=max_tokens,
                                temperature=temp,
                                top_p=vlm_top_p,
                                repetition_penalty=vlm_rep_penalty,
                                repetition_context_size=64,
                            ):
                                if self.stop_event.is_set():
                                    break
                                text = response.text
                                token_count += 1
                                accumulated += text

                                if first and _thinking_active:
                                    text = "<think>" + text
                                    first = False

                                # Model closed thinking naturally
                                if not think_done and "</think>" in accumulated:
                                    think_done = True
                                    suppressing = False
                                    yield text
                                    continue

                                # Budget exceeded — close thinking for frontend, suppress rest
                                if not think_done and token_count > _think_budget and not suppressing:
                                    yield "</think>\n"
                                    suppressing = True
                                    continue

                                # Suppress excess thinking tokens until model
                                # emits </think>.  If it takes too long, stop
                                # waiting and yield whatever comes next as content.
                                if suppressing:
                                    if token_count > _think_budget * 3:
                                        think_done = True
                                        suppressing = False
                                        # fall through to yield
                                    else:
                                        continue

                                yield text

                                # Track content after thinking for repetition detection
                                if think_done:
                                    content_after_think += text
                                    # Check for repetition: if a 80+ char block repeats
                                    clen = len(content_after_think)
                                    if clen >= 200:
                                        window = min(100, clen // 2)
                                        if content_after_think[-window:] == content_after_think[-2 * window:-window]:
                                            logger.warning("VLM repetition loop detected after %d content chars, stopping.", clen)
                                            break

                            # Model finished without closing thinking —
                            # close it so the frontend gets a proper block.
                            if not think_done:
                                yield "</think>\n"

                        gen = _vlm_generate_iter()
                        try:
                            while True:
                                token_text = await loop.run_in_executor(None, _next_token, gen)
                                if token_text is _SENTINEL:
                                    break
                                yield {"text": token_text, "done": False}
                        finally:
                            self.stop_event.set()
                            try:
                                gen.close()
                            except ValueError:
                                pass  # generator still running in executor thread
                            # Clean up temp image files
                            for p in image_paths:
                                try:
                                    os.unlink(p)
                                except OSError:
                                    pass

                    except ImportError:
                        yield {"error": "mlx-vlm is required for vision models. Install with: pip install mlx-vlm"}
                        return

                else:
                    # ── Text-only model path (mlx-lm) ──

                    # Warn if images were sent to a text-only model
                    has_images = any(
                        isinstance(m.get("content"), list)
                        and any(p.get("type") == "image_url" for p in m["content"] if isinstance(p, dict))
                        for m in messages
                    )
                    if has_images:
                        logger.warning("Images received but active model is text-only. Ignoring images.")
                        yield {
                            "warning": "This model does not support images. Text-only response.",
                            "done": False,
                        }

                    # Detect model's max context from config
                    max_ctx = None
                    for m in self.models_config:
                        if m["id"] == model_id:
                            cw = m.get("context_window", "")
                            if cw and cw != "Unknown":
                                match = re.match(r"^(\d+)k$", str(cw), re.IGNORECASE)
                                if match:
                                    max_ctx = int(match.group(1)) * 1024
                                else:
                                    try:
                                        max_ctx = int(cw)
                                    except ValueError:
                                        pass
                            break

                    # Prepare prompt with chat template
                    # For text-only path, flatten any multipart content to strings
                    flat_messages = self._flatten_messages_to_text(messages)

                    if hasattr(tokenizer, "apply_chat_template"):
                        try:
                            prompt = tokenizer.apply_chat_template(flat_messages, tokenize=False, add_generation_prompt=True)
                        except Exception:
                            # Fallback: raw ChatML format
                            parts = []
                            for msg in flat_messages:
                                role = msg.get("role", "user")
                                content = msg.get("content", "")
                                parts.append(f"<|im_start|>{role}\n{content}<|im_end|>")
                            parts.append("<|im_start|>assistant\n")
                            prompt = "\n".join(parts)
                    else:
                        prompt = flat_messages[-1]['content']

                    # Truncate if prompt exceeds model context (FIFO: drop oldest messages)
                    if max_ctx and max_ctx > 0:
                        reserve_tokens = max_tokens
                        prompt_limit = max_ctx - reserve_tokens
                        if prompt_limit < 128:
                            prompt_limit = 128
                        token_count = len(tokenizer.encode(prompt))
                        if token_count > prompt_limit:
                            logger.warning(
                                f"Prompt ({token_count} tokens) exceeds context limit "
                                f"({max_ctx}) minus reserve ({reserve_tokens}). Truncating."
                            )
                            trimmed = list(flat_messages)
                            while len(trimmed) > 1:
                                trimmed.pop(0)
                                if hasattr(tokenizer, "apply_chat_template"):
                                    try:
                                        prompt = tokenizer.apply_chat_template(
                                            trimmed, tokenize=False, add_generation_prompt=True
                                        )
                                    except Exception:
                                        prompt = trimmed[-1].get("content", "")
                                else:
                                    prompt = trimmed[-1].get("content", "")
                                if len(tokenizer.encode(prompt)) <= prompt_limit:
                                    break

                    # Stream Generation
                    def _generate_iter():
                        from mlx_lm import stream_generate
                        from mlx_lm.sample_utils import make_sampler, make_logits_processors

                        sampler = make_sampler(temp=temp, top_p=top_p)
                        logits_processors = make_logits_processors(repetition_penalty=repetition_penalty)

                        # Prefix Caching Logic
                        prompt_tokens = tokenizer.encode(prompt)
                        
                        # We use the system prompt or head-tier as prefix (Tier 0 + Tier 1)
                        # HierarchicalContextManager uses [system, repo_map, ...]
                        # Let's try to match a reasonable prefix (e.g. first 2048 tokens or first few messages)
                        # Simpler: persistent cache across turns if the start matches.
                        
                        from mlx_lm.models.cache import make_prompt_cache, trim_prompt_cache

                        if not self.active_kv_cache:
                            self.active_kv_cache = make_prompt_cache(model)
                            self.active_kv_cache_id = []

                        # Find common prefix length
                        common_len = 0
                        for i in range(min(len(prompt_tokens), len(self.active_kv_cache_id))):
                            if prompt_tokens[i] == self.active_kv_cache_id[i]:
                                common_len += 1
                            else:
                                break

                        # Rewind cache to common prefix
                        if common_len < len(self.active_kv_cache_id):
                            tokens_to_trim = len(self.active_kv_cache_id) - common_len
                            logger.info(f"Prefix mismatch. Trimming {tokens_to_trim} tokens from cache (target: {common_len})")
                            trim_prompt_cache(self.active_kv_cache, tokens_to_trim)
                            self.active_kv_cache_id = prompt_tokens[:common_len]
                        
                        if common_len > 0:
                            logger.info(f"Prefix hit! Reusing {common_len} tokens from KV Cache.")

                        gen_kwargs = {}
                        if self.active_kv_bits in (4, 8):
                            gen_kwargs["kv_bits"] = self.active_kv_bits

                        for response in stream_generate(
                            model,
                            tokenizer,
                            prompt=prompt_tokens,
                            max_tokens=max_tokens,
                            sampler=sampler,
                            logits_processors=logits_processors,
                            prompt_cache=self.active_kv_cache,
                            **gen_kwargs
                        ):
                            if self.stop_event.is_set():
                                break
                            
                            # Note: stream_generate updates the cache in place
                            yield response.text
                        
                        # Update current cache state
                        if not self.stop_event.is_set():
                             # We only cache the prompt for now, or extending it?
                             # Usually we cache the prompt + the generated answer for next turn.
                             # But for SiliconDev, we often have new tool results injected between turns.
                             # So we cache up to the end of the prompt for the next hit.
                             self.active_kv_cache_id = prompt_tokens
                             # Note: If memory pressure is high, we might want to clear it.

                    gen = _generate_iter()
                    try:
                        while True:
                            token_text = await loop.run_in_executor(None, _next_token, gen)
                            if token_text is _SENTINEL:
                                break
                            yield {"text": token_text, "done": False}
                    finally:
                        self.stop_event.set()
                        try:
                            gen.close()
                        except ValueError:
                            pass  # generator still running in executor thread

                yield {"text": "", "done": True}
                
                # Phase 9: Dynamic KV-Cache Cleansing
                # After generation, we ensure VRAM is released and GC is triggered.
                gc.collect()
                mx.metal.clear_cache()

            except Exception as e:
                logger.error(f"Streaming error: {e}")
                yield {"error": str(e)}

    async def generate_response(self, model_id: str, messages: list, **kwargs) -> Dict[str, Any]:
        """
        Legacy wrapper for generate_stream to return a full object.
        """
        full_text = ""
        async for chunk in self.generate_stream(model_id, messages, **kwargs):
            if "text" in chunk:
                full_text += chunk["text"]
        return {"role": "assistant", "content": full_text}

    async def start_finetuning(self, job_id: str, config: Dict[str, Any]):
        job_name = config.get("job_name", "")
        logger.debug(f"SERVICE: start_finetuning job_name='{job_name}' for job_id={job_id}")
        with self._jobs_lock:
            self.active_jobs[job_id] = {
                "status": "starting",
                "progress": 0,
                "job_name": job_name,
                "job_id": job_id
            }
        
        # Spawn a thread for training so we don't block the API
        thread = threading.Thread(target=self._run_training_job, args=(job_id, config))
        thread.start()
        
        return {"job_id": job_id, "status": "started", "job_name": job_name}

    def _run_training_job(self, job_id: str, config: Dict):
        """
        Executed in a separate thread.
        """
        try:
            with self._jobs_lock:
                self.active_jobs[job_id]["status"] = "training"
            model_id = config.get("model_id")
            dataset_path = config.get("dataset_path")

            # Block fine-tuning for vision models (mlx_lm LoRA doesn't support vision_tower)
            model_path = Path(model_id)
            if not model_path.is_absolute():
                sanitized = model_id.replace("/", "--")
                model_path = self.models_dir / sanitized
            config_file = model_path / "config.json"
            if config_file.exists():
                try:
                    with open(config_file, "r") as f:
                        cfg = json.load(f)
                    if isinstance(cfg, dict):
                        vision_keys = ["vision_config", "visual", "image_size",
                                       "vision_tower", "mm_projector_type", "visual_encoder"]
                        if any(k in cfg and cfg[k] is not None for k in vision_keys):
                            raise ValueError(
                                "Fine-tuning vision models is not yet supported. "
                                "LoRA training requires a text-only model."
                            )
                except (json.JSONDecodeError, ValueError) as e:
                    if "Fine-tuning vision models" in str(e):
                        raise
                    pass

            # Pre-check: reject datasets that would OOM when loaded into RAM
            _MAX_DATASET_MB = 500  # 500 MB limit for in-memory loading
            try:
                ds_size = os.path.getsize(dataset_path)
                ds_mb = ds_size / (1024 * 1024)
                if ds_mb > _MAX_DATASET_MB:
                    raise ValueError(
                        f"Dataset too large ({ds_mb:.0f} MB). "
                        f"Maximum supported size is {_MAX_DATASET_MB} MB. "
                        f"Split the file into smaller chunks."
                    )
            except OSError as e:
                raise ValueError(f"Cannot read dataset: {e}")

            epochs = int(config.get("epochs", 3))
            lr = float(config.get("learning_rate", 1e-4))
            
            # New Params
            batch_size = int(config.get("batch_size", 1))
            lora_rank = int(config.get("lora_rank", 8))
            lora_alpha = float(config.get("lora_alpha", 16))
            max_seq_length = int(config.get("max_seq_length", 512))
            lora_dropout = float(config.get("lora_dropout", 0.0))
            lora_layers = int(config.get("lora_layers", 8))
            seed = config.get("seed")
            if seed is not None:
                mx.random.seed(int(seed))

            # Safety clamp: limit max_seq_length based on available unified memory
            mem_gb = psutil.virtual_memory().total / (1024 ** 3)
            if mem_gb <= 8:
                max_safe_seq = 512
            elif mem_gb <= 16:
                max_safe_seq = 2048
            elif mem_gb <= 32:
                max_safe_seq = 4096
            else:
                max_safe_seq = 8192
            if max_seq_length > max_safe_seq:
                logger.warning(
                    f"Clamping max_seq_length from {max_seq_length} to {max_safe_seq} "
                    f"({mem_gb:.0f} GB unified memory)"
                )
                max_seq_length = max_safe_seq

            # Create dedicated directory for this job
            job_adapter_dir = self.adapters_dir / job_id
            job_adapter_dir.mkdir(parents=True, exist_ok=True)

            # Pre-flight: check disk space before training
            _check_disk_space(job_adapter_dir)
            
            adapter_file = job_adapter_dir / "adapters.safetensors"

            logger.info(f"Starting training job {job_id} for model {model_id}...")
            logger.info(f"Params: Epochs={epochs}, BS={batch_size}, Rank={lora_rank}, Alpha={lora_alpha}, LR={lr}, Dropout={lora_dropout}")

            # 1. Load Model (fresh load for training recommended to avoid state issues)
            # For efficiency we could reuse, but freezing/lora modification happens in-place.
            # RENAME config -> model_config to avoid shadowing the function argument 'config'
            model, tokenizer, model_config = load(model_id, return_config=True)
            
            # Freeze the base model
            model.freeze()

            # 2. Setup Training Arguments
            from mlx_lm.tuner.datasets import load_local_dataset, CacheDataset

            # Fix: load_local_dataset expects a directory containing 'train.jsonl'.
            # It ignores the filename of dataset_path if we just pass the parent directory.
            # We must create a temporary directory for this job and copy the user's file to 'train.jsonl' there.
            
            job_data_dir = job_adapter_dir / "data"
            job_data_dir.mkdir(exist_ok=True, parents=True)
            
            target_train_path = job_data_dir / "train.jsonl"
            try:
                shutil.copy(dataset_path, target_train_path)
                logger.info(f"Staged dataset {dataset_path} to {target_train_path}")
            except Exception as e:
                logger.error(f"Error copying dataset: {e}")
                # Fallback? No, likely fatal.
            
            # Note: load_local_dataset returns (train, val, test) tuple
            train_set, val_set, test_set = load_local_dataset(job_data_dir, tokenizer, model_config)
            
            # --- FIX FOR EMPTY VALIDATION SET ---
            # If user provides only train.jsonl, val_set is empty list. Train loop crashes.
            if len(val_set) == 0:
                logger.info("Validation set empty. Splitting train set...")
                # Access raw data: load_local_dataset returns [ChatDataset(...), ...]
                # ChatDataset wraps a list in self._data
                if hasattr(train_set, "_data"):
                    raw_data = train_set._data
                else:
                    raw_data = train_set # Fallback if list
                
                # Split logic
                if len(raw_data) > 1:
                    split_idx = int(len(raw_data) * 0.9)
                    if split_idx == len(raw_data): split_idx = len(raw_data) - 1
                    
                    train_raw = raw_data[:split_idx]
                    val_raw = raw_data[split_idx:]
                    
                    # Re-create datasets
                    from mlx_lm.tuner.datasets import create_dataset
                    train_set = create_dataset(train_raw, tokenizer, model_config)
                    val_set = create_dataset(val_raw, tokenizer, model_config)
                else:
                    # Too small to split, duplicate
                    logger.info("Train set too small (<=1). Duplicating for validation.")
                    # Note: Using same object might cause issues if modified? Safe to reuse for MVP
                    train_set = train_set
                    val_set = train_set 

            # IMPORTANT: ChatDataset returns raw dicts. Trainer expects processed tuples.
            # We must wrap them in CacheDataset which calls .process()
            train_set = CacheDataset(train_set)
            val_set = CacheDataset(val_set)
            
            # Calculate total iterations
            # Steps per epoch = len(train_set) / batch_size
            steps_per_epoch = len(train_set) // batch_size
            if steps_per_epoch < 1: steps_per_epoch = 1
            total_iters = steps_per_epoch * epochs
            
            logger.info(f"Training Plan: {len(train_set)} samples, {steps_per_epoch} steps/epoch, {total_iters} total iters.")

            args = TrainingArgs(
                batch_size=batch_size, 
                iters=total_iters, 
                adapter_file=str(adapter_file),
                max_seq_length=max_seq_length
            )

            # Define a callback class to update progress
            class ProgressCallback:
                def on_train_loss_report(self_, train_info):
                    if "iteration" in train_info:
                        step = train_info["iteration"]
                        prog = int((step / args.iters) * 100)
                        with self._jobs_lock:
                            self.active_jobs[job_id]["progress"] = prog

                def on_val_loss_report(self_, val_info):
                    pass

            progress_callback = ProgressCallback()

            # 3. Run Training
            # Note: mlx_lm.tuner.train signature: 
            # train(model, optimizer, train_dataset, val_dataset, args, training_callback=...)
            
            # We need to construction the optimizer
            import mlx.optimizers as optim
            optimizer = optim.Adam(learning_rate=lr)
            
            # We need to convert to LoRA
            from mlx_lm.tuner.utils import linear_to_lora_layers

            # Define LoRA config
            # Use user-defined layers count
            
            lora_config = {
                "rank": lora_rank,
                "alpha": lora_alpha,
                "scale": float(lora_alpha / lora_rank), # alpha / rank
                "dropout": lora_dropout,
                "keys": ["self_attn.q_proj", "self_attn.v_proj"], # Common keys for LoRA
                "num_layers": lora_layers # User defined
            }
            
            # Note: num_layers=N means adapt the last N layers
            # linear_to_lora_layers modifies model in-place and returns None!
            linear_to_lora_layers(model, lora_config["num_layers"], lora_config)
            
            logger.info("Model converted to LoRA.")

            train(
                model=model,
                optimizer=optimizer,
                train_dataset=train_set,
                val_dataset=val_set,
                args=args,
                training_callback=progress_callback
            )

            with self._jobs_lock:
                self.active_jobs[job_id]["status"] = "completed"
                self.active_jobs[job_id]["model_path"] = str(adapter_file)
                self.active_jobs[job_id]["progress"] = 100
            
            # --- Auto-Register Fine-Tuned Model ---
            job_name = config.get("job_name")
            if not job_name or not job_name.strip():
                job_name = f"Fine-Tune {job_id[:8]}"
            
            # --- SAVE METADATA TO ADAPTER DIR (User Request) ---
            metadata_path = job_adapter_dir / "metadata.json"
            metadata = {
                "job_name": job_name,
                "job_id": job_id,
                "base_model": model_id,
                "params": config
            }
            
            # --- SAVE ADAPTER CONFIG (Required for Inference) ---
            adapter_config_path = job_adapter_dir / "adapter_config.json"
            
            # Enrich lora_config with base model info
            base_model_type = "llama" # Default
            if hasattr(model_config, "model_type"):
                base_model_type = model_config.model_type
            elif isinstance(model_config, dict) and "model_type" in model_config:
                base_model_type = model_config["model_type"]

            # MLX-LM expects a specific structure for adapter config
            # Based on errors: needs 'num_layers' and 'lora_parameters'
            final_adapter_config = {
                "num_layers": lora_config["num_layers"],
                "model_type": base_model_type,
                "base_model_name_or_path": model_id,
                "lora_parameters": {
                    "rank": lora_config["rank"],
                    "alpha": lora_config["alpha"],
                    "scale": lora_config["scale"],
                    "dropout": lora_config["dropout"],
                    "keys": lora_config["keys"]
                }
            }

            try:
                # Save metadata
                with open(metadata_path, 'w') as f:
                    json.dump(metadata, f, indent=4)
                    
                # Save adapter config
                with open(adapter_config_path, 'w') as f:
                    json.dump(final_adapter_config, f, indent=4)
                    
            except Exception as e:
                logger.error(f"Failed to save metadata or adapter config: {e}")

            ft_model_entry = {
                "id": f"ft-{job_id}", # Unique ID for the fine-tuned model
                "name": job_name,
                "base_model": model_id,
                "adapter_path": str(job_adapter_dir), # Point to directory for MLX load
                "size": "Adapter", # Or calculate size?
                "family": "Custom",
                "is_custom": True,
                "is_finetuned": True,
                "params": {
                    "epochs": epochs,
                    "batch_size": batch_size,
                    "lora_rank": lora_rank,
                    "lora_alpha": lora_alpha,
                    "learning_rate": lr,
                    "max_seq_len": max_seq_length,
                    "dropout": lora_dropout,
                    "lora_layers": lora_layers
                }
            }
            with self._config_lock:
                self.models_config.append(ft_model_entry)
                self._save_models_config()
            logger.info(f"Registered fine-tuned model: {ft_model_entry['name']}")

        except Exception as e:
            logger.error(f"Training failed: {e}", exc_info=True)
            with self._jobs_lock:
                self.active_jobs[job_id]["status"] = "failed"
                self.active_jobs[job_id]["error"] = str(e)
            # Clean up partial adapter directory so retries don't collide
            try:
                if job_adapter_dir.exists() and not (job_adapter_dir / "adapters.safetensors").exists():
                    shutil.rmtree(job_adapter_dir)
                    logger.info(f"Cleaned up partial adapter dir: {job_adapter_dir}")
            except Exception as cleanup_err:
                logger.warning(f"Failed to clean up adapter dir: {cleanup_err}")

    def get_job_status(self, job_id: str):
        with self._jobs_lock:
            return self.active_jobs.get(job_id, {"status": "not_found"}).copy()

    def get_model_format_info(self, model_id: str) -> Dict[str, Any]:
        """Detect chat template format, EOS tokens, and model type for a model.

        Returns info like model_type, chat_template presence, EOS token, etc.
        so the UI can show users what format their training data will use.
        """
        model_entry = self._get_model_config_by_id(model_id)
        if not model_entry:
            return {"error": "Model not found"}

        info: Dict[str, Any] = {
            "model_id": model_id,
            "model_type": "unknown",
            "has_chat_template": False,
            "chat_template_preview": None,
            "eos_token": None,
            "bos_token": None,
            "pad_token": None,
        }

        # Find model path
        model_path = None
        if model_entry.get("is_finetuned") and model_entry.get("adapter_path"):
            # For fine-tuned models, use base model
            base_id = model_entry.get("base_model", "")
            base_entry = self._get_model_config_by_id(base_id)
            if base_entry:
                model_entry = base_entry
            else:
                return info

        if Path(model_entry["id"]).is_absolute():
            p = Path(model_entry["id"])
            if p.exists():
                model_path = p
        else:
            sanitized = model_entry["id"].replace("/", "--")
            p = self.models_dir / sanitized
            if p.exists():
                model_path = p

        if not model_path:
            return info

        # Read config.json for model_type
        config_path = model_path / "config.json"
        if config_path.exists():
            try:
                with open(config_path, "r") as f:
                    config = json.load(f)
                info["model_type"] = config.get("model_type", "unknown")
            except Exception:
                pass

        # Read tokenizer_config.json for chat template and special tokens
        tok_config_path = model_path / "tokenizer_config.json"
        if tok_config_path.exists():
            try:
                with open(tok_config_path, "r") as f:
                    tok_config = json.load(f)

                # Chat template
                if "chat_template" in tok_config:
                    info["has_chat_template"] = True
                    template = tok_config["chat_template"]
                    # Preview: first 200 chars
                    if isinstance(template, str):
                        info["chat_template_preview"] = template[:200]

                # Special tokens
                eos = tok_config.get("eos_token")
                if isinstance(eos, dict):
                    eos = eos.get("content", str(eos))
                info["eos_token"] = eos

                bos = tok_config.get("bos_token")
                if isinstance(bos, dict):
                    bos = bos.get("content", str(bos))
                info["bos_token"] = bos

                pad = tok_config.get("pad_token")
                if isinstance(pad, dict):
                    pad = pad.get("content", str(pad))
                info["pad_token"] = pad

            except Exception:
                pass

        return info

    def _get_model_config_by_id(self, model_id: str):
        for m in self.models_config:
            if m["id"] == model_id:
                return m
        return None

    def get_models_status(self):
        """
        Returns the list of supported models with their local download status.
        Uses self.models_config which includes custom registered models.
        """
        models = []
        for m in self.models_config:
            # Check if model exists locally
            
            is_downloaded = False
            model_path = None
            is_downloading = m["id"] in self.active_downloads
            
            # 1. Custom Path? (Legacy custom registration)
            if "is_finetuned" in m and m["is_finetuned"]:
                 is_downloaded = True # Always "downloaded" if it's a local fine-tune
            elif Path(m["id"]).is_absolute():
                if Path(m["id"]).exists():
                    is_downloaded = True
                    model_path = str(Path(m["id"]))
                    
                    # Backfill size if missing or 'Custom'
                    if m.get("size") == "Custom":
                        logger.info(f"Backfilling size for {m['name']}")
                        new_size = self._get_dir_size_str(Path(m["id"]))
                        m["size"] = new_size # Update in memory
                        # We should save this back to JSON so we don't recalc every second
                        # But loop overhead to save inside loop is bad. 
                        # We can defer save? For now just in-memory update is visible to UI.
                        
            else:
                # 2. Standard Downloaded Model
                sanitized_name = m["id"].replace("/", "--")
                local_path = self.models_dir / sanitized_name
                # Only check for follow-up .completed file
                if (local_path / ".completed").exists():
                    is_downloaded = True
                    model_path = str(local_path)
            
            entry = {
                **m,
                "downloaded": is_downloaded,
                "downloading": is_downloading, 
                "local_path": model_path
            }
            
            # --- Metadata Recovery Logic ---
            # If name looks like generic ID and it's a fine-tune, try to read metadata.json
            if entry["name"].startswith("Fine-Tune ") and "adapter_path" in m:
                try:
                    adapter_dir = Path(m["adapter_path"])
                    meta_path = adapter_dir / "metadata.json"
                    if meta_path.exists():
                        with open(meta_path, 'r') as f:
                            meta = json.load(f)
                            if "job_name" in meta and meta["job_name"]:
                                entry["name"] = meta["job_name"]
                                m["name"] = meta["job_name"]
                except Exception as e:
                    logger.debug(f"Could not read metadata for {m.get('name')}: {e}")

            models.append(entry)
        return models

    def download_model(self, model_id: str):
        """
        Downloads a model to the local models directory.
        This is a blocking operation (run in Bg Task), handles markers.
        """
        if model_id in self.active_downloads:
            logger.info(f"Model {model_id} already downloading.")
            return

        self.active_downloads.add(model_id)
        try:
            from huggingface_hub import snapshot_download

            logger.info(f"Downloading {model_id} to {self.models_dir}...")
            sanitized_name = model_id.replace("/", "--")
            local_dir = self.models_dir / sanitized_name

            # Pre-flight: check disk space
            _check_disk_space(self.models_dir)

            # Remove partial .completed if it exists (shouldn't, but safety)
            marker_file = local_dir / ".completed"
            if marker_file.exists():
                os.remove(marker_file)

            snapshot_download(
                repo_id=model_id,
                local_dir=local_dir,
                local_dir_use_symlinks=False,
                resume_download=True,
            )

            # Post-download integrity: config.json must exist
            if not (local_dir / "config.json").exists():
                raise RuntimeError(
                    f"Download incomplete: config.json missing in {local_dir}"
                )

            # Write marker file with metadata
            with open(marker_file, 'w') as f:
                json.dump({"status": "ok", "model_id": model_id, "timestamp": time.time()}, f)

            logger.info(f"Successfully downloaded {model_id}")
            return True
        except PermissionError as e:
            logger.error(f"Permission denied downloading {model_id}: {e}")
            raise PermissionError(
                f"Cannot write to models directory: {e}. Check folder permissions for {self.models_dir}"
            ) from e
        except Exception as e:
            logger.error(f"Failed to download {model_id}: {e}")
            raise
        finally:
            self.active_downloads.discard(model_id)
            
    def delete_model(self, model_id: str):
        """
        Deletes a local model from disk.
        Handles both standard downloaded models and custom registered models.
        """
        try:
            # Check if it's a custom/finetuned model in config
            config_entry = self._get_model_config_by_id(model_id)
            
            if config_entry and config_entry.get("is_custom"):
                logger.info(f"Deleting custom model: {model_id} ({config_entry['name']})")
                
                # 1. Remove from config
                with self._config_lock:
                    self.models_config = [m for m in self.models_config if m["id"] != model_id]
                    self._save_models_config()
                
                # 2. Delete files if it's a fine-tune (adapter path)
                if config_entry.get("is_finetuned") and "adapter_path" in config_entry:
                    adapter_path = Path(config_entry["adapter_path"])
                    if adapter_path.exists() and adapter_path.is_dir():
                        logger.info(f"Removing adapter directory: {adapter_path}")
                        shutil.rmtree(adapter_path)
                
                # 3. Delete files if it's a User Added Foundation Model (Absolute Path)
                elif Path(model_id).is_absolute() and Path(model_id).exists():
                     target_path = Path(model_id)
                     # SAFETY CHECK: Only delete if path is under home directory and is a real model dir
                     home = Path.home()
                     if target_path.is_relative_to(home) and target_path.is_dir():
                         logger.info(f"Removing user model directory: {target_path}")
                         shutil.rmtree(target_path)
                     else:
                         logger.warning(f"Skipping disk deletion for safety (not under home): {target_path}")

                return True

            # Standard Downloaded Model Logic
            sanitized_name = model_id.replace("/", "--")
            local_dir = self.models_dir / sanitized_name
            
            if local_dir.exists():
                logger.info(f"Deleting foundation model {model_id} at {local_dir}")
                shutil.rmtree(local_dir)
                return True
            else:
                logger.info(f"Model {model_id} not found at {local_dir}")
                return False
        except Exception as e:
            logger.error(f"Failed to delete {model_id}: {e}")
            raise

    async def export_model(self, model_id: str, output_path: str, q_bits: int = 4):
        """Fuse adapters with base model and apply quantization."""
        config = self._get_model_config_by_id(model_id)
        if not config:
            raise ValueError("Model not found")
        
        base_model = config["base_model"] if config.get("is_finetuned") else model_id
        adapter_path = config.get("adapter_path")
        
        # Pre-flight: check disk space at export target
        _check_disk_space(Path(output_path).parent)

        # Pre-flight: memory check — fusing loads the full model + adapter into RAM
        base_entry = self._get_model_config_by_id(base_model)
        if base_entry:
            base_path = Path(base_entry["id"]) if Path(base_entry["id"]).is_absolute() else None
            if base_path and base_path.is_dir():
                model_bytes = self._estimate_model_size_bytes(base_path)
                if model_bytes > 0:
                    mem = psutil.virtual_memory()
                    # Fusing roughly doubles RAM: original + fused output
                    needed = model_bytes * 2
                    if needed > mem.total:
                        raise MemoryError(
                            f"Export needs ~{needed / 1e9:.1f} GB RAM (model + fused copy) "
                            f"but system only has {mem.total / 1e9:.1f} GB. "
                            f"Try quantizing to fewer bits or use a smaller model."
                        )
                    if needed > mem.available:
                        logger.warning(
                            f"Export may cause heavy swapping: needs ~{needed / 1e9:.1f} GB, "
                            f"only {mem.available / 1e9:.1f} GB available"
                        )

        logger.info(f"Exporting model {model_id} to {output_path} (Quant: {q_bits} bits)...")

        from mlx_lm import fuse

        # fuse() handles quantization if q_bits is provided
        # q_bits=0 means full precision (no quantization)
        loop = asyncio.get_running_loop()
        try:
            fuse_kwargs = {
                "model": base_model,
                "adapter_path": adapter_path,
                "save_path": output_path,
            }
            if q_bits and q_bits > 0:
                fuse_kwargs["q_bits"] = q_bits
            await loop.run_in_executor(None, lambda: fuse(**fuse_kwargs))
            logger.info(f"Model exported successfully to {output_path}")
            return {"status": "success", "path": output_path}
        except PermissionError as e:
            raise PermissionError(f"Cannot write to export path: {e}") from e
        except Exception as e:
            logger.error(f"Export failed: {e}")
            raise e

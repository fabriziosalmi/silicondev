"""LoRA fine-tuning training loop for the MLX engine.

Receives the parent MLXEngineService as `engine` for shared state (job
tracking, models config, locks, paths) but the training logic itself lives
here so service.py is not 300+ lines longer than necessary.
"""
from __future__ import annotations

import concurrent.futures
import json
import logging
import os
import shutil
from pathlib import Path
from typing import TYPE_CHECKING, Any, Dict

import mlx.core as mx
import psutil
from mlx_lm import load
from mlx_lm.tuner import TrainingArgs, train

from app.engine._helpers import check_disk_space

if TYPE_CHECKING:
    from app.engine.service import MLXEngineService

logger = logging.getLogger(__name__)

_MAX_DATASET_MB = 500  # 500 MB limit for in-memory loading


def _detect_vision_model(model_id: str, models_dir: Path) -> bool:
    """Return True if the model's config.json declares vision components."""
    model_path = Path(model_id)
    if not model_path.is_absolute():
        sanitized = model_id.replace("/", "--")
        model_path = models_dir / sanitized
    config_file = model_path / "config.json"
    if not config_file.exists():
        return False
    try:
        with open(config_file, "r") as f:
            cfg = json.load(f)
    except (json.JSONDecodeError, OSError):
        return False
    if not isinstance(cfg, dict):
        return False
    vision_keys = (
        "vision_config", "visual", "image_size",
        "vision_tower", "mm_projector_type", "visual_encoder",
    )
    return any(k in cfg and cfg[k] is not None for k in vision_keys)


def _clamp_max_seq_length(max_seq_length: int) -> int:
    """Clamp max_seq_length to what the host RAM can realistically support."""
    mem_gb = psutil.virtual_memory().total / (1024 ** 3)
    if mem_gb <= 8:
        max_safe = 512
    elif mem_gb <= 16:
        max_safe = 2048
    elif mem_gb <= 32:
        max_safe = 4096
    else:
        max_safe = 8192
    if max_seq_length > max_safe:
        logger.warning(
            f"Clamping max_seq_length from {max_seq_length} to {max_safe} "
            f"({mem_gb:.0f} GB unified memory)"
        )
        return max_safe
    return max_seq_length


def run_training_job(engine: "MLXEngineService", job_id: str, config: Dict[str, Any]) -> None:
    """LoRA fine-tuning training job. Executed in a separate thread."""
    job_adapter_dir = engine.adapters_dir / job_id
    try:
        with engine._jobs_lock:
            engine.active_jobs[job_id]["status"] = "training"
        model_id = config.get("model_id")
        dataset_path = config.get("dataset_path")

        # Block fine-tuning for vision models (mlx_lm LoRA doesn't support vision_tower)
        if _detect_vision_model(model_id, engine.models_dir):
            raise ValueError(
                "Fine-tuning vision models is not yet supported. "
                "LoRA training requires a text-only model."
            )

        # Pre-check: reject datasets that would OOM when loaded into RAM
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
        batch_size = int(config.get("batch_size", 1))
        lora_rank = int(config.get("lora_rank", 8))
        lora_alpha = float(config.get("lora_alpha", 16))
        max_seq_length = int(config.get("max_seq_length", 512))
        lora_dropout = float(config.get("lora_dropout", 0.0))
        lora_layers = int(config.get("lora_layers", 8))
        seed = config.get("seed")
        if seed is not None:
            mx.random.seed(int(seed))

        max_seq_length = _clamp_max_seq_length(max_seq_length)

        job_adapter_dir.mkdir(parents=True, exist_ok=True)
        check_disk_space(job_adapter_dir)

        adapter_file = job_adapter_dir / "adapters.safetensors"

        logger.info(f"Starting training job {job_id} for model {model_id}...")
        logger.info(
            f"Params: Epochs={epochs}, BS={batch_size}, Rank={lora_rank}, "
            f"Alpha={lora_alpha}, LR={lr}, Dropout={lora_dropout}"
        )

        # Load model + freeze base
        model, tokenizer, model_config = load(model_id, return_config=True)
        model.freeze()

        # Stage dataset into the layout load_local_dataset expects
        from mlx_lm.tuner.datasets import load_local_dataset, CacheDataset

        job_data_dir = job_adapter_dir / "data"
        job_data_dir.mkdir(exist_ok=True, parents=True)
        target_train_path = job_data_dir / "train.jsonl"
        try:
            shutil.copy(dataset_path, target_train_path)
            logger.info(f"Staged dataset {dataset_path} to {target_train_path}")
        except OSError as e:
            logger.error(f"Error copying dataset: {e}")

        train_set, val_set, test_set = load_local_dataset(job_data_dir, tokenizer, model_config)

        # If user provides only train.jsonl, val_set is empty list. Train loop crashes.
        if len(val_set) == 0:
            logger.info("Validation set empty. Splitting train set...")
            raw_data = getattr(train_set, "_data", train_set)
            if len(raw_data) > 1:
                split_idx = int(len(raw_data) * 0.9)
                if split_idx == len(raw_data):
                    split_idx = len(raw_data) - 1
                train_raw = raw_data[:split_idx]
                val_raw = raw_data[split_idx:]
                from mlx_lm.tuner.datasets import create_dataset
                train_set = create_dataset(train_raw, tokenizer, model_config)
                val_set = create_dataset(val_raw, tokenizer, model_config)
            else:
                logger.info("Train set too small (<=1). Duplicating for validation.")
                val_set = train_set

        # ChatDataset returns raw dicts. Trainer expects processed tuples.
        train_set = CacheDataset(train_set)
        val_set = CacheDataset(val_set)

        steps_per_epoch = max(len(train_set) // batch_size, 1)
        total_iters = steps_per_epoch * epochs
        logger.info(
            f"Training Plan: {len(train_set)} samples, "
            f"{steps_per_epoch} steps/epoch, {total_iters} total iters."
        )

        args = TrainingArgs(
            batch_size=batch_size,
            iters=total_iters,
            adapter_file=str(adapter_file),
            max_seq_length=max_seq_length,
        )

        class ProgressCallback:
            def on_train_loss_report(self, train_info):
                if "iteration" in train_info:
                    step = train_info["iteration"]
                    prog = int((step / args.iters) * 100)
                    with engine._jobs_lock:
                        engine.active_jobs[job_id]["progress"] = prog

            def on_val_loss_report(self, val_info):
                val_loss = val_info.get("val_loss", val_info.get("loss"))
                if val_loss is not None:
                    with engine._jobs_lock:
                        engine.active_jobs[job_id]["val_loss"] = round(float(val_loss), 6)

        progress_callback = ProgressCallback()

        import mlx.optimizers as optim
        optimizer = optim.Adam(learning_rate=lr)

        from mlx_lm.tuner.utils import linear_to_lora_layers
        lora_config = {
            "rank": lora_rank,
            "alpha": lora_alpha,
            "scale": float(lora_alpha / lora_rank),
            "dropout": lora_dropout,
            "keys": ["self_attn.q_proj", "self_attn.v_proj"],
            "num_layers": lora_layers,
        }
        linear_to_lora_layers(model, lora_config["num_layers"], lora_config)
        logger.info("Model converted to LoRA.")

        # Run training with a timeout to prevent runaway jobs.
        max_seconds = max(6 * 3600, total_iters * 60)
        with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
            future = pool.submit(
                train,
                model=model,
                optimizer=optimizer,
                train_dataset=train_set,
                val_dataset=val_set,
                args=args,
                training_callback=progress_callback,
            )
            try:
                future.result(timeout=max_seconds)
            except concurrent.futures.TimeoutError:
                raise RuntimeError(
                    f"Training job {job_id} timed out after {max_seconds}s "
                    f"({total_iters} iterations). Job terminated."
                )

        with engine._jobs_lock:
            engine.active_jobs[job_id]["status"] = "completed"
            engine.active_jobs[job_id]["model_path"] = str(adapter_file)
            engine.active_jobs[job_id]["progress"] = 100

        # Auto-Register fine-tuned model
        job_name = config.get("job_name") or f"Fine-Tune {job_id[:8]}"

        metadata_path = job_adapter_dir / "metadata.json"
        metadata = {
            "job_name": job_name,
            "job_id": job_id,
            "base_model": model_id,
            "params": config,
        }

        adapter_config_path = job_adapter_dir / "adapter_config.json"
        base_model_type = "llama"
        if hasattr(model_config, "model_type"):
            base_model_type = model_config.model_type
        elif isinstance(model_config, dict) and "model_type" in model_config:
            base_model_type = model_config["model_type"]

        final_adapter_config = {
            "num_layers": lora_config["num_layers"],
            "model_type": base_model_type,
            "base_model_name_or_path": model_id,
            "lora_parameters": {
                "rank": lora_config["rank"],
                "alpha": lora_config["alpha"],
                "scale": lora_config["scale"],
                "dropout": lora_config["dropout"],
                "keys": lora_config["keys"],
            },
        }

        try:
            with open(metadata_path, "w") as f:
                json.dump(metadata, f, indent=4)
            with open(adapter_config_path, "w") as f:
                json.dump(final_adapter_config, f, indent=4)
        except OSError as e:
            logger.error(f"Failed to save metadata or adapter config: {e}")

        ft_model_entry = {
            "id": f"ft-{job_id}",
            "name": job_name,
            "base_model": model_id,
            "adapter_path": str(job_adapter_dir),
            "size": "Adapter",
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
                "lora_layers": lora_layers,
            },
        }
        with engine._config_lock:
            engine.models_config.append(ft_model_entry)
            engine._save_models_config()
        logger.info(f"Registered fine-tuned model: {ft_model_entry['name']}")

    except Exception as e:
        logger.error(f"Training failed: {e}", exc_info=True)
        with engine._jobs_lock:
            engine.active_jobs[job_id]["status"] = "failed"
            engine.active_jobs[job_id]["error"] = str(e)
        # Clean up partial adapter directory so retries don't collide
        try:
            if job_adapter_dir.exists() and not (job_adapter_dir / "adapters.safetensors").exists():
                shutil.rmtree(job_adapter_dir)
                logger.info(f"Cleaned up partial adapter dir: {job_adapter_dir}")
        except OSError as cleanup_err:
            logger.warning(f"Failed to clean up adapter dir: {cleanup_err}")

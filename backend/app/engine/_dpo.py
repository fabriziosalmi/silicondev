"""Direct Preference Optimization (DPO) training implementation.

Implements the DPO sigmoid loss directly on MLX without external dependencies.
The training loop receives the parent MLXEngineService as `engine` so it can
update job state, register the resulting adapter, and reuse the engine's GC
logic — but the math itself is in pure functions below.
"""
from __future__ import annotations

import json
import logging
import random
import shutil
from typing import TYPE_CHECKING, Any, Dict

import mlx.core as mx
import psutil
from mlx_lm import load

if TYPE_CHECKING:
    from app.engine.service import MLXEngineService

logger = logging.getLogger(__name__)


def sequence_log_probs(model, tokens, masks):
    """Compute per-sequence mean log-probabilities."""
    import mlx.nn as nn
    logits = model(tokens[:, :-1])
    targets = tokens[:, 1:]
    log_probs = -nn.losses.cross_entropy(logits, targets, reduction="none")
    # Mask padding (shift mask to match targets)
    m = masks[:, 1:]
    masked = log_probs * m
    return masked.sum(axis=-1) / mx.maximum(m.sum(axis=-1), mx.array(1.0))


def dpo_loss_fn(
    model,
    chosen_tokens, chosen_masks,
    rejected_tokens, rejected_masks,
    ref_chosen_lp, ref_rejected_lp,
    beta,
):
    """DPO sigmoid loss: -log(sigmoid(beta * (log_ratio_chosen - log_ratio_rejected)))."""
    import mlx.nn as nn
    policy_chosen_lp = sequence_log_probs(model, chosen_tokens, chosen_masks)
    policy_rejected_lp = sequence_log_probs(model, rejected_tokens, rejected_masks)

    # Log-ratio differences
    logits = beta * ((policy_chosen_lp - ref_chosen_lp) - (policy_rejected_lp - ref_rejected_lp))
    loss = -nn.log_sigmoid(logits).mean()
    return loss, policy_chosen_lp.mean()


def run_dpo_training_job(engine: "MLXEngineService", job_id: str, config: Dict[str, Any]) -> None:
    """Run DPO training in a background thread.

    Approach:
    1. Load the base model twice (policy + frozen reference).
    2. For each (prompt, chosen, rejected) triple, compute log-probs under
       both policy and reference.
    3. Apply sigmoid loss on the log-ratio difference.
    4. Save LoRA adapters.
    """
    import mlx.nn as nn
    import mlx.optimizers as optim
    from mlx_lm.tuner.utils import linear_to_lora_layers

    job_adapter_dir = engine.adapters_dir / job_id
    try:
        with engine._jobs_lock:
            engine.active_jobs[job_id]["status"] = "training"

        model_id = config["model_id"]
        dataset_path = config["dataset_path"]
        beta = float(config.get("dpo_beta", 0.1))
        lr = float(config.get("learning_rate", 1e-5))
        epochs = int(config.get("epochs", 1))
        batch_size = int(config.get("batch_size", 1))
        lora_rank = int(config.get("lora_rank", 16))
        lora_alpha = float(config.get("lora_alpha", 32))
        lora_layers = int(config.get("lora_layers", 8))
        max_seq_length = int(config.get("max_seq_length", 2048))
        job_name = config.get("job_name", f"dpo-{job_id[:8]}")

        # Memory safety clamp
        mem_gb = psutil.virtual_memory().total / (1024 ** 3)
        max_safe = 512 if mem_gb <= 8 else 2048 if mem_gb <= 16 else 4096 if mem_gb <= 32 else 8192
        if max_seq_length > max_safe:
            logger.warning(f"DPO: clamping max_seq_length {max_seq_length} -> {max_safe}")
            max_seq_length = max_safe

        # Load DPO pairs
        pairs = []
        with open(dataset_path, "r", encoding="utf-8") as f:
            for line in f:
                entry = json.loads(line.strip())
                if entry.get("prompt") and entry.get("chosen") and entry.get("rejected"):
                    pairs.append(entry)
        if len(pairs) < 5:
            raise ValueError(f"Need at least 5 DPO pairs, got {len(pairs)}")

        logger.info(f"DPO: loaded {len(pairs)} preference pairs")

        # Load model + tokenizer
        model, tokenizer, model_config = load(model_id, return_config=True)

        # Create reference model (frozen copy)
        ref_model, _, _ = load(model_id, return_config=True)
        ref_model.freeze()

        # Apply LoRA to policy model
        model.freeze()
        lora_config = {
            "rank": lora_rank,
            "alpha": lora_alpha,
            "scale": float(lora_alpha / lora_rank),
            "dropout": 0.0,
            "keys": ["self_attn.q_proj", "self_attn.v_proj"],
            "num_layers": lora_layers,
        }
        linear_to_lora_layers(model, lora_config["num_layers"], lora_config)
        logger.info("DPO: model converted to LoRA")

        # Setup
        job_adapter_dir.mkdir(parents=True, exist_ok=True)
        optimizer = optim.Adam(learning_rate=lr)
        loss_and_grad_fn = nn.value_and_grad(model, dpo_loss_fn)

        total_steps = (len(pairs) // batch_size) * epochs
        if total_steps < 1:
            total_steps = 1
        step = 0

        for epoch in range(epochs):
            random.shuffle(pairs)
            for i in range(0, len(pairs) - batch_size + 1, batch_size):
                batch = pairs[i:i + batch_size]

                # Tokenize batch
                all_chosen_ids = []
                all_rejected_ids = []
                for p in batch:
                    text_chosen = p["prompt"] + "\n" + p["chosen"]
                    text_rejected = p["prompt"] + "\n" + p["rejected"]
                    chosen_ids = tokenizer.encode(text_chosen)[:max_seq_length]
                    rejected_ids = tokenizer.encode(text_rejected)[:max_seq_length]
                    all_chosen_ids.append(chosen_ids)
                    all_rejected_ids.append(rejected_ids)

                # Pad to same length within batch
                def _pad(seqs):
                    max_len = max(len(s) for s in seqs)
                    padded = []
                    masks = []
                    for s in seqs:
                        pad_len = max_len - len(s)
                        padded.append(s + [0] * pad_len)
                        masks.append([1.0] * len(s) + [0.0] * pad_len)
                    return mx.array(padded), mx.array(masks)

                chosen_tokens, chosen_masks = _pad(all_chosen_ids)
                rejected_tokens, rejected_masks = _pad(all_rejected_ids)

                # Compute reference log-probs (no grad)
                ref_chosen_lp = sequence_log_probs(ref_model, chosen_tokens, chosen_masks)
                ref_rejected_lp = sequence_log_probs(ref_model, rejected_tokens, rejected_masks)
                mx.eval(ref_chosen_lp, ref_rejected_lp)

                # Compute loss + gradients on policy model
                (loss_val, _), grads = loss_and_grad_fn(
                    model, chosen_tokens, chosen_masks,
                    rejected_tokens, rejected_masks,
                    ref_chosen_lp, ref_rejected_lp, beta,
                )
                optimizer.update(model, grads)
                mx.eval(model.parameters(), optimizer.state, loss_val)

                step += 1
                progress = int((step / total_steps) * 100)
                with engine._jobs_lock:
                    engine.active_jobs[job_id]["progress"] = min(progress, 99)
                    engine.active_jobs[job_id]["loss"] = round(float(loss_val), 6)

                if step % 10 == 0:
                    logger.info(f"DPO step {step}/{total_steps} loss={float(loss_val):.4f}")

        # Save adapters
        adapter_file = job_adapter_dir / "adapters.safetensors"
        mx.savez(str(adapter_file), **dict(model.trainable_parameters()))

        # Save adapter config
        base_model_type = "llama"
        if hasattr(model_config, "model_type"):
            base_model_type = model_config.model_type
        elif isinstance(model_config, dict) and "model_type" in model_config:
            base_model_type = model_config["model_type"]

        adapter_config_path = job_adapter_dir / "adapter_config.json"
        with open(adapter_config_path, "w") as f:
            json.dump({
                "num_layers": lora_config["num_layers"],
                "model_type": base_model_type,
                "base_model_name_or_path": model_id,
                "training_type": "dpo",
                "dpo_beta": beta,
                "lora_parameters": {
                    "rank": lora_config["rank"],
                    "alpha": lora_config["alpha"],
                    "scale": lora_config["scale"],
                    "dropout": lora_config["dropout"],
                    "keys": lora_config["keys"],
                }
            }, f, indent=4)

        # Save metadata
        with open(job_adapter_dir / "metadata.json", "w") as f:
            json.dump(
                {
                    "job_name": job_name,
                    "job_id": job_id,
                    "base_model": model_id,
                    "params": config,
                    "type": "dpo",
                    "num_pairs": len(pairs),
                },
                f,
                indent=4,
            )

        # Register fine-tuned model
        ft_entry = {
            "id": f"ft-{job_id}",
            "name": job_name,
            "base_model": model_id,
            "adapter_path": str(job_adapter_dir),
            "size": "Adapter",
            "family": "Custom",
            "is_custom": True,
            "is_finetuned": True,
            "training_type": "dpo",
            "params": config,
        }
        with engine._config_lock:
            engine.models_config.append(ft_entry)
            engine._save_models_config()

        with engine._jobs_lock:
            engine.active_jobs[job_id]["status"] = "completed"
            engine.active_jobs[job_id]["model_path"] = str(adapter_file)
            engine.active_jobs[job_id]["progress"] = 100

        logger.info(f"DPO training completed: {job_name} ({len(pairs)} pairs, {step} steps)")

        # Free reference model — unconditional, this is a large allocation
        del ref_model
        engine._maybe_gc(force=True)

    except Exception as e:
        logger.error(f"DPO training failed: {e}", exc_info=True)
        with engine._jobs_lock:
            engine.active_jobs[job_id]["status"] = "failed"
            engine.active_jobs[job_id]["error"] = str(e)
        try:
            if job_adapter_dir.exists() and not (job_adapter_dir / "adapters.safetensors").exists():
                shutil.rmtree(job_adapter_dir)
        except OSError:
            pass

# Fine-Tuning

Source: `src/renderer/src/components/EngineInterface.tsx`

## Overview

LoRA and QLoRA fine-tuning using Apple's MLX framework. Runs entirely on-device using unified memory. No GPU rental or cloud services required.

## Presets

Three built-in configurations:

| Preset | Epochs | Learning Rate | Batch | LoRA Rank | Use Case |
|--------|--------|---------------|-------|-----------|----------|
| Draft | 1 | 1e-5 | 2 | 4 | Quick test runs |
| Balanced | 3 | 2e-5 | 4 | 8 | General fine-tuning |
| Deep | 10 | 1e-5 | 2 | 16 | Maximum quality |

All parameters can be overridden manually.

## Hyperparameters

### Training

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Epochs | 1–100 | 3 | Number of passes over the dataset |
| Learning Rate | >0 to 1.0 | 1e-4 | Step size for weight updates |
| Batch Size | 1–64 | 1 | Samples per training step |
| Max Sequence Length | 64–32768 | 512 | Maximum token length per sample |
| Seed | integer or null | null | Random seed for reproducibility |

### LoRA

| Parameter | Range | Default | Description |
|-----------|-------|---------|-------------|
| Rank | 1–256 | 8 | LoRA rank (lower = fewer parameters) |
| Alpha | >0 | 16.0 | Scaling factor for LoRA updates |
| Dropout | 0–1.0 | 0.0 | Dropout probability in LoRA layers |
| Layers | 1–128 | 8 | Number of layers to apply LoRA to |

## Dataset

The training dataset must be a JSONL file with `instruction`, `input` (optional), and `output` fields. Use the [Data Preparation](/features/data-preparation) page to convert CSV files.

Select the dataset file via the file picker. The UI shows a preview of the first few entries.

## Training Flow

1. Select a base model (must be loaded).
2. Choose a preset or configure manually.
3. Select a JSONL dataset.
4. Name the fine-tuning job.
5. Click "Start Training".
6. The backend spawns a training thread. Frontend polls job status every 2 seconds.
7. Loss curve and metrics are displayed in real-time.
8. On completion, the adapter is saved to `~/.silicon-studio/adapters/`.

## Post-Training

After training completes:

- The adapter is saved alongside the base model path.
- It appears in the Models list with `is_finetuned: true`.
- It can be exported via [Model Export](/features/model-export) at various quantization levels.

## DPO Preference Training

SiliconDev captures preference data automatically: every time you approve or reject a diff in the Code Workspace, the prompt and the proposed change are logged as a DPO pair (chosen/rejected).

### Preference Training Tab

The fine-tuning UI includes a "Preference Training" tab that shows:

- **Pair counter**: How many approve/reject pairs have been collected.
- **Train with Preferences button**: Launches a DPO training job using the collected pairs.
- **Loss curve**: Same real-time visualization as LoRA training.

### DPO Data Format

Pairs are stored in `~/.silicon-studio/datasets/dpo_pairs.jsonl`:

```jsonl
{"prompt": "...", "chosen": "...", "rejected": "...", "metadata": {"tool": "patch_file", "file": "src/auth.py"}}
```

### Inspector Scoring

The agent's Inspector adds a numeric quality score (1-10) to each response. This score acts as an automatic quality gate and can be used as a reward signal for RLAIF-style training.

## Limitations

- One training job at a time.
- Training speed depends on model size and available unified memory.
- Very large models (30B+) may not fit in memory for fine-tuning on 16GB machines.

## Backend

Training is implemented in `backend/app/engine/service.py` using `mlx_lm.lora()`. The training config is written to a temporary YAML file and passed to the MLX training loop. Job status (loss, step, epoch) is tracked in memory and exposed via `GET /api/engine/jobs/{id}`.

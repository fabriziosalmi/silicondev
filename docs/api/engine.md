# Engine / Models API

Prefix: `/api/engine`

Source: `backend/app/api/engine.py`

## Models

### List Models

```
GET /api/engine/models
```

Returns all registered models with download status, paths, and metadata.

### Download Model

```
POST /api/engine/models/download
```

```json
{ "model_id": "mlx-community/Qwen3-1.7B-MLX-8bit" }
```

Downloads model files from Hugging Face. Runs in background.

### Delete Model

```
POST /api/engine/models/delete
```

```json
{ "model_id": "model-uuid" }
```

Removes model files from disk.

### Register Custom Model

```
POST /api/engine/models/register
```

```json
{
  "name": "My Model",
  "path": "/absolute/path/to/model",
  "url": "https://huggingface.co/..."
}
```

### Scan Directory

```
POST /api/engine/models/scan
```

```json
{ "path": "/path/to/models/directory" }
```

Auto-discovers and registers all valid MLX models in the directory.

### Get Active Model

```
GET /api/engine/models/active
```

Returns the currently loaded model with `id`, `name`, `size`, `path`, `architecture`, `context_window`, and `is_vision`. Returns `{ "model": null }` if no model is loaded.

### Load Model

```
POST /api/engine/models/load
```

```json
{ "model_id": "model-uuid", "kv_quantization": 4 }
```

Loads model into MLX memory. Returns `context_window` and `architecture` if available. Only one model can be loaded at a time.

`kv_quantization`: optional, 4 or 8. Enables KV-cache quantization during generation. Omit for no quantization.

### Unload Model

```
POST /api/engine/models/unload
```

Frees model from memory.

### List Adapters

```
GET /api/engine/models/adapters
```

Returns models where `is_finetuned` is true.

### Export Model

```
POST /api/engine/models/export
```

```json
{
  "model_id": "adapter-uuid",
  "output_path": "/path/to/output",
  "q_bits": 4
}
```

`q_bits`: valid values are `0, 2, 3, 4, 6, 8`. 0 = full precision.

### Get Model Format

```
GET /api/engine/models/{model_id}/format
```

Returns `model_type`, `has_chat_template`, `eos_token`, `bos_token`, `pad_token`, and other tokenizer metadata. Useful for determining the chat template format before training.

## Chat

### Generate (SSE)

```
POST /api/engine/chat
```

```json
{
  "model_id": "model-uuid",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "temperature": 0.7,
  "max_tokens": 512,
  "top_p": 0.9,
  "repetition_penalty": 1.1,
  "seed": null
}
```

Returns a streaming SSE response. Each event is a JSON object with a `text` field. The engine uses `mlx_lm.stream_generate` with a persistent KV cache (`make_prompt_cache` / `trim_prompt_cache`) across turns. Common token prefixes are reused automatically.

`messages[].content` can be a string or an array of content parts (for vision models):

```json
[
  { "type": "text", "text": "Describe this image" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
]
```

Images must be under 20 MB.

### Stop Generation

```
POST /api/engine/chat/stop
```

Signals the active generation to stop. Returns `{ "status": "stopped" }`.

### Predict Completion

```
POST /api/engine/predict
```

```json
{
  "model_id": "model-uuid",
  "prompt": "def hello(",
  "max_tokens": 50
}
```

Non-streaming single-pass completion for inline code suggestions (ghost text). Returns `{ "text": "..." }`.

## Fine-Tuning

### Start Fine-Tuning

```
POST /api/engine/finetune
```

```json
{
  "model_id": "model-uuid",
  "dataset_path": "/path/to/data.jsonl",
  "job_name": "my-finetune",
  "epochs": 3,
  "learning_rate": 2e-5,
  "batch_size": 4,
  "lora_rank": 8,
  "lora_alpha": 16,
  "lora_dropout": 0.05,
  "warmup_steps": 50,
  "weight_decay": 0.01,
  "max_seq_length": 2048,
  "gradient_checkpointing": false
}
```

Returns `{ "job_id": "...", "status": "running" }`.

### Get Job Status

```
GET /api/engine/jobs/{job_id}
```

Returns current training state: step, epoch, loss, metrics, completion status.

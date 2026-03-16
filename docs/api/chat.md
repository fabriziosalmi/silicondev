# Chat API

Prefix: `/api/engine`

Source: `backend/app/api/engine.py`

## Stream Chat

```
POST /api/engine/chat
```

```json
{
  "model_id": "model-uuid",
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "Hello" }
  ],
  "temperature": 0.7,
  "max_tokens": 512,
  "top_p": 0.9,
  "repetition_penalty": 1.1,
  "seed": null
}
```

`max_tokens` range: 1–32768. `temperature` range: 0.0–2.0. `seed` is optional.

Returns Server-Sent Events. Each event is a JSON object on a `data:` line:

```
data: {"text": "Hello", "done": false}
data: {"text": " there", "done": false}
data: {"text": "", "done": true}
```

A `warning` field may appear on non-done events (e.g. high memory usage, image sent to text-only model).

The engine uses `mlx_lm.stream_generate` with a persistent KV cache (`make_prompt_cache` / `trim_prompt_cache` from `mlx_lm.models.cache`) that carries over across turns. Common token prefixes are reused automatically.

KV-cache quantization (4 or 8 bit) is applied during generation if it was set at model load time (`kv_bits=` kwarg to `stream_generate`).

### Vision Models

`messages[].content` can be a string or an array of content parts for vision models:

```json
[
  { "type": "text", "text": "Describe this image" },
  { "type": "image_url", "image_url": { "url": "data:image/png;base64,..." } }
]
```

Images must be under 20 MB. Vision models use `mlx_vlm.stream_generate` instead of `mlx_lm`.

### Message Format

Messages follow the OpenAI chat format:

```json
[
  { "role": "system", "content": "..." },
  { "role": "user", "content": "..." },
  { "role": "assistant", "content": "..." }
]
```

The frontend (`ChatInterface.tsx`) optionally prepends RAG chunks, web search results, and reasoning instructions to the message array before sending. These augmentations happen client-side; the `/api/engine/chat` endpoint itself does not accept RAG or search parameters.

## Stop Generation

```
POST /api/engine/chat/stop
```

Cancels the current generation. Returns `{ "status": "stopped" }`.

from fastapi import APIRouter, HTTPException, BackgroundTasks
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, field_validator
from typing import Dict, Any, List, Optional, Union
import uuid
import json
import logging
import time
from pathlib import Path
from app.engine.service import MLXEngineService
from app.security import safe_user_file

logger = logging.getLogger(__name__)

router = APIRouter()
service = MLXEngineService()

class FineTuneRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    dataset_path: str = Field(min_length=1, max_length=1024)
    epochs: int = Field(default=3, ge=1, le=100)
    learning_rate: float = Field(default=1e-4, gt=0, le=1.0)
    batch_size: int = Field(default=1, ge=1, le=64)
    lora_rank: int = Field(default=8, ge=1, le=256)
    lora_alpha: float = Field(default=16.0, gt=0)
    max_seq_length: int = Field(default=512, ge=64, le=32768)
    lora_dropout: float = Field(default=0.0, ge=0.0, le=1.0)
    lora_layers: int = Field(default=8, ge=1, le=128)
    seed: Optional[int] = Field(default=None, ge=0)
    job_name: str = Field(default="", max_length=255)

@router.post("/finetune")
async def start_finetune(request: FineTuneRequest):
    """Start a fine-tuning job."""
    try:
        safe_user_file(request.dataset_path)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    job_id = str(uuid.uuid4())
    logger.info(f"Received finetune request. Job Name: '{request.job_name}'")
    config = request.model_dump()
    result = await service.start_finetuning(job_id, config)
    return result

@router.get("/jobs/{job_id}")
async def get_job_status(job_id: str):
    """Get status of a fine-tuning job."""
    status = service.get_job_status(job_id)
    if status["status"] == "not_found":
        raise HTTPException(status_code=404, detail="Job not found")
    return status

@router.get("/models")
async def list_models():
    """List supported base models with their local download status."""
    return service.get_models_status()

@router.get("/models/active")
async def get_active_model():
    """Return the currently loaded model, or null if none."""
    if not service.active_model_id:
        return {"model": None}
    # Find full model info from config
    for m in service.models_config:
        if m["id"] == service.active_model_id:
            meta = service.get_active_model_metadata()
            return {"model": {
                "id": m["id"],
                "name": m.get("name", ""),
                "size": m.get("size", ""),
                "path": m.get("local_path") or m["id"],
                "architecture": m.get("architecture"),
                "context_window": meta.get("context_window"),
                "is_vision": meta.get("is_vision", False),
            }}
    # Model is loaded but not in config (e.g. config reloaded) — return basic info
    model_id = service.active_model_id
    model_name = Path(model_id).name if "/" in model_id else model_id
    return {"model": {
        "id": model_id,
        "name": model_name,
        "size": "",
        "path": model_id,
        "architecture": None,
        "context_window": None,
        "is_vision": service.active_is_vision,
    }}

class DownloadRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)

@router.post("/models/download")
async def download_model(request: DownloadRequest, background_tasks: BackgroundTasks):
    """Trigger a model download in the background."""
    background_tasks.add_task(service.download_model, request.model_id)
    return {"status": "download_started", "model_id": request.model_id}

@router.post("/models/delete")
async def delete_model(request: DownloadRequest):
    """Delete a locally downloaded model."""
    success = service.delete_model(request.model_id)
    if not success:
         raise HTTPException(status_code=404, detail="Model not found or could not be deleted")
    return {"status": "deleted", "model_id": request.model_id}

class RegisterRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    path: str = Field(min_length=1, max_length=1024)
    url: str = Field(default="", max_length=2048)

@router.post("/models/register")
async def register_model(request: RegisterRequest):
    """Register a custom model from a local path."""
    try:
        safe_user_file(request.path)
        new_model = service.register_model(request.name, request.path, request.url)
        return new_model
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ScanRequest(BaseModel):
    path: str = Field(min_length=1, max_length=1024)

@router.post("/models/scan")
async def scan_models(request: ScanRequest):
    """Scan a directory for MLX models."""
    try:
        safe_user_file(request.path)
        found = service.scan_directory(request.path)
        return found
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class LoadModelRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    kv_quantization: Optional[int] = Field(default=None, ge=4, le=8)

@router.post("/models/load")
async def load_model(request: LoadModelRequest):
    """Load a model into active memory (Apple Silicon unified memory)."""
    try:
        t0 = time.time()
        logger.info(f"Model load started: {request.model_id} (KV Quant: {request.kv_quantization})")
        await service.load_active_model(request.model_id, kv_quantization=request.kv_quantization)
        metadata = service.get_active_model_metadata()
        logger.info(f"Model loaded in {time.time() - t0:.1f}s: {request.model_id}")
        return {"status": "loaded", "model_id": request.model_id, **metadata}
    except MemoryError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except RuntimeError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e))
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/models/unload")
async def unload_model():
    """Unload the currently active model and free VRAM."""
    try:
        await service.unload_model()
        return {"status": "unloaded"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

class ImageUrl(BaseModel):
    url: str

class ContentPart(BaseModel):
    type: str  # "text" or "image_url"
    text: Optional[str] = None
    image_url: Optional[ImageUrl] = None

class ChatMessage(BaseModel):
    role: str = Field(min_length=1)
    content: Union[str, List[ContentPart]]

    @field_validator("content")
    @classmethod
    def validate_content(cls, v):
        if isinstance(v, list):
            for part in v:
                if part.type == "image_url" and part.image_url:
                    url = part.image_url.url
                    if url.startswith("data:") and len(url) > 20 * 1024 * 1024:
                        raise ValueError("Image exceeds 20 MB size limit")
        return v

class ChatRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    messages: List[ChatMessage] = Field(min_length=1)
    temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    max_tokens: int = Field(default=512, ge=1, le=32768)
    top_p: float = Field(default=0.9, ge=0.0, le=1.0)
    repetition_penalty: float = Field(default=1.1, ge=0.0, le=5.0)
    seed: Optional[int] = Field(default=None, ge=0)

@router.post("/chat")
async def chat_generation(request: ChatRequest):
    """Generate a response from the model with streaming support (SSE)."""
    params = request.model_dump()
    model_id = params.pop("model_id")
    messages = params.pop("messages")
    logger.info(f"Generation started: model={model_id}, messages={len(messages)}")
    t0 = time.time()

    async def event_generator():
        try:
            async for chunk in service.generate_stream(model_id, messages, **params):
                yield f"data: {json.dumps(chunk)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'error': str(e)})}\n\n"
        logger.info(f"Generation complete in {time.time() - t0:.1f}s: model={model_id}")

    return StreamingResponse(event_generator(), media_type="text/event-stream")

class PredictRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1)
    max_tokens: int = Field(default=50, ge=1, le=128)

@router.post("/predict")
async def predict_completion(request: PredictRequest):
    """Generate a fast, non-streaming code completion (Ghost Text)."""
    result = await service.predict_completion(
        request.model_id, 
        request.prompt, 
        request.max_tokens
    )
    if "error" in result:
        raise HTTPException(status_code=500, detail=result["error"])
    return result

@router.post("/chat/stop")
async def stop_generation():
    """Stop current generation."""
    service.stop_generation()
    return {"status": "stopped"}

_VALID_Q_BITS = {0, 2, 3, 4, 6, 8}

class ExportRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    output_path: str = Field(min_length=1, max_length=1024)
    q_bits: int = Field(default=4)

    @field_validator("q_bits")
    @classmethod
    def validate_q_bits(cls, v):
        if v not in _VALID_Q_BITS:
            raise ValueError(f"q_bits must be one of {sorted(_VALID_Q_BITS)}, got {v}")
        return v

@router.post("/models/export")
async def export_model(request: ExportRequest):
    """Export and quantize a model."""
    try:
        safe_user_file(request.output_path)
        result = await service.export_model(request.model_id, request.output_path, request.q_bits)
        return result
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/models/adapters")
async def list_adapters():
    """List fine-tuned models available for export."""
    all_models = service.get_models_status()
    adapters = [m for m in all_models if m.get("is_finetuned")]
    return adapters

@router.get("/models/{model_id:path}/format")
async def get_model_format(model_id: str):
    """Get chat template and token format info for a model.

    Returns model_type, has_chat_template, eos_token, etc. so the UI
    can show users what format their training data will use.
    """
    info = service.get_model_format_info(model_id)
    if "error" in info:
        raise HTTPException(status_code=404, detail=info["error"])
    return info

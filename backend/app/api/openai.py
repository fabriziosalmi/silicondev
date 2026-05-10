from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional, Union
import time
import json
import uuid
import logging
from app.api.engine import service

logger = logging.getLogger(__name__)

router = APIRouter()

class ChatMessage(BaseModel):
    role: str
    content: str | List[Dict[str, Any]]
    name: Optional[str] = None

class ChatCompletionRequest(BaseModel):
    model: str
    messages: List[ChatMessage]
    temperature: Optional[float] = 0.7
    top_p: Optional[float] = 1.0
    n: Optional[int] = 1
    stream: Optional[bool] = False
    stop: Optional[Union[str, List[str]]] = None
    max_tokens: Optional[int] = None
    presence_penalty: Optional[float] = 0.0
    frequency_penalty: Optional[float] = 0.0
    user: Optional[str] = None

@router.get("/v1/models")
async def list_models():
    """List loaded and available models in OpenAI format."""
    status = service.get_models_status()
    models = []
    for m in status:
        models.append({
            "id": m["id"],
            "object": "model",
            "created": int(time.time()),
            "owned_by": "silicon-studio",
            "root": m["id"],
            "parent": None,
        })
    return {"object": "list", "data": models}

@router.post("/v1/chat/completions")
async def chat_completions(request: ChatCompletionRequest):
    """OpenAI compatible chat completions endpoint."""
    model_id = request.model
    if model_id == "default":
        model_id = service.active_model_id or (service.models_config[0]["id"] if service.models_config else "default")
        
    messages = [m.model_dump(exclude_none=True) for m in request.messages]
    
    kwargs = {
        "temperature": request.temperature,
        "top_p": request.top_p,
    }
    if request.max_tokens is not None:
        kwargs["max_tokens"] = request.max_tokens
        
    if request.stream:
        async def event_generator():
            request_id = f"chatcmpl-{uuid.uuid4().hex}"
            created = int(time.time())
            
            init_chunk = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_id,
                "choices": [{"index": 0, "delta": {"role": "assistant", "content": ""}, "finish_reason": None}]
            }
            yield f"data: {json.dumps(init_chunk)}\n\n"
            
            async for chunk in service.generate_stream(model_id, messages, **kwargs):
                if "error" in chunk:
                    error_chunk = {
                        "id": request_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model_id,
                        "choices": [{"index": 0, "delta": {"content": f"\nError: {chunk['error']}"}, "finish_reason": "error"}]
                    }
                    yield f"data: {json.dumps(error_chunk)}\n\n"
                    break
                    
                if "text" in chunk:
                    stream_chunk = {
                        "id": request_id,
                        "object": "chat.completion.chunk",
                        "created": created,
                        "model": model_id,
                        "choices": [{"index": 0, "delta": {"content": chunk["text"]}, "finish_reason": None}]
                    }
                    yield f"data: {json.dumps(stream_chunk)}\n\n"
                    
            final_chunk = {
                "id": request_id,
                "object": "chat.completion.chunk",
                "created": created,
                "model": model_id,
                "choices": [{"index": 0, "delta": {}, "finish_reason": "stop"}]
            }
            yield f"data: {json.dumps(final_chunk)}\n\n"
            yield "data: [DONE]\n\n"
            
        return StreamingResponse(event_generator(), media_type="text/event-stream")
    else:
        full_text = ""
        error_msg = None
        async for chunk in service.generate_stream(model_id, messages, **kwargs):
            if "error" in chunk:
                error_msg = chunk["error"]
                break
            if "text" in chunk:
                full_text += chunk["text"]
                
        if error_msg:
            raise HTTPException(status_code=500, detail=error_msg)
            
        response = {
            "id": f"chatcmpl-{uuid.uuid4().hex}",
            "object": "chat.completion",
            "created": int(time.time()),
            "model": model_id,
            "choices": [{
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": full_text,
                },
                "finish_reason": "stop"
            }],
            "usage": {
                "prompt_tokens": 0,
                "completion_tokens": 0,
                "total_tokens": 0
            }
        }
        return JSONResponse(content=response)

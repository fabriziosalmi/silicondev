from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.engine.training import training_orchestrator

router = APIRouter()

class TrainingRequest(BaseModel):
    model_path: str
    dataset_path: str
    iterations: Optional[int] = 100

@router.post("/start")
async def start_training(req: TrainingRequest):
    result = await training_orchestrator.start_finetune(
        model_path=req.model_path,
        dataset_path=req.dataset_path,
        iterations=req.iterations
    )
    if "error" in result:
        raise HTTPException(status_code=400, detail=result["error"])
    return result

@router.get("/status")
async def get_training_status():
    return training_orchestrator.get_status()

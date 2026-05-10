from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.agents.service import AgentService

router = APIRouter()
service = AgentService()

class AgentSave(BaseModel):
    id: Optional[str] = None
    name: str
    nodes: List[Dict[str, Any]]
    edges: List[Dict[str, Any]]
    config: Optional[Dict[str, Any]] = None

@router.get("/")
async def get_agents():
    return service.get_agents()

@router.post("/")
async def save_agent(agent: AgentSave):
    return service.save_agent(agent.model_dump())

@router.post("/{agent_id}/execute")
async def execute_agent(agent_id: str, payload: Dict[str, Any]):
    try:
        input_text = payload.get("input", "")
        run_id = payload.get("run_id")
        return await service.execute_agent(agent_id, input_text, run_id=run_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/{agent_id}/runs")
async def get_runs(agent_id: str):
    """Get run history for an agent."""
    return service.get_runs(agent_id)

@router.post("/{agent_id}/runs/{run_id}/resume")
async def resume_run(agent_id: str, run_id: str):
    """Resume a failed or paused run."""
    try:
        return await service.execute_agent(agent_id, "", run_id=run_id)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/{agent_id}")
async def delete_agent(agent_id: str):
    if service.delete_agent(agent_id):
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Agent not found")

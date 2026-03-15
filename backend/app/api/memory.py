from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.memory.service import memory_graph

router = APIRouter()

class NodeSchema(BaseModel):
    id: str
    type: str
    label: str
    content: Optional[str] = ""
    metadata: Optional[Dict[str, Any]] = None

class EdgeSchema(BaseModel):
    source: str
    target: str
    relation: str
    metadata: Optional[Dict[str, Any]] = None

@router.get("/nodes")
async def get_nodes():
    return memory_graph.get_all_nodes()

@router.get("/edges")
async def get_edges():
    return memory_graph.get_all_edges()

@router.post("/nodes")
async def add_node(node: NodeSchema):
    memory_graph.add_node(node.id, node.type, node.label, node.content, node.metadata)
    return {"status": "ok"}

@router.post("/edges")
async def add_edge(edge: EdgeSchema):
    memory_graph.add_edge(edge.source, edge.target, edge.relation, edge.metadata)
    return {"status": "ok"}

@router.get("/query/{node_id}")
async def query_related(node_id: str, relation: Optional[str] = None):
    return memory_graph.query_related(node_id, relation)

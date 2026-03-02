from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List
from app.rag.service import RagService
from app.security import safe_id, safe_user_file

router = APIRouter()
service = RagService()

class CollectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)

class IngestRequest(BaseModel):
    collection_id: str
    files: List[str] = Field(min_length=1)
    chunk_size: int = Field(default=512, ge=64, le=8192)
    overlap: int = Field(default=50, ge=0, le=4096)

class QueryRequest(BaseModel):
    collection_id: str
    query: str = Field(min_length=1)
    n_results: int = Field(default=5, ge=1, le=20)
    max_context_chars: int = Field(default=0, ge=0, le=100000)

@router.get("/collections")
def get_collections():
    return service.get_collections()

@router.post("/collections")
def create_collection(req: CollectionCreate):
    return service.create_collection(req.name)

@router.delete("/collections/{collection_id}")
def delete_collection(collection_id: str):
    try:
        safe_id(collection_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if service.delete_collection(collection_id):
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Collection not found")

@router.post("/ingest")
def ingest_files(req: IngestRequest):
    try:
        safe_id(req.collection_id)
        validated_files = [str(safe_user_file(f)) for f in req.files]
        return service.ingest_files(req.collection_id, validated_files, req.chunk_size, req.overlap)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.post("/query")
def query_collection(req: QueryRequest):
    results = service.query(
        req.collection_id, req.query, req.n_results,
        max_context_chars=req.max_context_chars,
    )
    return {"results": results}

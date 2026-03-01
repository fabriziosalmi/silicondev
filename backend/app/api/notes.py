from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from app.notes.service import NotesService

router = APIRouter()
service = NotesService()


class NoteCreate(BaseModel):
    title: str = "Untitled"
    content: str = ""


class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    pinned: Optional[bool] = None


@router.get("/")
async def list_notes():
    return service.list_notes()


@router.get("/{note_id}")
async def get_note(note_id: str):
    note = service.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.post("/")
async def create_note(req: NoteCreate):
    return service.create_note(title=req.title, content=req.content)


@router.patch("/{note_id}")
async def update_note(note_id: str, req: NoteUpdate):
    updates = req.model_dump(exclude_none=True)
    note = service.update_note(note_id, updates)
    if not note:
        raise HTTPException(status_code=404, detail="Note not found")
    return note


@router.delete("/{note_id}")
async def delete_note(note_id: str):
    if service.delete_note(note_id):
        return {"status": "deleted"}
    raise HTTPException(status_code=404, detail="Note not found")

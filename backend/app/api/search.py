import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)
router = APIRouter()


class SearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=500)
    max_results: int = Field(default=3, ge=1, le=10)


@router.post("/web")
async def web_search(req: SearchRequest):
    """Search the web using DuckDuckGo. Falls back gracefully if the library is not installed."""
    try:
        from duckduckgo_search import DDGS
    except ImportError:
        raise HTTPException(
            status_code=501,
            detail="Web search requires duckduckgo-search. Install with: pip install duckduckgo-search"
        )

    try:
        with DDGS() as ddgs:
            results = [
                {"title": r["title"], "snippet": r["body"], "url": r["href"]}
                for r in ddgs.text(req.query, max_results=req.max_results)
            ]
        return {"results": results}
    except Exception as e:
        logger.warning(f"Web search failed: {e}")
        raise HTTPException(status_code=502, detail=f"Search failed: {str(e)}")

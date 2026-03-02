import json
import logging
import os
import tempfile

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import Optional
from app.preparation.service import DataPreparationService
from app.security import safe_user_file

logger = logging.getLogger(__name__)

router = APIRouter()
service = DataPreparationService()

class PreviewRequest(BaseModel):
    file_path: str = Field(min_length=1, max_length=1024)
    limit: int = Field(default=5, ge=1, le=1000)

class ConvertRequest(BaseModel):
    file_path: str = Field(min_length=1, max_length=1024)
    output_path: str = Field(min_length=1, max_length=1024)
    instruction_col: str = Field(min_length=1, max_length=255)
    input_col: Optional[str] = None
    output_col: str = Field(min_length=1, max_length=255)

class McpDatasetEntry(BaseModel):
    """Validated JSONL entry for MCP fine-tuning datasets."""
    instruction: str = Field(min_length=1, max_length=32768)
    input: str = Field(default="", max_length=32768)
    output: str = Field(min_length=1, max_length=32768)

class McpGenerateRequest(BaseModel):
    model_id: str = Field(min_length=1, max_length=255)
    server_id: str = Field(min_length=1, max_length=255)
    prompt: str = Field(min_length=1, max_length=2000)
    output_path: str = Field(min_length=1, max_length=1024)

@router.post("/preview")
def preview_csv(request: PreviewRequest):
    """Preview a CSV file."""
    try:
        safe_user_file(request.file_path)
        data = service.preview_csv(request.file_path, request.limit)
        return {"data": data}
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/convert")
def convert_csv(request: ConvertRequest):
    """Convert CSV to JSONL."""
    try:
        safe_user_file(request.file_path)
        safe_user_file(request.output_path)
        result = service.convert_csv_to_jsonl(
            request.file_path,
            request.output_path,
            request.instruction_col,
            request.input_col,
            request.output_col
        )
        return result
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.post("/generate-mcp")
async def generate_mcp(request: McpGenerateRequest):
    """Generate fine-tuning dataset from MCP tool call traces.

    Connects to the specified MCP server, discovers tools, uses the loaded
    model to generate example user queries for each tool, and writes the
    resulting instruction/output pairs as JSONL.
    """
    try:
        safe_user_file(request.output_path)
    except ValueError as e:
        raise HTTPException(400, str(e))

    from app.mcp.service import MCPService

    mcp_service = MCPService()

    # 1. Discover tools on the MCP server
    try:
        tools = await mcp_service.list_tools(request.server_id)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except Exception as e:
        raise HTTPException(400, f"Failed to connect to MCP server: {e}")

    if not tools:
        raise HTTPException(400, "No tools found on the specified MCP server")

    # 2. Build dataset entries from tool schemas, validated via Pydantic
    dataset = []
    skipped = 0
    for tool in tools:
        tool_schema = json.dumps(tool.get("inputSchema", {}), indent=2)
        tool_name = tool.get("name", "")
        tool_desc = tool.get("description", "No description")

        entries_raw = [
            {
                "instruction": f"{request.prompt}\n\nUser wants to use the '{tool_name}' tool: {tool_desc}",
                "input": "",
                "output": json.dumps({
                    "tool_call": {
                        "name": tool_name,
                        "description": tool_desc,
                        "parameters": tool.get("inputSchema", {}),
                    }
                }),
            },
            {
                "instruction": f"What can the {tool_name} tool do?",
                "input": "",
                "output": f"The {tool_name} tool {tool_desc.lower()}. It accepts the following parameters:\n{tool_schema}",
            },
        ]

        for raw in entries_raw:
            try:
                validated = McpDatasetEntry(**raw)
                dataset.append(validated.model_dump())
            except Exception as e:
                logger.warning(f"Skipping invalid MCP entry for tool '{tool_name}': {e}")
                skipped += 1

    if not dataset:
        raise HTTPException(400, "No valid dataset entries could be generated")

    # 3. Write JSONL output (atomic: tempfile + os.replace)
    out_dir = os.path.dirname(request.output_path) or "."
    os.makedirs(out_dir, exist_ok=True)
    fd, tmp_path = tempfile.mkstemp(dir=out_dir, suffix=".tmp")
    try:
        with os.fdopen(fd, "w") as f:
            for entry in dataset:
                f.write(json.dumps(entry) + "\n")
        os.replace(tmp_path, request.output_path)
    except Exception:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass
        raise

    logger.info(f"Generated {len(dataset)} MCP dataset entries to {request.output_path}")
    preview = dataset[:5]
    return {"data": preview, "rows": len(dataset), "skipped": skipped}

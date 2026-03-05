"""Shared types for the NanoCore agent terminal."""

from enum import Enum
from dataclasses import dataclass, field
from typing import Literal, Optional
import time

from pydantic import BaseModel, Field


class AgentRole(str, Enum):
    supervisor = "supervisor"
    coder = "coder"
    executor = "executor"


class AgentState(str, Enum):
    thinking = "thinking"
    tool_calling = "tool_calling"
    waiting_human_approval = "waiting_human_approval"
    done = "done"
    error = "error"


SSEEventType = Literal[
    "session_start",
    "token_stream",
    "thinking",
    "step_label",
    "tool_start",
    "tool_log",
    "tool_done",
    "diff_proposal",
    "human_escalation",
    "telemetry_update",
    "budget_exhausted",
    "auto_retry",
    "undo_applied",
    "lint_result",
    "error",
    "done",
]


@dataclass
class TrajectoryEntry:
    timestamp: float = field(default_factory=time.time)
    agent: str = ""
    action: str = ""
    input: str = ""
    output: str = ""
    tokens: int = 0
    duration_ms: float = 0


class FileContext(BaseModel):
    path: str = Field(max_length=1024)
    content: Optional[str] = Field(default=None, max_length=500000)
    language: Optional[str] = Field(default=None, max_length=64)


class ConversationTurn(BaseModel):
    role: str = Field(min_length=1, max_length=20)  # "user" or "assistant"
    content: str = Field(min_length=1, max_length=32768)


class TerminalRequest(BaseModel):
    prompt: str = Field(min_length=1, max_length=32768)
    model_id: str = Field(min_length=1, max_length=255)
    max_iterations: int = Field(default=10, ge=1, le=50)
    temperature: float = Field(default=0.3, ge=0.0, le=2.0)
    max_total_tokens: int = Field(default=50000, ge=1000, le=500000)
    active_file: Optional[FileContext] = Field(default=None)
    history: Optional[list[ConversationTurn]] = Field(default=None, max_length=20)
    mode: str = Field(default="edit", pattern="^(edit|review)$")
    workspace_dir: Optional[str] = Field(default=None, max_length=2048)


class DiffDecision(BaseModel):
    session_id: str = Field(min_length=1)
    call_id: str = Field(min_length=1)
    approved: bool
    reason: str = Field(default="", max_length=1024)


class EscalationResponse(BaseModel):
    session_id: str = Field(min_length=1)
    escalation_id: str = Field(min_length=1)
    user_message: str = Field(default="", max_length=4096)


class UndoRequest(BaseModel):
    session_id: str = Field(min_length=1)

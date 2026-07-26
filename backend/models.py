"""Pydantic 数据模型 — API 响应格式。"""

from __future__ import annotations

from typing import Dict, List, Optional

from pydantic import BaseModel


class StepOut(BaseModel):
    id: int
    session_id: str
    turn_id: Optional[int] = None
    step_index: int
    type: str  # thinking | tool_call | tool_result | text | system | attachment
    timestamp: Optional[int] = None
    duration_ms: Optional[int] = None
    tool_name: Optional[str] = None
    tool_input: Optional[str] = None
    tool_output: Optional[str] = None
    tool_use_id: Optional[str] = None
    content: Optional[str] = None
    description: Optional[str] = None
    input_tokens: int = 0
    output_tokens: int = 0
    cache_read_tokens: int = 0


class TurnOut(BaseModel):
    turn_index: int
    session_id: str
    user_message: Optional[str] = None
    started_at: Optional[int] = None
    finished_at: Optional[int] = None
    input_tokens: int = 0
    output_tokens: int = 0
    steps: List[StepOut] = []


class SessionOut(BaseModel):
    id: str
    agent: str
    project_path: Optional[str] = None
    title: Optional[str] = None
    started_at: Optional[int] = None
    finished_at: Optional[int] = None
    status: str = "unknown"
    total_input_tokens: int = 0
    total_output_tokens: int = 0
    total_cache_read_tokens: int = 0
    file_path: str


class StatsOut(BaseModel):
    total_steps: int
    total_turns: int
    total_input_tokens: int
    total_output_tokens: int
    total_cache_read_tokens: int
    total_duration_ms: int
    tool_counts: Dict[str, int]
    type_counts: Dict[str, int]

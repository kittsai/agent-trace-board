"""知识提取数据模型。"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class KnowledgeType(str, Enum):
    """知识类型枚举。"""
    CODE_STYLE = "code_style"
    ARCHITECTURE = "architecture"
    TOOL_CONFIG = "tool_config"
    FIX_PATTERN = "fix_pattern"
    PREFERENCE = "preference"


class KnowledgeStatus(str, Enum):
    """知识状态枚举。"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class WriteLevel(str, Enum):
    """写入级别枚举。"""
    PROJECT = "project"
    USER = "user"


class SourceTurn(BaseModel):
    """来源 turn 信息。"""
    session_id: str
    turn_index: int
    description: Optional[str] = None


class KnowledgeItem(BaseModel):
    """知识条目。"""
    id: str
    project_path: str
    type: KnowledgeType
    content: str
    title: Optional[str] = None
    confidence: float = Field(ge=0, le=1, default=0.5)
    status: KnowledgeStatus = KnowledgeStatus.PENDING
    source_sessions: list[str] = Field(default_factory=list)
    source_turns: list[SourceTurn] = Field(default_factory=list)
    write_level: WriteLevel = WriteLevel.PROJECT
    is_modified: bool = False
    created_at: datetime = Field(default_factory=datetime.now)
    approved_at: Optional[datetime] = None
    synced_at: Optional[datetime] = None
    synced_path: Optional[str] = None


class AnalysisJobStatus(str, Enum):
    """分析任务状态枚举。"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AnalysisJob(BaseModel):
    """分析任务。"""
    id: str
    session_id: str
    project_path: str
    status: AnalysisJobStatus = AnalysisJobStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cost_usd: float = 0.0
    items_extracted: int = 0
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)

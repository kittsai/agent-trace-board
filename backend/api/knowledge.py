"""Knowledge API 路由。"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models import KnowledgeItemOut
from services.analyzer.service import get_analyzer_service

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class UpdateKnowledgeRequest(BaseModel):
    """更新知识条目请求。"""
    type: Optional[str] = None
    content: Optional[str] = None
    title: Optional[str] = None
    confidence: Optional[float] = None
    write_level: Optional[str] = None


class BatchApproveRequest(BaseModel):
    """批量批准请求。"""
    item_ids: list[str]


class ScanProjectsRequest(BaseModel):
    """扫描项目请求。"""
    paths: list[str]


def _discover_projects() -> list[dict]:
    """扫描 ~/.claude/projects/ 发现项目。"""
    claude_dir = Path.home() / ".claude" / "projects"
    if not claude_dir.exists():
        return []

    projects = []
    existing_projects = set()

    # 获取已添加的项目
    service = get_analyzer_service()
    for p in service.get_projects():
        existing_projects.add(p.get("path", ""))

    for dir_name in os.listdir(claude_dir):
        dir_path = claude_dir / dir_name
        if not dir_path.is_dir():
            continue

        # 将目录名转换为实际项目路径
        # -Users-cosmic-Work-project-ai-agent-insight-board -> /Users/cosmic/Work/project/ai/agent-insight-board
        project_path = "/" + dir_name.lstrip("-").replace("-", "/")

        # 检查路径是否有效
        if not os.path.exists(project_path):
            continue

        # 统计 sessions 数量
        sessions_dir = dir_path / "sessions"
        session_count = 0
        last_activity = None
        if sessions_dir.exists():
            session_files = list(sessions_dir.glob("*.jsonl"))
            session_count = len(session_files)
            for f in session_files:
                mtime = datetime.fromtimestamp(f.stat().st_mtime)
                if last_activity is None or mtime > last_activity:
                    last_activity = mtime

        # 格式化最后活动时间
        last_activity_str = "未知"
        if last_activity:
            diff = datetime.now() - last_activity
            if diff.days == 0:
                last_activity_str = "今天"
            elif diff.days == 1:
                last_activity_str = "昨天"
            elif diff.days < 7:
                last_activity_str = f"{diff.days} 天前"
            elif diff.days < 30:
                last_activity_str = f"{diff.days // 7} 周前"
            else:
                last_activity_str = f"{diff.days // 30} 个月前"

        projects.append({
            "path": project_path,
            "name": project_path.split("/")[-1],
            "session_count": session_count,
            "last_activity": last_activity_str,
            "is_new": project_path not in existing_projects,
        })

    return projects


def _item_to_out(item) -> dict:
    """将 KnowledgeItem 转换为 API 响应格式。"""
    return {
        "id": item.id,
        "project_path": item.project_path,
        "type": item.type.value if hasattr(item.type, 'value') else item.type,
        "content": item.content,
        "title": item.title,
        "confidence": item.confidence,
        "status": item.status.value if hasattr(item.status, 'value') else item.status,
        "source_sessions": item.source_sessions,
        "source_turns": [
            {"session_id": t.session_id, "turn_index": t.turn_index, "description": t.description}
            for t in item.source_turns
        ],
        "write_level": item.write_level.value if hasattr(item.write_level, 'value') else item.write_level,
        "is_modified": item.is_modified,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "approved_at": item.approved_at.isoformat() if item.approved_at else None,
        "synced_at": item.synced_at.isoformat() if item.synced_at else None,
        "synced_path": item.synced_path,
    }


@router.get("/projects")
async def get_projects():
    """获取所有项目。"""
    service = get_analyzer_service()
    return service.get_projects()


@router.get("/items")
async def get_knowledge_items(
    project_path: Optional[str] = None,
    status: Optional[str] = None,
    type: Optional[str] = None,
):
    """获取知识条目列表。"""
    service = get_analyzer_service()
    items = service.get_knowledge_items(project_path, status, type)
    return [_item_to_out(item) for item in items]


@router.get("/items/{item_id}")
async def get_knowledge_item(item_id: str):
    """获取单个知识条目。"""
    service = get_analyzer_service()
    item = service.get_knowledge_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.put("/items/{item_id}")
async def update_knowledge_item(item_id: str, request: UpdateKnowledgeRequest):
    """更新知识条目。"""
    service = get_analyzer_service()
    item = service.update_knowledge_item(
        item_id,
        type=request.type,
        content=request.content,
        title=request.title,
        confidence=request.confidence,
        write_level=request.write_level,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.post("/items/{item_id}/approve")
async def approve_item(item_id: str):
    """批准知识条目。"""
    service = get_analyzer_service()
    item = service.approve_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.post("/items/{item_id}/reject")
async def reject_item(item_id: str):
    """拒绝知识条目。"""
    service = get_analyzer_service()
    item = service.reject_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.post("/batch-approve")
async def batch_approve(request: BatchApproveRequest):
    """批量批准知识条目。"""
    service = get_analyzer_service()
    count = service.batch_approve(request.item_ids)
    return {"approved": count}


@router.get("/stats")
async def get_stats(project_path: Optional[str] = None):
    """获取统计信息。"""
    service = get_analyzer_service()
    return service.get_stats(project_path)


@router.get("/projects/scan")
async def scan_projects():
    """扫描发现新项目。"""
    return _discover_projects()


@router.post("/projects")
async def add_projects(request: ScanProjectsRequest):
    """添加项目。"""
    service = get_analyzer_service()
    added = []
    for path in request.paths:
        if os.path.exists(path):
            # 创建项目记录
            service.add_project(path)
            added.append(path)
    return {"added": added}

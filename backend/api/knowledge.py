"""Knowledge API 路由。"""

from __future__ import annotations

from datetime import datetime
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

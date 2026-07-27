"""文件变更历史 API — 只读。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services.file_history_service import get_file_history_service

router = APIRouter(tags=["file-history"])


@router.get("/sessions/{session_id}/file-changes")
async def list_file_changes(session_id: str):
    """列出会话中所有文件变更。"""
    service = get_file_history_service()
    changes = service.list_file_changes(session_id)
    return {"items": changes, "total": len(changes)}


@router.get("/sessions/{session_id}/file-changes/{message_id}")
async def get_file_change(session_id: str, message_id: str):
    """获取单个文件变更的 unified diff。"""
    service = get_file_history_service()
    diff = service.get_diff(session_id, message_id)
    if not diff:
        raise HTTPException(status_code=404, detail="File change not found")
    return diff

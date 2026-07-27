"""Session REST API — 只读。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["sessions"])


@router.get("/sessions")
async def list_sessions(
    search: Optional[str] = None,
    status: Optional[str] = None,
):
    """列出所有 session。"""
    from services.session_service import get_session_service

    service = get_session_service()
    sessions = service.list_sessions(search=search, status=status)
    return {"items": sessions, "total": len(sessions)}


@router.get("/sessions/{session_id}")
async def get_session(session_id: str):
    """获取 session 详情。"""
    from services.session_service import get_session_service

    service = get_session_service()
    session = service.get_session(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session

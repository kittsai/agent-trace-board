"""Trace 查询 API — 只读。"""

from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException

router = APIRouter(tags=["traces"])


@router.get("/sessions/{session_id}/turns")
async def get_turns(session_id: str):
    """获取 session 的所有 turns。"""
    from services.session_service import get_session_service

    service = get_session_service()
    turns = service.get_turns(session_id)
    return turns


@router.get("/sessions/{session_id}/steps")
async def get_steps(
    session_id: str,
    type: Optional[str] = None,
    tool_name: Optional[str] = None,
    search: Optional[str] = None,
):
    """获取 session 的 steps，支持过滤。"""
    from services.session_service import get_session_service

    service = get_session_service()
    steps = service.get_steps(session_id, type=type, tool_name=tool_name, search=search)
    return steps


@router.get("/sessions/{session_id}/stats")
async def get_stats(session_id: str):
    """获取 session 统计信息。"""
    from services.session_service import get_session_service

    service = get_session_service()
    stats = service.get_stats(session_id)
    if not stats:
        raise HTTPException(status_code=404, detail="Session not found")
    return stats

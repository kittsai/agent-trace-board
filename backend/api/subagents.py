"""子 agent API — 只读。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services.subagent_service import get_subagent_service

router = APIRouter(tags=["subagents"])


@router.get("/sessions/{session_id}/subagents")
async def list_subagents(session_id: str):
    """列出会话派发的子 agent。"""
    service = get_subagent_service()
    items = service.list_subagents(session_id)
    return {"items": items, "total": len(items)}


@router.get("/sessions/{session_id}/subagents/{tool_use_id}")
async def get_subagent_trace(session_id: str, tool_use_id: str):
    """返回指定子 agent 的完整 trace。"""
    service = get_subagent_service()
    trace = service.get_subagent_trace(session_id, tool_use_id)
    if trace is None:
        raise HTTPException(status_code=404, detail="Subagent trace not found")
    return trace

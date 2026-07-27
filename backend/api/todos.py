"""任务追踪 API — 只读。"""

from __future__ import annotations

from fastapi import APIRouter

from services.todo_service import get_todo_service

router = APIRouter(tags=["todos"])


@router.get("/sessions/{session_id}/todos")
async def list_todos(session_id: str):
    """列出会话的任务列表及状态轨迹。"""
    service = get_todo_service()
    tasks = service.list_todos(session_id)
    return {"items": tasks, "total": len(tasks)}

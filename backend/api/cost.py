"""Token / 成本分析 API — 只读。"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from services.cost_service import get_cost_service

router = APIRouter(tags=["cost"])


@router.get("/sessions/{session_id}/cost")
async def get_cost(session_id: str):
    """获取 session 的 token/成本分析。"""
    service = get_cost_service()
    analysis = service.analyze(session_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return analysis

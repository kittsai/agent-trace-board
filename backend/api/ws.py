"""WebSocket handler。"""

from __future__ import annotations

import asyncio
import json
from typing import Dict, Set

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

router = APIRouter(tags=["websocket"])

# 全局 WebSocket 连接管理
_connections: Dict[str, Set[WebSocket]] = {}
_monitor_connections: Set[WebSocket] = set()


async def broadcast_step(session_id: str, step: dict):
    """向指定 session 的所有连接广播 step，同时也发给 monitor 连接。"""
    # 发给 session 专属连接
    conns = _connections.get(session_id)
    if conns:
        dead = set()
        for ws in conns:
            try:
                await ws.send_json({"event": "step", "session_id": session_id, "step": step})
            except Exception:
                dead.add(ws)
        conns.difference_update(dead)

    # 也发给 monitor 连接
    dead_monitor = set()
    for ws in _monitor_connections:
        try:
            await ws.send_json({"event": "step", "session_id": session_id, "step": step})
        except Exception:
            dead_monitor.add(ws)
    _monitor_connections.difference_update(dead_monitor)


async def broadcast_session_status(session_id: str, status: str):
    """广播 session 状态变化。"""
    conns = _connections.get(session_id)
    if conns:
        dead = set()
        for ws in conns:
            try:
                await ws.send_json({"event": "session_status", "session_id": session_id, "status": status})
            except Exception:
                dead.add(ws)
        conns.difference_update(dead)

    # 也通知 monitor 连接
    dead_monitor = set()
    for ws in _monitor_connections:
        try:
            await ws.send_json({"event": "session_status", "session_id": session_id, "status": status})
        except Exception:
            dead_monitor.add(ws)
    _monitor_connections.difference_update(dead_monitor)


async def broadcast_new_session(session: dict):
    """广播新 session 发现。"""
    dead = set()
    for ws in _monitor_connections:
        try:
            await ws.send_json({"event": "new_session", "session": session})
        except Exception:
            dead.add(ws)
    _monitor_connections.difference_update(dead)


@router.websocket("/ws/sessions/{session_id}")
async def session_ws(websocket: WebSocket, session_id: str):
    """特定 session 的实时 step 推送。"""
    await websocket.accept()
    if session_id not in _connections:
        _connections[session_id] = set()
    _connections[session_id].add(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        _connections[session_id].discard(websocket)
        if not _connections[session_id]:
            del _connections[session_id]


@router.websocket("/ws/monitor")
async def monitor_ws(websocket: WebSocket):
    """全局监控：新 session 通知、活跃 session 列表。"""
    await websocket.accept()
    _monitor_connections.add(websocket)

    try:
        while True:
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        _monitor_connections.discard(websocket)

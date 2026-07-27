"""FastAPI 应用入口。"""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.sessions import router as sessions_router
from api.traces import router as traces_router
from api.ws import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动 watcher。"""
    from services.session_service import get_session_service
    from services.watcher import SessionWatcher

    session_service = get_session_service()
    watcher = SessionWatcher(session_service=session_service)
    await watcher.start()
    app.state.watcher = watcher

    yield

    await watcher.stop()


app = FastAPI(
    title="Agent Trace Viewer",
    description="Coding Agent 的执行过程录像机",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(sessions_router, prefix="/api")
app.include_router(traces_router, prefix="/api")
app.include_router(ws_router)


@app.get("/api/health")
async def health():
    return {"status": "ok"}

"""Session 文件监听器 — 实时监控 JSONL 文件变化。"""

from __future__ import annotations

import asyncio
import json
from pathlib import Path

from watchfiles import awatch

from api.ws import broadcast_new_session, broadcast_session_status, broadcast_step
from parsers.claude_code import ClaudeCodeParser
from parsers.base import ParseContext

CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
SESSIONS_DIR = CLAUDE_DIR / "sessions"


class SessionWatcher:
    """监听活跃 session 的 JSONL 文件变化。"""

    def __init__(self, session_service=None):
        self.parser = ClaudeCodeParser()
        self._running = False
        self._watch_tasks: dict[str, asyncio.Task] = {}
        self._contexts: dict[str, ParseContext] = {}
        self._file_positions: dict[str, int] = {}
        self._session_service = session_service

    async def start(self):
        """启动监听。"""
        self._running = True
        asyncio.create_task(self._watch_sessions_dir())
        await self._scan_active_sessions()

    async def stop(self):
        """停止所有监听。"""
        self._running = False
        for task in self._watch_tasks.values():
            task.cancel()
        self._watch_tasks.clear()

    async def _watch_sessions_dir(self):
        """监听 ~/.claude/sessions/ 目录，发现新/结束的 session。"""
        if not SESSIONS_DIR.exists():
            return

        async for changes in awatch(SESSIONS_DIR, stop_event=asyncio.Event()):
            if not self._running:
                break
            for change_type, path_str in changes:
                path = Path(path_str)
                if path.suffix == ".json":
                    try:
                        meta = json.loads(path.read_text())
                        session_id = meta.get("sessionId")
                        status = meta.get("status")

                        if session_id and status == "busy":
                            if session_id not in self._watch_tasks:
                                await self._start_watch_session(session_id)
                        elif session_id and status != "busy":
                            if session_id in self._watch_tasks:
                                self._watch_tasks[session_id].cancel()
                                del self._watch_tasks[session_id]
                                await broadcast_session_status(session_id, "completed")
                    except (json.JSONDecodeError, OSError):
                        continue

    async def _scan_active_sessions(self):
        """扫描当前活跃的 session 并开始监听。"""
        if not SESSIONS_DIR.exists():
            return

        for meta_file in SESSIONS_DIR.glob("*.json"):
            try:
                meta = json.loads(meta_file.read_text())
                session_id = meta.get("sessionId")
                status = meta.get("status")
                if session_id and status == "busy":
                    await self._start_watch_session(session_id)
            except (json.JSONDecodeError, OSError):
                continue

    async def _start_watch_session(self, session_id: str):
        """开始监听单个 session 的 JSONL 文件。"""
        jsonl_path = self._find_jsonl_file(session_id)
        if not jsonl_path:
            print(f"[Watcher] 未找到 session {session_id[:12]}... 的 JSONL 文件")
            return

        print(f"[Watcher] 开始监听 session {session_id[:12]}...")

        # 初始化 context（从已有文件大小开始）
        context = ParseContext(session_id=session_id)
        self._contexts[session_id] = context
        self._file_positions[str(jsonl_path)] = self._get_file_size(jsonl_path)

        task = asyncio.create_task(self._watch_jsonl_file(session_id, jsonl_path))
        self._watch_tasks[session_id] = task

        # 通知前端
        await broadcast_new_session({
            "id": session_id,
            "agent": "claude-code",
            "status": "active",
        })

    async def _watch_jsonl_file(self, session_id: str, jsonl_path: Path):
        """监听单个 JSONL 文件的新内容。"""
        path_str = str(jsonl_path)
        context = self._contexts.get(session_id)
        if not context:
            return

        print(f"[Watcher] 开始监听 {session_id[:12]}... ({jsonl_path})")

        async for changes in awatch(jsonl_path, stop_event=asyncio.Event()):
            if not self._running:
                break

            try:
                with open(path_str, "r", encoding="utf-8") as f:
                    f.seek(self._file_positions.get(path_str, 0))
                    new_lines = f.readlines()
                    self._file_positions[path_str] = f.tell()

                if new_lines:
                    print(f"[Watcher] 检测到 {len(new_lines)} 行新内容")

                for line in new_lines:
                    line = line.strip()
                    if not line:
                        continue

                    # 打印原始 entry type
                    try:
                        import json
                        entry = json.loads(line)
                        print(f"[Watcher] entry_type={entry.get('type', '?')}")
                    except:
                        pass

                    steps = self.parser.parse_line(line, context)
                    print(f"[Watcher] 解析出 {len(steps)} 个 steps")
                    for step_data in steps:
                        # 清除缓存（让下次查询重新解析）
                        if self._session_service:
                            self._session_service.invalidate_cache(session_id)
                        # 推送到前端
                        print(f"[Watcher] 推送 step: {step_data.get('type', '?')}")
                        await broadcast_step(session_id, step_data)

            except Exception as e:
                print(f"Error watching {jsonl_path}: {e}")
                await asyncio.sleep(1)

    def _find_jsonl_file(self, session_id: str) -> Path | None:
        """查找 session 对应的 JSONL 文件。"""
        if not PROJECTS_DIR.exists():
            return None
        for project_dir in PROJECTS_DIR.iterdir():
            if not project_dir.is_dir():
                continue
            jsonl_path = project_dir / f"{session_id}.jsonl"
            if jsonl_path.exists():
                return jsonl_path
        return None

    def _get_file_size(self, path: Path) -> int:
        try:
            return path.stat().st_size
        except OSError:
            return 0

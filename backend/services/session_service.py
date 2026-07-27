"""Session 服务 — 直接读取 ~/.claude/ 目录，不存数据库。"""

from __future__ import annotations

import json
import os
from collections import OrderedDict
from pathlib import Path
from typing import Dict, List, Optional

from parsers.claude_code import ClaudeCodeParser, _describe_step

CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"
SESSIONS_DIR = CLAUDE_DIR / "sessions"


class SessionService:
    def __init__(self):
        self.parser = ClaudeCodeParser()
        # 完整解析结果缓存：session_id → {session, turns, steps}
        self._cache: "OrderedDict[str, dict]" = OrderedDict()
        self._CACHE_CAP = 50
        # 列表元数据缓存：file_path → (mtime, summary)
        self._meta_cache: "OrderedDict[str, tuple[float, dict]]" = OrderedDict()
        self._META_CAP = 1000

    def list_sessions(self, search: Optional[str] = None, status: Optional[str] = None) -> List[dict]:
        """列出所有 session。"""
        sessions = []

        if not PROJECTS_DIR.exists():
            return sessions

        status_map = self._build_status_map()

        for project_dir in PROJECTS_DIR.iterdir():
            if not project_dir.is_dir():
                continue
            for jsonl_file in project_dir.glob("*.jsonl"):
                session = self._get_session_summary(jsonl_file, status_map)
                if session:
                    if search and search.lower() not in (session.get("title") or "").lower():
                        continue
                    if status and session.get("status") != status:
                        continue
                    sessions.append(session)

        sessions.sort(key=lambda s: s.get("started_at") or 0, reverse=True)
        return sessions

    def get_session(self, session_id: str) -> Optional[dict]:
        """获取 session 详情。"""
        # 先找文件
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return None

        result = self._parse_cached(jsonl_path)
        return result.get("session")

    def get_steps(self, session_id: str, type: Optional[str] = None, tool_name: Optional[str] = None, search: Optional[str] = None) -> List[dict]:
        """获取 session 的 steps。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return []

        result = self._parse_cached(jsonl_path)
        steps = result.get("steps", [])

        # 过滤
        if type:
            steps = [s for s in steps if s.get("type") == type]
        if tool_name:
            steps = [s for s in steps if s.get("tool_name") == tool_name]
        if search:
            search_lower = search.lower()
            steps = [s for s in steps if self._step_matches(s, search_lower)]

        # 添加描述
        for s in steps:
            if "description" not in s:
                s["description"] = _describe_step(s)

        return steps

    def get_turns(self, session_id: str) -> List[dict]:
        """获取 session 的 turns，每个 turn 包含其 steps。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return []

        result = self._parse_cached(jsonl_path)
        turns = result.get("turns", [])
        all_steps = result.get("steps", [])

        # 为每个 turn 关联其 steps（通过 timestamp 范围）
        for turn in turns:
            t_start = turn.get("started_at")
            t_end = turn.get("finished_at")
            turn_steps = []
            for s in all_steps:
                ts = s.get("timestamp")
                if ts and t_start and t_end and t_start <= ts <= t_end:
                    s_copy = dict(s)
                    if "description" not in s_copy:
                        s_copy["description"] = _describe_step(s_copy)
                    turn_steps.append(s_copy)
            turn["steps"] = turn_steps

        return turns

    def get_stats(self, session_id: str) -> Optional[dict]:
        """获取 session 统计。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return None

        result = self._parse_cached(jsonl_path)
        steps = result.get("steps", [])
        turns = result.get("turns", [])

        tool_counts: Dict[str, int] = {}
        type_counts: Dict[str, int] = {}
        total_duration = 0
        total_input = 0
        total_output = 0
        total_cache = 0
        total_cache_creation = 0

        for s in steps:
            type_counts[s["type"]] = type_counts.get(s["type"], 0) + 1
            if s.get("tool_name"):
                tool_counts[s["tool_name"]] = tool_counts.get(s["tool_name"], 0) + 1
            if s.get("duration_ms"):
                total_duration += s["duration_ms"]
            total_input += s.get("input_tokens", 0)
            total_output += s.get("output_tokens", 0)
            total_cache += s.get("cache_read_tokens", 0)
            total_cache_creation += s.get("cache_creation_tokens", 0)

        return {
            "total_steps": len(steps),
            "total_turns": len(turns),
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_cache_read_tokens": total_cache,
            "total_cache_creation_tokens": total_cache_creation,
            "total_duration_ms": total_duration,
            "tool_counts": tool_counts,
            "type_counts": type_counts,
        }

    def invalidate_cache(self, session_id: str):
        """清除指定 session 的缓存（用于实时更新）。"""
        self._cache.pop(session_id, None)

    # ── 内部方法 ──

    def _find_jsonl(self, session_id: str) -> Optional[Path]:
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

    def _parse_cached(self, jsonl_path: Path) -> dict:
        """带缓存的解析。"""
        session_id = jsonl_path.stem
        if session_id in self._cache:
            self._cache.move_to_end(session_id)
        else:
            self._cache[session_id] = self.parser.parse_file(str(jsonl_path))
            if len(self._cache) > self._CACHE_CAP:
                self._cache.popitem(last=False)
        return self._cache[session_id]

    def _get_session_summary(self, jsonl_path: Path, status_map: dict) -> Optional[dict]:
        """快速获取 session 摘要（mtime-keyed 缓存，只读前几行）。"""
        session_id = jsonl_path.stem
        key = str(jsonl_path)

        try:
            mtime = os.stat(jsonl_path).st_mtime
        except OSError:
            return None

        cached = self._meta_cache.get(key)
        if cached and cached[0] == mtime:
            self._meta_cache.move_to_end(key)
            summary = dict(cached[1])
        else:
            summary = self._read_summary_from_disk(jsonl_path)
            if summary is None:
                return None
            self._meta_cache[key] = (mtime, summary)
            if len(self._meta_cache) > self._META_CAP:
                self._meta_cache.popitem(last=False)
            summary = dict(summary)

        # status 不进缓存:它依赖 sessions/*.json,JSONL 不变时也可能变(agent 停止)
        summary["status"] = status_map.get(session_id, "completed")
        return summary

    def _read_summary_from_disk(self, jsonl_path: Path) -> Optional[dict]:
        """从磁盘读取 session 摘要（只读前 200 行，不含 status）。"""
        session_id = jsonl_path.stem
        project_path = _decode_project_path(jsonl_path.parent.name)
        title = None
        first_ts = None
        last_ts = None

        # 快速扫描：只找 ai-title 和第一行/最后一行的时间戳
        try:
            with open(jsonl_path, "r", encoding="utf-8") as f:
                for i, line in enumerate(f):
                    if i > 200 and title:  # 找到标题就不用继续了
                        break
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue

                    if entry.get("type") == "ai-title" and not title:
                        title = entry.get("aiTitle")

                    ts = entry.get("timestamp")
                    if ts:
                        if first_ts is None:
                            first_ts = _ts_to_ms(ts)
                        last_ts = _ts_to_ms(ts)
        except OSError:
            return None

        return {
            "id": session_id,
            "agent": "claude-code",
            "project_path": project_path,
            "title": title,
            "started_at": first_ts,
            "finished_at": last_ts,
            "total_input_tokens": 0,  # 快速摘要不计算 token
            "total_output_tokens": 0,
            "total_cache_read_tokens": 0,
            "total_cache_creation_tokens": 0,
            "file_path": str(jsonl_path),
        }

    def _build_status_map(self) -> dict[str, str]:
        """一次扫描 sessions/*.json,返回 {sessionId: status}。"""
        if not SESSIONS_DIR.exists():
            return {}
        result: dict[str, str] = {}
        for meta_file in SESSIONS_DIR.glob("*.json"):
            try:
                meta = json.loads(meta_file.read_text())
            except (json.JSONDecodeError, OSError):
                continue
            sid = meta.get("sessionId")
            if sid:
                result[sid] = "active" if meta.get("status") == "busy" else "completed"
        return result

    def _step_matches(self, step: dict, search_lower: str) -> bool:
        """检查 step 是否匹配搜索关键词。"""
        if search_lower in (step.get("content") or "").lower():
            return True
        if search_lower in (step.get("tool_name") or "").lower():
            return True
        if search_lower in (step.get("tool_output") or "").lower():
            return True
        if search_lower in (step.get("tool_input") or "").lower():
            return True
        return False


def _decode_project_path(encoded: str) -> str:
    """解码项目路径。"""
    if encoded.startswith("-"):
        return "/" + encoded[1:].replace("-", "/")
    return encoded


def _ts_to_ms(ts) -> Optional[int]:
    """时间戳转 Unix 毫秒。"""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        return int(ts) if ts > 1e12 else int(ts * 1000)
    if isinstance(ts, str):
        from datetime import datetime
        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except ValueError:
            return None
    return None


# 模块级单例:所有 handler 和 watcher 共享同一个 SessionService,
# 否则每个请求 new 一个实例,_cache 永远是空的,缓存形同虚设。
_service: "SessionService | None" = None


def get_session_service() -> "SessionService":
    global _service
    if _service is None:
        _service = SessionService()
    return _service

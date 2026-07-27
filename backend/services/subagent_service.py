"""子 agent 服务 — 重建会话中派发的子 agent 列表 + 各自的完整 trace。

数据来源:
  - projects/<proj>/<sid>/subagents/agent-<hash>.meta.json:
      {agentType, description, toolUseId, spawnDepth}
  - projects/<proj>/<sid>/subagents/agent-<hash>.jsonl:
      子 agent 完整 transcript(与主 session 同格式,可直接 parse_file)
  - 主 session steps 的 content_blocks 里 Agent tool_use(id == meta.toolUseId):
      join 回 spawn 它的 step_index

join 链:主 trace 的 Agent tool_use 块 id <-> 子 agent meta.toolUseId(已验证相等)。
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional

from parsers.claude_code import ClaudeCodeParser, _describe_step
from services.session_service import get_session_service

CLAUDE_DIR = Path.home() / ".claude"
PROJECTS_DIR = CLAUDE_DIR / "projects"


class SubagentService:
    def __init__(self, parser: Optional[ClaudeCodeParser] = None):
        self.parser = parser or ClaudeCodeParser()

    def list_subagents(self, session_id: str) -> list[dict]:
        """列出会话派发的子 agent,join 回 spawn step。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return []
        subagents_dir = jsonl_path.parent / session_id / "subagents"
        if not subagents_dir.exists():
            return []

        agent_calls = self._build_agent_call_map(session_id)

        result: list[dict] = []
        for meta_file in subagents_dir.glob("*.meta.json"):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            tool_use_id = meta.get("toolUseId")
            agent_id = meta_file.name.removesuffix(".meta.json")
            has_trace = (subagents_dir / f"{agent_id}.jsonl").exists()
            spawn = agent_calls.get(tool_use_id, {})
            result.append({
                "session_id": session_id,
                "agent_id": agent_id,
                "agent_type": meta.get("agentType"),
                "description": meta.get("description"),
                "tool_use_id": tool_use_id,
                "spawn_depth": meta.get("spawnDepth", 1),
                "step_index": spawn.get("step_index"),
                "has_trace": has_trace,
            })
        result.sort(key=lambda x: (x.get("step_index") if x.get("step_index") is not None else 10**9))
        return result

    def get_subagent_trace(self, session_id: str, tool_use_id: str) -> Optional[dict]:
        """返回指定子 agent 的完整 trace(turns with embedded steps)。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return None
        subagents_dir = jsonl_path.parent / session_id / "subagents"
        if not subagents_dir.exists():
            return None

        trace_path = None
        agent_id = None
        agent_type = None
        description = None
        for meta_file in subagents_dir.glob("*.meta.json"):
            try:
                meta = json.loads(meta_file.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            if meta.get("toolUseId") == tool_use_id:
                agent_id = meta_file.name.removesuffix(".meta.json")
                agent_type = meta.get("agentType")
                description = meta.get("description")
                trace_path = subagents_dir / f"{agent_id}.jsonl"
                break
        if not trace_path or not trace_path.exists():
            return None

        parsed = self.parser.parse_file(str(trace_path))
        turns = parsed["turns"]
        all_steps = parsed["steps"]

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

        return {
            "session_id": session_id,
            "tool_use_id": tool_use_id,
            "agent_id": agent_id,
            "agent_type": agent_type,
            "description": description,
            "turns": turns,
        }

    def _build_agent_call_map(self, session_id: str) -> dict[str, dict]:
        """主 session 里 Agent tool_use 的 id -> {step_index, input}。"""
        steps = get_session_service().get_steps(session_id)
        m: dict[str, dict] = {}
        for s in steps:
            for b in (s.get("content_blocks") or []):
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_use" and b.get("name") == "Agent":
                    tuid = b.get("id")
                    if tuid:
                        m[tuid] = {
                            "step_index": s.get("step_index"),
                            "input": b.get("input") or {},
                        }
        return m

    def _find_jsonl(self, session_id: str) -> Optional[Path]:
        if not PROJECTS_DIR.exists():
            return None
        for project_dir in PROJECTS_DIR.iterdir():
            if not project_dir.is_dir():
                continue
            p = project_dir / f"{session_id}.jsonl"
            if p.exists():
                return p
        return None


_service: "SubagentService | None" = None


def get_subagent_service() -> "SubagentService":
    global _service
    if _service is None:
        _service = SubagentService()
    return _service

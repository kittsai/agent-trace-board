"""任务追踪服务 — 重建会话中 agent 维护的任务列表及其状态轨迹。

数据来源:
  - parsed step 的 content_blocks 里 TaskCreate/TaskUpdate 的 tool_use(input 带 subject/status 等)
  - 配对的 tool_result(用 tool_use_id 关联),TaskCreate result 文本含 "Task #N created" 用于提取 id
  - TaskUpdate 的 input 直接带 taskId

重建逻辑:
  1. 扫所有 step,按 tool_use_id 配对 tool_use ↔ tool_result
  2. TaskCreate 建 task(从 result 提取 id,或按出现顺序降级赋 id)
  3. TaskUpdate 追加状态变更事件
  4. 按 task_id 聚合,串成状态轨迹(pending→in_progress→completed/deleted)
"""

from __future__ import annotations

import re
from typing import Optional

from parsers.claude_code import ClaudeCodeParser

# 任务相关工具
_TODO_TOOLS = {"TaskCreate", "TaskUpdate", "TaskGet", "TaskList"}

# TaskCreate result 文本 "Task #N created successfully" 的提取正则
_TASK_ID_RE = re.compile(r"Task #(\d+)")


class TodoService:
    def __init__(self, parser: Optional[ClaudeCodeParser] = None):
        self.parser = parser or ClaudeCodeParser()

    def list_todos(self, session_id: str) -> list[dict]:
        """重建会话的任务列表 + 每个任务的状态变更轨迹。"""
        steps = self._get_steps(session_id)
        if not steps:
            return []

        # tool_use_id -> tool_result content
        result_map = self._build_result_map(steps)

        # 收集所有 TaskCreate/Update tool_use 事件(按时序)
        events = self._collect_tool_events(steps, result_map)

        # 按 task_id 聚合
        tasks: dict[str, dict] = {}
        create_order = 0  # 降级用:TaskCreate result 提不到 id 时按出现顺序赋 id
        for ev in events:
            name = ev["name"]
            inp = ev["input"]

            if name == "TaskCreate":
                task_id = self._extract_task_id(ev["result_content"]) or str(
                    create_order + 1
                )
                create_order += 1
                task = tasks.setdefault(
                    task_id,
                    {
                        "session_id": session_id,
                        "task_id": task_id,
                        "subject": inp.get("subject", ""),
                        "description": inp.get("description", ""),
                        "active_form": inp.get("activeForm", ""),
                        "created_step_index": ev["step_index"],
                        "created_timestamp": ev["timestamp"],
                        "final_status": "pending",
                        "events": [],
                    },
                )
                # 若 task 已被 TaskUpdate 提前建过(无 subject),补齐字段
                if not task["subject"]:
                    task["subject"] = inp.get("subject", "")
                    task["description"] = inp.get("description", "")
                    task["active_form"] = inp.get("activeForm", "")
                    task["created_step_index"] = ev["step_index"]
                    task["created_timestamp"] = ev["timestamp"]
                task["events"].append(
                    {
                        "event_type": "created",
                        "step_index": ev["step_index"],
                        "timestamp": ev["timestamp"],
                        "status": "pending",
                    }
                )
                task["final_status"] = "pending"

            elif name == "TaskUpdate":
                task_id = inp.get("taskId")
                if not task_id:
                    continue
                status = inp.get("status", "pending")
                task = tasks.setdefault(
                    task_id,
                    {
                        "session_id": session_id,
                        "task_id": task_id,
                        "subject": "",
                        "description": "",
                        "active_form": "",
                        "created_step_index": ev["step_index"],
                        "created_timestamp": ev["timestamp"],
                        "final_status": status,
                        "events": [],
                    },
                )
                task["events"].append(
                    {
                        "event_type": "status_changed",
                        "step_index": ev["step_index"],
                        "timestamp": ev["timestamp"],
                        "old_status": task["final_status"],
                        "status": status,
                    }
                )
                task["final_status"] = status

        result = list(tasks.values())
        result.sort(key=lambda t: _sort_key(t["task_id"]))
        return result

    # ── 内部方法 ──

    def _build_result_map(self, steps: list[dict]) -> dict[str, object]:
        """tool_use_id -> tool_result content。"""
        m: dict[str, object] = {}
        for s in steps:
            for b in s.get("content_blocks") or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") == "tool_result":
                    tuid = b.get("tool_use_id")
                    if tuid:
                        m[tuid] = b.get("content")
        return m

    def _collect_tool_events(
        self, steps: list[dict], result_map: dict[str, object]
    ) -> list[dict]:
        """按时序收集所有 TaskCreate/Update tool_use 事件。"""
        events: list[dict] = []
        for s in steps:
            for b in s.get("content_blocks") or []:
                if not isinstance(b, dict):
                    continue
                if b.get("type") != "tool_use":
                    continue
                name = b.get("name")
                if name not in _TODO_TOOLS:
                    continue
                tuid = b.get("id")
                events.append(
                    {
                        "tool_use_id": tuid,
                        "name": name,
                        "input": b.get("input") or {},
                        "step_index": s.get("step_index"),
                        "timestamp": s.get("timestamp"),
                        "result_content": result_map.get(tuid, ""),
                    }
                )
        return events

    def _extract_task_id(self, result_content: object) -> Optional[str]:
        """从 TaskCreate 的 result 文本提取 task id。

        result 可能是 str,也可能是 list[{type:'text', text:'...'}]。
        """
        if not result_content:
            return None
        if isinstance(result_content, list):
            text = " ".join(
                b.get("text", "") if isinstance(b, dict) else str(b)
                for b in result_content
            )
        else:
            text = str(result_content)
        m = _TASK_ID_RE.search(text)
        return m.group(1) if m else None

    def _get_steps(self, session_id: str) -> list[dict]:
        """复用 SessionService 的缓存完整解析结果。"""
        from services.session_service import get_session_service

        return get_session_service().get_steps(session_id)


def _sort_key(task_id: str) -> tuple:
    """task id 排序:数字优先按数值,否则按字符串。"""
    if task_id.isdigit():
        return (0, int(task_id), "")
    return (1, 0, task_id)


# 模块级单例,与 SessionService 一致,共享底层缓存
_service: "TodoService | None" = None


def get_todo_service() -> "TodoService":
    global _service
    if _service is None:
        _service = TodoService()
    return _service

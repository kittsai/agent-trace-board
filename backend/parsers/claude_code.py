"""Claude Code JSONL Parser。

解析 ~/.claude/projects/<path>/<uuid>.jsonl 格式的日志文件。
"""

from __future__ import annotations

import json
from pathlib import Path

from parsers.base import BaseParser, ParseContext

# tool_output 最大 10KB
MAX_OUTPUT_SIZE = 10 * 1024


def _truncate(text: str, max_size: int = MAX_OUTPUT_SIZE) -> str:
    """截断文本，超过 max_size 添加后缀。"""
    if not text or len(text) <= max_size:
        return text or ""
    return text[:max_size] + f"\n[truncated, {len(text)} bytes total]"


def _ts_to_ms(ts) -> int | None:
    """将时间戳转为 Unix 毫秒。"""
    if ts is None:
        return None
    if isinstance(ts, (int, float)):
        # 已经是数字
        return int(ts) if ts > 1e12 else int(ts * 1000)
    if isinstance(ts, str):
        # ISO 8601 字符串
        from datetime import datetime

        try:
            dt = datetime.fromisoformat(ts.replace("Z", "+00:00"))
            return int(dt.timestamp() * 1000)
        except ValueError:
            return None
    return None


def _extract_user_text(message: dict) -> str | None:
    """从 user 消息中提取文本内容。"""
    content = message.get("content", [])
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = []
        for block in content:
            if isinstance(block, dict) and block.get("type") == "text":
                texts.append(block.get("text", ""))
        return "\n".join(texts) if texts else None
    return None


# ── 工具描述映射 ──

TOOL_DESCRIPTIONS = {
    "Bash": "执行命令",
    "Read": "读取文件",
    "Write": "写入文件",
    "Edit": "编辑文件",
    "Glob": "搜索文件",
    "Grep": "搜索内容",
    "Agent": "启动子代理",
    "WebFetch": "获取网页内容",
    "WebSearch": "搜索网页",
    "TaskCreate": "创建任务",
    "TaskUpdate": "更新任务",
    "AskUserQuestion": "询问用户",
    "Skill": "执行技能",
    "EnterPlanMode": "进入计划模式",
    "ExitPlanMode": "退出计划模式",
    "NotebookEdit": "编辑 Notebook",
    "EnterWorktree": "进入工作树",
    "ExitWorktree": "退出工作树",
    "CronCreate": "创建定时任务",
    "CronDelete": "删除定时任务",
    "CronList": "列出定时任务",
}


def _describe_step(step: dict) -> str:
    """生成 step 的可读描述。"""
    step_type = step.get("type", "")

    if step_type == "thinking":
        content = step.get("content", "") or ""
        # 取第一行，截断
        first_line = content.strip().split("\n")[0][:80]
        return f"思考: {first_line}..." if len(content) > 80 else f"思考: {first_line}"

    if step_type == "tool_call":
        tool_name = step.get("tool_name", "unknown")
        base_desc = TOOL_DESCRIPTIONS.get(tool_name, tool_name)

        # 根据工具类型生成更具体的描述
        tool_input = step.get("tool_input", "")
        try:
            input_data = json.loads(tool_input) if tool_input else {}
        except (json.JSONDecodeError, TypeError):
            input_data = {}

        if tool_name == "Bash":
            cmd = input_data.get("command", "")[:60]
            return f"执行命令: {cmd}" if cmd else f"{base_desc}"

        if tool_name == "Read":
            path = input_data.get("file_path", "")
            # 只取文件名
            name = Path(path).name if path else ""
            return f"读取: {name}" if name else base_desc

        if tool_name == "Write":
            path = input_data.get("file_path", "")
            name = Path(path).name if path else ""
            return f"写入: {name}" if name else base_desc

        if tool_name == "Edit":
            path = input_data.get("file_path", "")
            name = Path(path).name if path else ""
            return f"编辑: {name}" if name else base_desc

        if tool_name == "Glob":
            pattern = input_data.get("pattern", "")
            return f"搜索文件: {pattern}" if pattern else base_desc

        if tool_name == "Grep":
            pattern = input_data.get("pattern", "")
            return f"搜索内容: {pattern[:40]}" if pattern else base_desc

        if tool_name == "Agent":
            desc = input_data.get("description", "")
            return f"子代理: {desc}" if desc else base_desc

        if tool_name == "WebFetch":
            url = input_data.get("url", "")[:50]
            return f"获取网页: {url}" if url else base_desc

        if tool_name == "WebSearch":
            query = input_data.get("query", "")[:40]
            return f"搜索: {query}" if query else base_desc

        if tool_name == "AskUserQuestion":
            return "询问用户"

        if tool_name == "Skill":
            skill = input_data.get("skill", "")
            return f"执行技能: {skill}" if skill else base_desc

        return base_desc

    if step_type == "tool_result":
        output = step.get("tool_output", "") or ""
        # 取第一行摘要
        first_line = output.strip().split("\n")[0][:60]
        return f"结果: {first_line}" if first_line else "结果"

    if step_type == "text":
        content = step.get("content", "") or ""
        first_line = content.strip().split("\n")[0][:80]
        return f"回复: {first_line}" if first_line else "回复"

    if step_type == "system":
        return "系统事件"

    if step_type == "attachment":
        # 尝试从 raw_json 中提取 attachment 类型
        try:
            raw = json.loads(step.get("raw_json", "{}"))
            att = raw.get("attachment", {})
            att_type = att.get("type", "")
            hook_name = att.get("hookName", "")
            if att_type == "hook_success" and hook_name:
                return f"Hook: {hook_name}"
            if att_type == "skill_listing":
                return "技能列表注入"
            if att_type:
                return f"注入: {att_type}"
        except (json.JSONDecodeError, TypeError):
            pass
        return "上下文注入"

    return step_type


class ClaudeCodeParser(BaseParser):
    """Claude Code JSONL 解析器。"""

    def parse_file(self, file_path: str) -> dict:
        """离线解析完整 JSONL 文件。"""
        session_id = Path(file_path).stem
        turns: list[dict] = []
        steps: list[dict] = []
        ai_title: str | None = None
        step_index = 0
        current_prompt_id: str | None = None
        turn_index = -1
        turn_input_tokens = 0
        turn_output_tokens = 0
        first_timestamp = None
        last_timestamp = None

        with open(file_path, "r", encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line:
                    continue
                try:
                    entry = json.loads(line)
                except json.JSONDecodeError:
                    continue

                entry_type = entry.get("type")
                timestamp = _ts_to_ms(entry.get("timestamp"))

                if first_timestamp is None and timestamp:
                    first_timestamp = timestamp
                if timestamp:
                    last_timestamp = timestamp

                # ai-title → Session.title
                if entry_type == "ai-title":
                    ai_title = entry.get("aiTitle")
                    continue

                # 跳过不需要的类型
                if entry_type in ("last-prompt", "mode", "permission-mode", "queue-operation", "file-history-snapshot"):
                    continue

                # user 消息 — 一条消息一个 step
                if entry_type == "user":
                    prompt_id = entry.get("promptId")
                    message = entry.get("message", {})
                    content = message.get("content", [])
                    has_tool_result = any(
                        isinstance(b, dict) and b.get("type") == "tool_result"
                        for b in (content if isinstance(content, list) else [])
                    )

                    # 提取 content blocks
                    blocks = []
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict):
                                blocks.append(block)

                    # 生成描述
                    desc_parts = []
                    for b in blocks:
                        bt = b.get("type")
                        if bt == "text":
                            t = b.get("text", "")[:80]
                            desc_parts.append(t)
                        elif bt == "tool_result":
                            output = str(b.get("content", ""))[:60]
                            desc_parts.append(f"结果: {output}")

                    step = {
                        "session_id": session_id,
                        "turn_id": None,
                        "step_index": step_index,
                        "type": "user",
                        "role": "user",
                        "timestamp": timestamp,
                        "duration_ms": None,
                        "tool_name": None,
                        "tool_input": None,
                        "tool_output": None,
                        "tool_use_id": None,
                        "content": _extract_user_text(message),
                        "content_blocks": blocks,
                        "description": " | ".join(desc_parts) if desc_parts else "user",
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_read_tokens": 0,
                        "raw_json": line,
                    }
                    steps.append(step)
                    step_index += 1

                    # Turn 边界：新 promptId → 新 Turn
                    if not has_tool_result and prompt_id and prompt_id != current_prompt_id:
                        if turns:
                            turns[-1]["finished_at"] = timestamp
                            turns[-1]["input_tokens"] = turn_input_tokens
                            turns[-1]["output_tokens"] = turn_output_tokens

                        current_prompt_id = prompt_id
                        turn_index += 1
                        turn_input_tokens = 0
                        turn_output_tokens = 0

                        turns.append({
                            "session_id": session_id,
                            "turn_index": turn_index,
                            "user_message": _extract_user_text(message),
                            "started_at": timestamp,
                            "finished_at": None,
                            "input_tokens": 0,
                            "output_tokens": 0,
                        })

                # assistant 消息 — 一条消息一个 step，保留所有 content blocks
                elif entry_type == "assistant":
                    message = entry.get("message", {})
                    content = message.get("content", [])
                    usage = message.get("usage", {})
                    msg_input = usage.get("input_tokens", 0)
                    msg_output = usage.get("output_tokens", 0)
                    msg_cache = usage.get("cache_read_input_tokens", 0)
                    msg_model = message.get("model")

                    turn_input_tokens += msg_input
                    turn_output_tokens += msg_output

                    # 提取 content blocks
                    blocks = []
                    if isinstance(content, list):
                        for block in content:
                            if isinstance(block, dict):
                                blocks.append(block)

                    # 提取 tool_name（如果有 tool_use）
                    tool_name = None
                    for b in blocks:
                        if b.get("type") == "tool_use":
                            tool_name = b.get("name")
                            break

                    # 生成描述
                    desc_parts = []
                    for b in blocks:
                        bt = b.get("type")
                        if bt == "thinking":
                            thinking = b.get("thinking", "")[:80]
                            desc_parts.append(f"思考: {thinking}...")
                        elif bt == "tool_use":
                            tn = b.get("name", "")
                            td = TOOL_DESCRIPTIONS.get(tn, tn)
                            desc_parts.append(f"{td}")
                        elif bt == "text":
                            t = b.get("text", "")[:80]
                            desc_parts.append(f"回复: {t}...")

                    steps.append({
                        "session_id": session_id,
                        "turn_id": None,
                        "step_index": step_index,
                        "type": "assistant",
                        "role": "assistant",
                        "timestamp": timestamp,
                        "duration_ms": None,
                        "tool_name": tool_name,
                        "model": msg_model,
                        "tool_input": None,
                        "tool_output": None,
                        "tool_use_id": None,
                        "content": None,
                        "content_blocks": blocks,
                        "description": " | ".join(desc_parts) if desc_parts else "assistant",
                        "input_tokens": msg_input,
                        "output_tokens": msg_output,
                        "cache_read_tokens": msg_cache,
                        "raw_json": line,
                    })
                    step_index += 1

                # system 消息
                elif entry_type == "system":
                    steps.append({
                        "session_id": session_id,
                        "turn_id": None,
                        "step_index": step_index,
                        "type": "system",
                        "timestamp": timestamp,
                        "duration_ms": None,
                        "tool_name": None,
                        "tool_input": None,
                        "tool_output": None,
                        "tool_use_id": None,
                        "content": line,
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_read_tokens": 0,
                        "raw_json": line,
                    })
                    step_index += 1

                # attachment
                elif entry_type == "attachment":
                    attachment = entry.get("attachment", {})
                    steps.append({
                        "session_id": session_id,
                        "turn_id": None,
                        "step_index": step_index,
                        "type": "attachment",
                        "timestamp": timestamp,
                        "duration_ms": None,
                        "tool_name": None,
                        "tool_input": None,
                        "tool_output": None,
                        "tool_use_id": None,
                        "content": attachment.get("stdout", ""),
                        "input_tokens": 0,
                        "output_tokens": 0,
                        "cache_read_tokens": 0,
                        "raw_json": line,
                    })
                    step_index += 1

        # 结束最后一个 Turn
        if turns:
            turns[-1]["finished_at"] = last_timestamp
            turns[-1]["input_tokens"] = turn_input_tokens
            turns[-1]["output_tokens"] = turn_output_tokens

        # 关联 step → turn（通过 timestamp 范围）
        for turn in turns:
            t_start = turn["started_at"]
            t_end = turn["finished_at"]
            for step in steps:
                if step["timestamp"] and t_start and t_end:
                    if t_start <= step["timestamp"] <= t_end:
                        step["turn_id"] = turn.get("id")  # DB 层面关联

        # 计算 duration_ms
        for i, step in enumerate(steps):
            if i + 1 < len(steps) and steps[i + 1]["timestamp"] and step["timestamp"]:
                step["duration_ms"] = steps[i + 1]["timestamp"] - step["timestamp"]

        # 汇总 token
        total_input = sum(s["input_tokens"] for s in steps)
        total_output = sum(s["output_tokens"] for s in steps)
        total_cache = sum(s["cache_read_tokens"] for s in steps)

        project_path = _decode_project_path(Path(file_path).parent.name)

        session = {
            "id": session_id,
            "agent": "claude-code",
            "project_path": project_path,
            "title": ai_title,
            "started_at": first_timestamp,
            "finished_at": last_timestamp,
            "status": "active",  # 后续根据 sessions 元数据更新
            "total_input_tokens": total_input,
            "total_output_tokens": total_output,
            "total_cache_read_tokens": total_cache,
            "file_path": str(file_path),
        }

        return {
            "session": session,
            "turns": turns,
            "steps": steps,
        }

    def parse_line(self, line: str, context: ParseContext) -> list[dict]:
        """解析单行 JSONL（实时模式）。"""
        try:
            entry = json.loads(line)
        except json.JSONDecodeError:
            return []

        entry_type = entry.get("type")
        timestamp = _ts_to_ms(entry.get("timestamp"))
        result_steps: list[dict] = []

        # ai-title
        if entry_type == "ai-title":
            context.ai_title = entry.get("aiTitle")
            return []

        # 跳过不需要的类型
        if entry_type in ("last-prompt", "mode", "permission-mode", "queue-operation", "file-history-snapshot"):
            return []

        # user 消息
        if entry_type == "user":
            prompt_id = entry.get("promptId")
            message = entry.get("message", {})
            has_tool_result = any(
                isinstance(b, dict) and b.get("type") == "tool_result"
                for b in (message.get("content", []) if isinstance(message.get("content"), list) else [])
            )

            if has_tool_result:
                content = message.get("content", [])
                if isinstance(content, list):
                    for block in content:
                        if isinstance(block, dict) and block.get("type") == "tool_result":
                            step = {
                                "session_id": context.session_id,
                                "turn_id": None,
                                "step_index": context.step_index,
                                "type": "tool_result",
                                "timestamp": timestamp,
                                "duration_ms": None,
                                "tool_name": None,
                                "tool_input": None,
                                "tool_output": _truncate(str(block.get("content", ""))),
                                "tool_use_id": block.get("tool_use_id"),
                                "content": None,
                                "input_tokens": 0,
                                "output_tokens": 0,
                                "cache_read_tokens": 0,
                                "raw_json": line,
                            }
                            result_steps.append(step)
                            context.step_index += 1
            else:
                # 普通用户消息 → 新 Turn
                user_text = _extract_user_text(message)
                if prompt_id and prompt_id != context.current_prompt_id:
                    context.current_prompt_id = prompt_id
                    context.current_turn_index += 1
                    context.turn_input_tokens = 0
                    context.turn_output_tokens = 0
                    # Turn 记录由 service 层处理

        # assistant 消息
        elif entry_type == "assistant":
            message = entry.get("message", {})
            content = message.get("content", [])
            usage = message.get("usage", {})
            msg_input = usage.get("input_tokens", 0)
            msg_output = usage.get("output_tokens", 0)
            msg_cache = usage.get("cache_read_input_tokens", 0)
            msg_model = message.get("model")

            context.turn_input_tokens += msg_input
            context.turn_output_tokens += msg_output

            # 提取所有 content blocks
            blocks = []
            if isinstance(content, list):
                for block in content:
                    if isinstance(block, dict):
                        blocks.append(block)

            # 提取 tool_name（如果有 tool_use）
            tool_name = None
            for b in blocks:
                if b.get("type") == "tool_use":
                    tool_name = b.get("name")
                    break

            # 生成描述
            desc_parts = []
            for b in blocks:
                bt = b.get("type")
                if bt == "thinking":
                    thinking = b.get("thinking", "")[:80]
                    desc_parts.append(f"思考: {thinking}...")
                elif bt == "tool_use":
                    tn = b.get("name", "")
                    td = TOOL_DESCRIPTIONS.get(tn, tn)
                    desc_parts.append(f"{td}")
                elif bt == "text":
                    t = b.get("text", "")[:80]
                    desc_parts.append(f"回复: {t}...")

            # 作为一个整体 step 推送，包含所有 content_blocks
            result_steps.append({
                "session_id": context.session_id,
                "turn_id": None,
                "step_index": context.step_index,
                "type": "assistant",
                "role": "assistant",
                "timestamp": timestamp,
                "duration_ms": None,
                "tool_name": tool_name,
                "model": msg_model,
                "tool_input": None,
                "tool_output": None,
                "tool_use_id": None,
                "content": None,
                "content_blocks": blocks,
                "description": " | ".join(desc_parts) if desc_parts else "assistant",
                "input_tokens": msg_input,
                "output_tokens": msg_output,
                "cache_read_tokens": msg_cache,
                "raw_json": line,
            })
            context.step_index += 1

        elif entry_type == "system":
            result_steps.append({
                "session_id": context.session_id,
                "turn_id": None,
                "step_index": context.step_index,
                "type": "system",
                "timestamp": timestamp,
                "duration_ms": None,
                "tool_name": None,
                "tool_input": None,
                "tool_output": None,
                "tool_use_id": None,
                "content": line,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "raw_json": line,
            })
            context.step_index += 1

        elif entry_type == "attachment":
            attachment = entry.get("attachment", {})
            result_steps.append({
                "session_id": context.session_id,
                "turn_id": None,
                "step_index": context.step_index,
                "type": "attachment",
                "timestamp": timestamp,
                "duration_ms": None,
                "tool_name": None,
                "tool_input": None,
                "tool_output": None,
                "tool_use_id": None,
                "content": attachment.get("stdout", ""),
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "raw_json": line,
            })
            context.step_index += 1

        return result_steps


def _decode_project_path(encoded: str) -> str:
    """解码项目路径：-Users-cosmic-Work-project-xxx → /Users/cosmic/Work/project/xxx。"""
    if encoded.startswith("-"):
        return "/" + encoded[1:].replace("-", "/")
    return encoded

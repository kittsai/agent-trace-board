"""文件变更历史服务 — 重建会话中 agent 对文件的修改。

数据来源:
  - JSONL 里的 file-history-delta 条目:记录每次文件修改(messageId/trackingPath/backup)
  - 磁盘 ~/.claude/file-history/<sid>/<backupFileName>:文件某版本的完整内容(编辑前快照)
  - parsed step 的 content_blocks 里 tool_use.input:Edit/Write/MultiEdit 的参数,用于反推编辑后内容

delta.messageId == 触发该修改的 assistant 条目的 uuid,由此关联回 step_index。
"""

from __future__ import annotations

import difflib
import json
from pathlib import Path
from typing import Optional

from parsers.claude_code import ClaudeCodeParser, _ts_to_ms

CLAUDE_DIR = Path.home() / ".claude"
FILE_HISTORY_DIR = CLAUDE_DIR / "file-history"
PROJECTS_DIR = CLAUDE_DIR / "projects"

# 这些工具产生的文件修改会被 file-history 跟踪
_FILE_EDIT_TOOLS = {"Edit", "Write", "MultiEdit"}


class FileHistoryService:
    def __init__(self, parser: Optional[ClaudeCodeParser] = None):
        self.parser = parser or ClaudeCodeParser()

    def list_file_changes(self, session_id: str) -> list[dict]:
        """列出会话中所有文件变更,关联回 step_index。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return []

        uuid_to_step = self._build_uuid_step_map(session_id)

        changes: list[dict] = []
        try:
            with open(jsonl_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if entry.get("type") != "file-history-delta":
                        continue
                    backup = entry.get("backup") or {}
                    backup_file_name = backup.get("backupFileName")
                    msg_id = entry.get("messageId")
                    changes.append(
                        {
                            "session_id": session_id,
                            "message_id": msg_id,
                            "step_index": uuid_to_step.get(msg_id),
                            "tracking_path": entry.get("trackingPath"),
                            "backup_file_name": backup_file_name,
                            "version": backup.get("version"),
                            "backup_time": backup.get("backupTime"),
                            "timestamp": _ts_to_ms(entry.get("timestamp")),
                            "is_new_file": backup_file_name is None,
                        }
                    )
        except OSError:
            return []

        changes.sort(key=lambda c: c.get("timestamp") or 0)
        return changes

    def get_diff(self, session_id: str, message_id: str) -> Optional[dict]:
        """重建指定文件变更的 unified diff。"""
        jsonl_path = self._find_jsonl(session_id)
        if not jsonl_path:
            return None

        delta = self._find_delta(jsonl_path, message_id)
        if not delta:
            return None

        backup = delta.get("backup") or {}
        backup_file_name = backup.get("backupFileName")
        tracking_path = delta.get("trackingPath")

        # 编辑前内容:读磁盘备份;新建文件则为空串
        pre_content = ""
        if backup_file_name:
            backup_path = FILE_HISTORY_DIR / session_id / backup_file_name
            try:
                pre_content = backup_path.read_text(encoding="utf-8", errors="replace")
            except OSError:
                pre_content = ""

        # 编辑后内容:从触发 step 的 tool_use input 反推
        step = self._find_step_by_uuid(session_id, message_id)
        post_content = self._reconstruct_post_content(step, tracking_path, pre_content)

        diff_text = "\n".join(
            difflib.unified_diff(
                pre_content.splitlines(keepends=False),
                post_content.splitlines(keepends=False),
                fromfile=f"a/{tracking_path}",
                tofile=f"b/{tracking_path}",
                lineterm="",
            )
        )

        return {
            "session_id": session_id,
            "message_id": message_id,
            "tracking_path": tracking_path,
            "is_new_file": backup_file_name is None,
            "diff": diff_text,
        }

    # ── 内部方法 ──

    def _find_delta(self, jsonl_path: Path, message_id: str) -> Optional[dict]:
        try:
            with open(jsonl_path, encoding="utf-8") as f:
                for line in f:
                    line = line.strip()
                    if not line:
                        continue
                    try:
                        entry = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    if (
                        entry.get("type") == "file-history-delta"
                        and entry.get("messageId") == message_id
                    ):
                        return entry
        except OSError:
            return None
        return None

    def _build_uuid_step_map(self, session_id: str) -> dict[str, int]:
        """从 parsed steps 构建 {assistant uuid: step_index}。"""
        steps = self._get_steps(session_id)
        mapping: dict[str, int] = {}
        for s in steps:
            raw = s.get("raw_json")
            if not raw:
                continue
            try:
                e = json.loads(raw)
            except json.JSONDecodeError:
                continue
            uuid = e.get("uuid")
            if uuid and s.get("step_index") is not None:
                mapping[uuid] = s["step_index"]
        return mapping

    def _find_step_by_uuid(self, session_id: str, uuid: str) -> Optional[dict]:
        steps = self._get_steps(session_id)
        for s in steps:
            raw = s.get("raw_json")
            if not raw:
                continue
            try:
                e = json.loads(raw)
            except json.JSONDecodeError:
                continue
            if e.get("uuid") == uuid:
                return s
        return None

    def _reconstruct_post_content(
        self,
        step: Optional[dict],
        tracking_path: Optional[str],
        pre_content: str,
    ) -> str:
        """从 step 的 tool_use input 反推编辑后内容。"""
        if not step:
            return pre_content

        blocks = step.get("content_blocks") or []
        tool_block = self._match_tool_block(blocks, tracking_path)

        if not tool_block:
            return pre_content

        inp = tool_block.get("input") or {}
        name = tool_block.get("name")

        if name == "Write":
            return inp.get("content", "")

        if name == "Edit":
            old = inp.get("old_string", "")
            new = inp.get("new_string", "")
            if old:
                return pre_content.replace(old, new, 1)
            return pre_content

        if name == "MultiEdit":
            result = pre_content
            for edit in inp.get("edits", []):
                old = edit.get("old_string", "")
                new = edit.get("new_string", "")
                if old:
                    result = result.replace(old, new, 1)
            return result

        return pre_content

    def _match_tool_block(self, blocks: list, tracking_path: Optional[str]) -> Optional[dict]:
        """在 step 的 content_blocks 里找 file_path 与 tracking_path 匹配的 tool_use。"""
        fallback = None
        for b in blocks:
            if not isinstance(b, dict) or b.get("type") != "tool_use":
                continue
            name = b.get("name")
            if name not in _FILE_EDIT_TOOLS:
                continue
            if fallback is None:
                fallback = b
            fp = (b.get("input") or {}).get("file_path", "")
            if _path_matches(fp, tracking_path):
                return b
        # 退化:单文件单工具时直接用第一个
        return fallback

    def _get_steps(self, session_id: str) -> list[dict]:
        """复用 SessionService 的缓存完整解析结果。"""
        from services.session_service import get_session_service

        return get_session_service().get_steps(session_id)

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


def _path_matches(file_path: str, tracking_path: Optional[str]) -> bool:
    """绝对 file_path 与相对 tracking_path 是否指向同一文件。"""
    if not file_path or not tracking_path:
        return False
    if file_path == tracking_path:
        return True
    return file_path.endswith(tracking_path) or tracking_path.endswith(file_path)


# 模块级单例,与 SessionService 一致,共享底层缓存
_service: "FileHistoryService | None" = None


def get_file_history_service() -> "FileHistoryService":
    global _service
    if _service is None:
        _service = FileHistoryService()
    return _service

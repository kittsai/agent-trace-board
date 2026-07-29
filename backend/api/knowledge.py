"""Knowledge API 路由。"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from models import KnowledgeItemOut
from services.analyzer.service import get_analyzer_service

router = APIRouter(prefix="/knowledge", tags=["knowledge"])


class UpdateKnowledgeRequest(BaseModel):
    """更新知识条目请求。"""
    type: Optional[str] = None
    content: Optional[str] = None
    title: Optional[str] = None
    confidence: Optional[float] = None
    write_level: Optional[str] = None


class BatchApproveRequest(BaseModel):
    """批量批准请求。"""
    item_ids: list[str]


class ScanProjectsRequest(BaseModel):
    """扫描项目请求。"""
    paths: list[str]


class AnalyzeRequest(BaseModel):
    """知识萃取请求。"""
    project_path: str


class AnalyzeSessionRequest(BaseModel):
    """单个 session 萃取请求。"""
    project_path: str
    session_id: str


def _convert_dir_name_to_path(dir_name: str) -> Optional[str]:
    """
    将 Claude projects 目录名转换为实际项目路径。

    目录名格式：-Users-cosmic-Work-project-ai-agent-trace-viewer
    实际路径：/Users/cosmic/Work/project/ai/agent-trace-viewer

    问题：目录名中的 - 既是路径分隔符，也是实际目录名的一部分。
    解决：尝试所有可能的转换，返回第一个存在的路径。
    """
    if not dir_name.startswith("-"):
        return None

    # 去掉前缀的 -
    without_prefix = dir_name[1:]

    # 尝试不同的转换策略
    # 策略1：全部替换 - 为 /
    full_replace = "/" + without_prefix.replace("-", "/")
    if os.path.exists(full_replace):
        return full_replace

    # 策略2：只替换前 N 个 - 为 /，保留后面的 -（实际目录名）
    # 例如：-Users-cosmic-Work-project-ai-agent-trace-viewer
    #   尝试 /Users/cosmic/Work/project/ai/agent-trace-viewer
    parts = without_prefix.split("-")
    for i in range(len(parts) - 1, 0, -1):
        path = "/" + "/".join(parts[:i]) + "-" + "-".join(parts[i:])
        if os.path.exists(path):
            return path

    return None


def _discover_projects() -> list[dict]:
    """扫描 ~/.claude/projects/ 发现项目。"""
    claude_dir = Path.home() / ".claude" / "projects"
    if not claude_dir.exists():
        return []

    projects = []
    existing_projects = set()

    # 获取已添加的项目
    service = get_analyzer_service()
    for p in service.get_projects():
        existing_projects.add(p.get("path", ""))

    for dir_name in os.listdir(claude_dir):
        dir_path = claude_dir / dir_name
        if not dir_path.is_dir():
            continue

        # 将目录名转换为实际项目路径
        # 使用更智能的转换：只转换前缀，保留实际目录名中的连字符
        # -Users-cosmic-Work-project-ai-agent-insight-board
        #   -> /Users/cosmic/Work/project/ai/agent-insight-board
        project_path = _convert_dir_name_to_path(dir_name)

        # 检查路径是否有效
        if not project_path or not os.path.exists(project_path):
            continue

        # 统计 sessions 数量（JSONL 文件直接在项目目录下）
        session_count = 0
        last_activity = None
        session_files = list(dir_path.glob("*.jsonl"))
        session_count = len(session_files)
        for f in session_files:
            mtime = datetime.fromtimestamp(f.stat().st_mtime)
            if last_activity is None or mtime > last_activity:
                last_activity = mtime

        # 格式化最后活动时间
        last_activity_str = "未知"
        if last_activity:
            diff = datetime.now() - last_activity
            if diff.days == 0:
                last_activity_str = "今天"
            elif diff.days == 1:
                last_activity_str = "昨天"
            elif diff.days < 7:
                last_activity_str = f"{diff.days} 天前"
            elif diff.days < 30:
                last_activity_str = f"{diff.days // 7} 周前"
            else:
                last_activity_str = f"{diff.days // 30} 个月前"

        projects.append({
            "path": project_path,
            "name": project_path.split("/")[-1],
            "session_count": session_count,
            "last_activity": last_activity_str,
            "is_new": project_path not in existing_projects,
        })

    return projects


def _item_to_out(item) -> dict:
    """将 KnowledgeItem 转换为 API 响应格式。"""
    return {
        "id": item.id,
        "project_path": item.project_path,
        "type": item.type.value if hasattr(item.type, 'value') else item.type,
        "content": item.content,
        "title": item.title,
        "confidence": item.confidence,
        "status": item.status.value if hasattr(item.status, 'value') else item.status,
        "source_sessions": item.source_sessions,
        "source_turns": [
            {"session_id": t.session_id, "turn_index": t.turn_index, "description": t.description}
            for t in item.source_turns
        ],
        "write_level": item.write_level.value if hasattr(item.write_level, 'value') else item.write_level,
        "is_modified": item.is_modified,
        "created_at": item.created_at.isoformat() if item.created_at else None,
        "approved_at": item.approved_at.isoformat() if item.approved_at else None,
        "synced_at": item.synced_at.isoformat() if item.synced_at else None,
        "synced_path": item.synced_path,
    }


@router.get("/projects")
async def get_projects():
    """获取所有项目。"""
    service = get_analyzer_service()
    return service.get_projects()


@router.get("/items")
async def get_knowledge_items(
    project_path: Optional[str] = None,
    status: Optional[str] = None,
    type: Optional[str] = None,
):
    """获取知识条目列表。"""
    service = get_analyzer_service()
    items = service.get_knowledge_items(project_path, status, type)
    return [_item_to_out(item) for item in items]


@router.get("/items/{item_id}")
async def get_knowledge_item(item_id: str):
    """获取单个知识条目。"""
    service = get_analyzer_service()
    item = service.get_knowledge_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.put("/items/{item_id}")
async def update_knowledge_item(item_id: str, request: UpdateKnowledgeRequest):
    """更新知识条目。"""
    service = get_analyzer_service()
    item = service.update_knowledge_item(
        item_id,
        type=request.type,
        content=request.content,
        title=request.title,
        confidence=request.confidence,
        write_level=request.write_level,
    )
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.post("/items/{item_id}/approve")
async def approve_item(item_id: str):
    """批准知识条目。"""
    service = get_analyzer_service()
    item = service.approve_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.post("/items/{item_id}/reject")
async def reject_item(item_id: str):
    """拒绝知识条目。"""
    service = get_analyzer_service()
    item = service.reject_item(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return _item_to_out(item)


@router.post("/batch-approve")
async def batch_approve(request: BatchApproveRequest):
    """批量批准知识条目。"""
    service = get_analyzer_service()
    count = service.batch_approve(request.item_ids)
    return {"approved": count}


@router.get("/stats")
async def get_stats(project_path: Optional[str] = None):
    """获取统计信息。"""
    service = get_analyzer_service()
    return service.get_stats(project_path)


@router.get("/projects/scan")
async def scan_projects():
    """扫描发现新项目。"""
    return _discover_projects()


@router.post("/projects")
async def add_projects(request: ScanProjectsRequest):
    """添加项目。"""
    service = get_analyzer_service()
    added = []
    for path in request.paths:
        if os.path.exists(path):
            # 创建项目记录
            service.add_project(path)
            added.append(path)
    return {"added": added}


@router.get("/projects/{project_path:path}/sessions")
async def get_project_sessions(project_path: str):
    """获取项目下的所有 sessions。"""
    from services.session_service import get_session_service

    session_service = get_session_service()
    all_sessions = session_service.list_sessions()

    # 过滤出该项目的 sessions
    project_sessions = [
        {
            "id": s["id"],
            "title": s.get("title", ""),
            "started_at": s.get("started_at"),
            "status": s.get("status"),
        }
        for s in all_sessions
        if s.get("project_path") == project_path
    ]

    return {"sessions": project_sessions, "count": len(project_sessions)}


@router.post("/analyze/session")
async def analyze_session(request: AnalyzeSessionRequest):
    """分析单个 session，返回知识条目。"""
    from services.session_service import get_session_service

    service = get_analyzer_service()
    session_service = get_session_service()

    # 获取 session 的 turns
    turns = session_service.get_turns(request.session_id)

    # 构建分析数据
    session_data = {
        "session_id": request.session_id,
        "title": "",  # 可以从 session 列表获取
        "turns": turns[:10],
    }

    # 调用 Claude 分析
    items = await _analyze_session_data(session_data, request.project_path)

    # 存储结果
    for item in items:
        service._knowledge_items[item.id] = item

    return {
        "items": [_item_to_out(item) for item in items],
        "count": len(items),
    }


@router.post("/analyze")
async def analyze_project(request: AnalyzeRequest):
    """萃取项目知识（批量）。"""
    from services.session_service import get_session_service

    service = get_analyzer_service()
    session_service = get_session_service()

    # 1. 获取项目下所有 sessions
    project_path = request.project_path
    all_sessions = session_service.list_sessions()

    # 过滤出该项目的 sessions
    project_sessions = [
        s for s in all_sessions
        if s.get("project_path") == project_path
    ]

    if not project_sessions:
        return {"items": [], "message": "该项目没有 session"}

    # 2. 分析每个 session（限制最多 5 个）
    all_items = []
    for session in project_sessions[:5]:
        session_id = session["id"]

        # 获取该 session 的 turns 和 steps
        turns = session_service.get_turns(session_id)

        # 构建分析数据
        session_data = {
            "session_id": session_id,
            "title": session.get("title", ""),
            "turns": turns[:10],  # 限制 turn 数量
        }

        # 调用 Claude 分析
        items = await _analyze_session_data(session_data, project_path)
        all_items.extend(items)

    # 3. 存储结果
    for item in all_items:
        service._knowledge_items[item.id] = item

    # 更新项目统计
    service.add_project(project_path)

    return {
        "items": [_item_to_out(item) for item in all_items],
        "count": len(all_items),
    }


async def _analyze_session_data(session_data: dict, project_path: str) -> list:
    """调用 Claude 分析 session 数据。"""
    import json
    import subprocess
    import uuid

    from services.analyzer.models import KnowledgeItem, KnowledgeType, KnowledgeStatus, WriteLevel

    session_id = session_data['session_id']
    print(f"\n{'='*60}")
    print(f"[萃取] 开始分析 session: {session_id}")
    print(f"[萃取] 项目: {project_path}")

    # 从 turns 中提取用户消息和工具调用
    user_messages = []
    tool_calls = []

    for turn in session_data.get("turns", []):
        # 用户消息
        user_msg = turn.get("user_message", "")
        if user_msg:
            user_messages.append(user_msg[:500])

        # 工具调用（从 steps 中提取）
        for step in turn.get("steps", []):
            if step.get("tool_name"):
                tool_calls.append({
                    "tool": step["tool_name"],
                    "input": str(step.get("tool_input", ""))[:200],
                })

    print(f"[萃取] 提取到 {len(user_messages)} 条用户消息, {len(tool_calls)} 个工具调用")

    # 构建分析 prompt
    prompt = f"""分析以下 AI Agent 执行过程，提取可复用知识。

## Session
- ID: {session_id}
- 标题: {session_data.get('title', '未知')}

## 用户消息
{json.dumps(user_messages[:10], ensure_ascii=False, indent=2)}

## 工具调用
{json.dumps(tool_calls[:20], ensure_ascii=False, indent=2)}

## 提取要求
提取以下类型的知识：
1. **code_style**: 代码规范（命名、格式、组织方式）
2. **architecture**: 架构决策（技术选型、设计模式）
3. **tool_config**: 工具配置（环境、依赖、构建）
4. **fix_pattern**: 修复模式（bug 原因、解决方案）
5. **preference**: 用户偏好（编码习惯、工作流）

## 输出格式
返回 JSON 数组，每个条目：
{{
  "type": "code_style|architecture|tool_config|fix_pattern|preference",
  "title": "简短标题（10字以内）",
  "content": "详细描述（一句话）",
  "confidence": 0.0-1.0
}}

每个类型最多 3 条。只提取有明确证据的知识。
"""

    print(f"[萃取] Prompt 长度: {len(prompt)} 字符")
    print(f"[萃取] 调用 Claude Code CLI...")

    try:
        # 调用 Claude Code CLI
        result = subprocess.run(
            [
                "claude",
                "--print",
                "--output-format", "json",
                "--model", "sonnet",
                "--max-budget-usd", "0.1",
                prompt
            ],
            capture_output=True,
            text=True,
            timeout=120
        )

        print(f"[萃取] Claude CLI 返回码: {result.returncode}")

        if result.returncode != 0:
            print(f"[萃取] ❌ Claude CLI 错误: {result.stderr[:500]}")
            return []

        print(f"[萃取] Claude CLI 原始输出:")
        print(result.stdout[:2000] if len(result.stdout) > 2000 else result.stdout)

        # 解析结果
        print(f"[萃取] 解析 Claude 输出...")
        try:
            output = json.loads(result.stdout)
            items_text = output.get("result", result.stdout)
        except json.JSONDecodeError:
            items_text = result.stdout

        # 从文本中提取 JSON 数组
        items = _extract_json_array(items_text)
        print(f"[萃取] 解析到 {len(items)} 条原始知识")

        # 转换为 KnowledgeItem
        knowledge_items = []
        for item in items:
            try:
                ki = KnowledgeItem(
                    id=str(uuid.uuid4()),
                    project_path=project_path,
                    type=KnowledgeType(item.get("type", "code_style")),
                    title=item.get("title", ""),
                    content=item.get("content", ""),
                    confidence=float(item.get("confidence", 0.5)),
                    source_sessions=[session_data["session_id"]],
                    status=KnowledgeStatus.PENDING,
                    write_level=WriteLevel.PROJECT,
                )
                knowledge_items.append(ki)
                print(f"[萃取] ✓ {ki.type.value}: {ki.title}")
            except Exception as e:
                print(f"[萃取] ✗ 创建知识条目失败: {e}")
                continue

        print(f"[萃取] Session {session_id} 分析完成，提取 {len(knowledge_items)} 条知识")
        print(f"{'='*60}\n")

        return knowledge_items

    except subprocess.TimeoutExpired:
        print(f"[萃取] ❌ Claude CLI 超时")
        return []
    except Exception as e:
        print(f"[萃取] ❌ 分析失败: {e}")
        return []


def _extract_json_array(text: str) -> list:
    """从文本中提取 JSON 数组。"""
    import json

    # 尝试直接解析
    try:
        result = json.loads(text)
        if isinstance(result, list):
            return result
        if isinstance(result, dict) and "result" in result:
            return _extract_json_array(result["result"])
    except json.JSONDecodeError:
        pass

    # 查找 [ 和 ] 之间的内容
    start = text.find("[")
    end = text.rfind("]") + 1
    if start != -1 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

    return []

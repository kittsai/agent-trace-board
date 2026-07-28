# Knowledge Extraction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 从 AI Agent 执行过程中提取有价值的、可管理的知识条目，供用户审批并同步到 CLAUDE.md

**Architecture:** 后端使用 Claude Code CLI 分析 session 数据，提取知识条目并存储到内存数据结构；前端提供 Knowledge 页面，支持项目管理、知识审批、编辑和同步功能

**Tech Stack:** Python (FastAPI), TypeScript (React), Claude Code CLI, SQLite (内存)

---

## File Structure

```
backend/
├── api/
│   └── knowledge.py           # Knowledge API 路由
├── services/
│   └── analyzer/
│       ├── __init__.py
│       ├── service.py          # AnalyzerService 主服务
│       ├── claude_code.py      # ClaudeCodeAnalyzer 分析器
│       └── models.py           # 知识数据模型
├── models.py                   # 添加 KnowledgeItemOut 模型
└── main.py                     # 注册 knowledge router

frontend/src/
├── App.tsx                     # 添加路由和导航
├── components/
│   ├── knowledge/
│   │   ├── ProjectList.tsx     # 左侧项目列表
│   │   ├── KnowledgeList.tsx   # 右侧知识列表
│   │   ├── KnowledgeCard.tsx   # 知识条目卡片
│   │   ├── SyncModal.tsx       # 同步弹窗
│   │   ├── EditModal.tsx       # 编辑弹窗
│   │   └── SessionDetailModal.tsx  # Session 详情浮层
│   └── ui/
│       └── switch.tsx          # shadcn switch 组件
└── hooks/
    └── useKnowledge.ts         # 知识数据 hook
```

---

## Task 1: 后端数据模型

**Files:**
- Create: `backend/services/analyzer/__init__.py`
- Create: `backend/services/analyzer/models.py`
- Modify: `backend/models.py`

**Interfaces:**
- Consumes: 无
- Produces: `KnowledgeItem`, `AnalysisJob`, `KnowledgeItemOut`

- [ ] **Step 1: 创建 analyzer 模块目录**

```bash
mkdir -p backend/services/analyzer
touch backend/services/analyzer/__init__.py
```

- [ ] **Step 2: 创建 analyzer 数据模型**

Create `backend/services/analyzer/models.py`:

```python
"""知识提取数据模型。"""

from __future__ import annotations

from datetime import datetime
from enum import Enum
from typing import Optional

from pydantic import BaseModel, Field


class KnowledgeType(str, Enum):
    """知识类型枚举。"""
    CODE_STYLE = "code_style"
    ARCHITECTURE = "architecture"
    TOOL_CONFIG = "tool_config"
    FIX_PATTERN = "fix_pattern"
    PREFERENCE = "preference"


class KnowledgeStatus(str, Enum):
    """知识状态枚举。"""
    PENDING = "pending"
    APPROVED = "approved"
    REJECTED = "rejected"


class WriteLevel(str, Enum):
    """写入级别枚举。"""
    PROJECT = "project"
    USER = "user"


class SourceTurn(BaseModel):
    """来源 turn 信息。"""
    session_id: str
    turn_index: int
    description: Optional[str] = None


class KnowledgeItem(BaseModel):
    """知识条目。"""
    id: str
    project_path: str
    type: KnowledgeType
    content: str
    title: Optional[str] = None
    confidence: float = Field(ge=0, le=1, default=0.5)
    status: KnowledgeStatus = KnowledgeStatus.PENDING
    source_sessions: list[str] = Field(default_factory=list)
    source_turns: list[SourceTurn] = Field(default_factory=list)
    write_level: WriteLevel = WriteLevel.PROJECT
    is_modified: bool = False
    created_at: datetime = Field(default_factory=datetime.now)
    approved_at: Optional[datetime] = None
    synced_at: Optional[datetime] = None
    synced_path: Optional[str] = None


class AnalysisJobStatus(str, Enum):
    """分析任务状态枚举。"""
    PENDING = "pending"
    RUNNING = "running"
    COMPLETED = "completed"
    FAILED = "failed"


class AnalysisJob(BaseModel):
    """分析任务。"""
    id: str
    session_id: str
    project_path: str
    status: AnalysisJobStatus = AnalysisJobStatus.PENDING
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cost_usd: float = 0.0
    items_extracted: int = 0
    error_message: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.now)
```

- [ ] **Step 3: 在 models.py 中添加 KnowledgeItemOut 模型**

Add to `backend/models.py`:

```python
from datetime import datetime
from typing import Optional

# 在文件开头添加导入
from services.analyzer.models import KnowledgeType, KnowledgeStatus, WriteLevel, SourceTurn


class KnowledgeItemOut(BaseModel):
    """知识条目 API 响应格式。"""
    id: str
    project_path: str
    type: str
    content: str
    title: Optional[str] = None
    confidence: float
    status: str
    source_sessions: List[str] = []
    source_turns: List[dict] = []
    write_level: str
    is_modified: bool
    created_at: str  # ISO 格式
    approved_at: Optional[str] = None
    synced_at: Optional[str] = None
    synced_path: Optional[str] = None
```

- [ ] **Step 4: 验证模型导入**

Run: `cd backend && python -c "from services.analyzer.models import KnowledgeItem, KnowledgeItem; print('OK')"`
Expected: OK

- [ ] **Step 5: 提交**

```bash
git add backend/services/analyzer/ backend/models.py
git commit -m "feat: add knowledge extraction data models"
```

---

## Task 2: 后端 AnalyzerService

**Files:**
- Create: `backend/services/analyzer/service.py`
- Create: `backend/services/analyzer/claude_code.py`

**Interfaces:**
- Consumes: `KnowledgeItem`, `AnalysisJob`, `SourceTurn`
- Produces: `AnalyzerService`, `ClaudeCodeAnalyzer`

- [ ] **Step 1: 创建 ClaudeCodeAnalyzer**

Create `backend/services/analyzer/claude_code.py`:

```python
"""Claude Code CLI 分析器。"""

from __future__ import annotations

import json
import subprocess
import uuid
from typing import Optional

from .models import KnowledgeItem, KnowledgeType, SourceTurn


ANALYSIS_PROMPT = """你是一个代码分析专家。分析以下 AI Agent 执行过程，提取有价值的知识条目。

## 执行过程数据
{session_data}

## 提取要求
请提取以下类型的知识：
1. **code_style**: 代码规范（命名、格式、组织方式）
2. **architecture**: 架构决策（技术选型、设计模式）
3. **tool_config**: 工具配置（环境、依赖、构建）
4. **fix_pattern**: 修复模式（bug 原因、解决方案）
5. **preference**: 用户偏好（编码习惯、工作流）

## 输出格式
返回 JSON 数组，每个条目包含：
- type: 知识类型 (code_style/architecture/tool_config/fix_pattern/preference)
- content: 条目内容（简洁明了，一句话）
- confidence: 置信度（0-1 的小数）

只提取真正有价值、可复用的知识，不要输出无意义的内容。每个类型最多提取 3 条。
"""


class ClaudeCodeAnalyzer:
    """使用 Claude Code CLI 分析执行过程。"""

    def __init__(self, model: str = "sonnet", max_cost: float = 1.0):
        self.model = model
        self.max_cost = max_cost

    def analyze_session(
        self,
        session_data: dict,
        session_id: str,
        project_path: str
    ) -> list[KnowledgeItem]:
        """
        分析一个 session，提取知识条目。

        Args:
            session_data: 从 parser 提取的结构化数据
            session_id: Session ID
            project_path: 项目路径

        Returns:
            知识条目列表
        """
        # 1. 准备数据
        prompt = self._build_prompt(session_data)

        # 2. 调用 Claude Code CLI
        try:
            result = self._run_claude(prompt)
        except Exception as e:
            print(f"Claude Code CLI 调用失败: {e}")
            return []

        # 3. 解析输出
        items = self._parse_result(result)

        # 4. 转换为 KnowledgeItem
        knowledge_items = []
        for item in items:
            knowledge_item = KnowledgeItem(
                id=str(uuid.uuid4()),
                project_path=project_path,
                type=KnowledgeType(item.get("type", "code_style")),
                content=item.get("content", ""),
                confidence=float(item.get("confidence", 0.5)),
                source_sessions=[session_id],
                source_turns=[]  # TODO: 从 session_data 中提取
            )
            knowledge_items.append(knowledge_item)

        return knowledge_items

    def _build_prompt(self, session_data: dict) -> str:
        """构建分析提示。"""
        return ANALYSIS_PROMPT.format(
            session_data=json.dumps(session_data, ensure_ascii=False, indent=2)
        )

    def _run_claude(self, prompt: str) -> dict:
        """运行 Claude Code CLI。"""
        result = subprocess.run(
            [
                "claude",
                "--print",
                "--output-format", "json",
                "--model", self.model,
                "--max-budget-usd", str(self.max_cost),
                "--system-prompt", "你是一个代码分析专家，专注于从 AI Agent 执行过程中提取可复用的知识。",
                prompt
            ],
            capture_output=True,
            text=True,
            timeout=300
        )

        if result.returncode != 0:
            raise RuntimeError(f"Claude Code CLI failed: {result.stderr}")

        return json.loads(result.stdout)

    def _parse_result(self, result: dict) -> list[dict]:
        """解析 Claude Code 输出。"""
        # 从 structured_output 或 result 中提取
        if "structured_output" in result:
            items = result["structured_output"]
        else:
            # 尝试从文本中解析 JSON
            text = result.get("result", "")
            items = self._extract_json_from_text(text)

        return items

    def _extract_json_from_text(self, text: str) -> list[dict]:
        """从文本中提取 JSON。"""
        start = text.find("[")
        end = text.rfind("]") + 1
        if start != -1 and end > start:
            try:
                return json.loads(text[start:end])
            except json.JSONDecodeError:
                pass
        return []
```

- [ ] **Step 2: 创建 AnalyzerService**

Create `backend/services/analyzer/service.py`:

```python
"""知识提取主服务。"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from .models import (
    AnalysisJob,
    AnalysisJobStatus,
    KnowledgeItem,
    KnowledgeStatus,
    WriteLevel,
)
from .claude_code import ClaudeCodeAnalyzer


class AnalyzerService:
    """知识提取服务。"""

    def __init__(self):
        self.analyzer = ClaudeCodeAnalyzer()
        self._knowledge_items: dict[str, KnowledgeItem] = {}  # id -> item
        self._analysis_jobs: dict[str, AnalysisJob] = {}  # id -> job

    def get_projects(self) -> list[dict]:
        """获取所有项目及其知识条目统计。"""
        projects: dict[str, dict] = {}

        for item in self._knowledge_items.values():
            project_path = item.project_path
            if project_path not in projects:
                projects[project_path] = {
                    "path": project_path,
                    "total_items": 0,
                    "pending_items": 0,
                    "synced_items": 0,
                }
            projects[project_path]["total_items"] += 1
            if item.status == KnowledgeStatus.PENDING:
                projects[project_path]["pending_items"] += 1
            if item.synced_at:
                projects[project_path]["synced_items"] += 1

        return list(projects.values())

    def get_knowledge_items(
        self,
        project_path: Optional[str] = None,
        status: Optional[str] = None,
        knowledge_type: Optional[str] = None,
    ) -> list[KnowledgeItem]:
        """获取知识条目列表。"""
        items = list(self._knowledge_items.values())

        if project_path:
            items = [i for i in items if i.project_path == project_path]
        if status:
            items = [i for i in items if i.status == status]
        if knowledge_type:
            items = [i for i in items if i.type == knowledge_type]

        return sorted(items, key=lambda x: x.created_at, reverse=True)

    def get_knowledge_item(self, item_id: str) -> Optional[KnowledgeItem]:
        """获取单个知识条目。"""
        return self._knowledge_items.get(item_id)

    def update_knowledge_item(
        self,
        item_id: str,
        type: Optional[str] = None,
        content: Optional[str] = None,
        title: Optional[str] = None,
        confidence: Optional[float] = None,
        write_level: Optional[str] = None,
    ) -> Optional[KnowledgeItem]:
        """更新知识条目。"""
        item = self._knowledge_items.get(item_id)
        if not item:
            return None

        if type is not None:
            item.type = type
        if content is not None:
            item.content = content
            item.is_modified = True
        if title is not None:
            item.title = title
            item.is_modified = True
        if confidence is not None:
            item.confidence = confidence
        if write_level is not None:
            item.write_level = write_level

        return item

    def approve_item(self, item_id: str) -> Optional[KnowledgeItem]:
        """批准知识条目。"""
        item = self._knowledge_items.get(item_id)
        if not item:
            return None

        item.status = KnowledgeStatus.APPROVED
        item.approved_at = datetime.now()
        return item

    def reject_item(self, item_id: str) -> Optional[KnowledgeItem]:
        """拒绝知识条目。"""
        item = self._knowledge_items.get(item_id)
        if not item:
            return None

        item.status = KnowledgeStatus.REJECTED
        return item

    def batch_approve(self, item_ids: list[str]) -> int:
        """批量批准知识条目。"""
        count = 0
        for item_id in item_ids:
            if self.approve_item(item_id):
                count += 1
        return count

    def analyze_session(
        self,
        session_id: str,
        project_path: str,
        session_data: dict
    ) -> list[KnowledgeItem]:
        """分析 session，提取知识条目。"""
        # 创建分析任务
        job = AnalysisJob(
            id=str(uuid.uuid4()),
            session_id=session_id,
            project_path=project_path,
            status=AnalysisJobStatus.RUNNING,
            started_at=datetime.now(),
        )
        self._analysis_jobs[job.id] = job

        try:
            # 调用分析器
            new_items = self.analyzer.analyze_session(
                session_data, session_id, project_path
            )

            # 去重合并
            merged_items = self._merge_items(new_items, project_path)

            # 存储
            for item in merged_items:
                self._knowledge_items[item.id] = item

            # 更新任务状态
            job.status = AnalysisJobStatus.COMPLETED
            job.completed_at = datetime.now()
            job.items_extracted = len(new_items)

            return merged_items

        except Exception as e:
            job.status = AnalysisJobStatus.FAILED
            job.error_message = str(e)
            job.completed_at = datetime.now()
            return []

    def _merge_items(
        self,
        new_items: list[KnowledgeItem],
        project_path: str
    ) -> list[KnowledgeItem]:
        """合并新条目与已有条目（去重）。"""
        # 获取项目已有的条目
        existing_items = [
            i for i in self._knowledge_items.values()
            if i.project_path == project_path
        ]

        merged = []
        for new_item in new_items:
            # 查找相似条目（基于 content）
            similar = None
            for existing in existing_items:
                if self._is_similar(new_item.content, existing.content):
                    similar = existing
                    break

            if similar:
                # 合并来源
                if new_item.source_sessions[0] not in similar.source_sessions:
                    similar.source_sessions.extend(new_item.source_sessions)
                # 提升置信度
                similar.confidence = min(similar.confidence + 0.05, 0.99)
            else:
                merged.append(new_item)

        return merged

    def _is_similar(self, content1: str, content2: str) -> bool:
        """判断两个内容是否相似（简单实现：完全相同）。"""
        return content1.strip().lower() == content2.strip().lower()

    def get_stats(self, project_path: Optional[str] = None) -> dict:
        """获取统计信息。"""
        items = list(self._knowledge_items.values())
        if project_path:
            items = [i for i in items if i.project_path == project_path]

        total = len(items)
        pending = sum(1 for i in items if i.status == KnowledgeStatus.PENDING)
        approved = sum(1 for i in items if i.status == KnowledgeStatus.APPROVED)
        rejected = sum(1 for i in items if i.status == KnowledgeStatus.REJECTED)
        project_level = sum(1 for i in items if i.write_level == WriteLevel.PROJECT)
        user_level = sum(1 for i in items if i.write_level == WriteLevel.USER)

        return {
            "total": total,
            "pending": pending,
            "approved": approved,
            "rejected": rejected,
            "project_level": project_level,
            "user_level": user_level,
        }


# 模块级单例
_service: Optional[AnalyzerService] = None


def get_analyzer_service() -> AnalyzerService:
    """获取 AnalyzerService 单例。"""
    global _service
    if _service is None:
        _service = AnalyzerService()
    return _service
```

- [ ] **Step 3: 验证服务导入**

Run: `cd backend && python -c "from services.analyzer.service import get_analyzer_service; print('OK')"`
Expected: OK

- [ ] **Step 4: 提交**

```bash
git add backend/services/analyzer/
git commit -m "feat: add AnalyzerService with Claude Code integration"
```

---

## Task 3: 后端 API 路由

**Files:**
- Create: `backend/api/knowledge.py`
- Modify: `backend/main.py`

**Interfaces:**
- Consumes: `AnalyzerService`, `KnowledgeItem`, `KnowledgeItemOut`
- Produces: `/api/knowledge/*` 路由

- [ ] **Step 1: 创建 knowledge API 路由**

Create `backend/api/knowledge.py`:

```python
"""Knowledge API 路由。"""

from __future__ import annotations

from datetime import datetime
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
```

- [ ] **Step 2: 在 main.py 中注册路由**

Add to `backend/main.py` after other router imports:

```python
from api.knowledge import router as knowledge_router
```

Add after other `app.include_router` lines:

```python
app.include_router(knowledge_router, prefix="/api")
```

- [ ] **Step 3: 验证 API 启动**

Run: `cd backend && timeout 3 python -c "from main import app; print('OK')"`
Expected: OK

- [ ] **Step 4: 提交**

```bash
git add backend/api/knowledge.py backend/main.py
git commit -m "feat: add knowledge API routes"
```

---

## Task 4: 前端数据 Hook

**Files:**
- Create: `frontend/src/hooks/useKnowledge.ts`

**Interfaces:**
- Consumes: `/api/knowledge/*` API
- Produces: `useKnowledge` hook

- [ ] **Step 1: 创建 useKnowledge hook**

Create `frontend/src/hooks/useKnowledge.ts`:

```typescript
/**
 * Knowledge 数据 Hook
 */

import useSWR from 'swr';

const fetcher = (url: string) => fetch(url).then(r => r.json());

export interface KnowledgeItem {
  id: string;
  project_path: string;
  type: string;
  content: string;
  title?: string;
  confidence: number;
  status: string;
  source_sessions: string[];
  source_turns: Array<{
    session_id: string;
    turn_index: number;
    description?: string;
  }>;
  write_level: string;
  is_modified: boolean;
  created_at: string;
  approved_at?: string;
  synced_at?: string;
  synced_path?: string;
}

export interface Project {
  path: string;
  total_items: number;
  pending_items: number;
  synced_items: number;
}

export interface KnowledgeStats {
  total: number;
  pending: number;
  approved: number;
  rejected: number;
  project_level: number;
  user_level: number;
}

export function useKnowledge(
  projectPath?: string,
  status?: string,
  type?: string
) {
  const params = new URLSearchParams();
  if (projectPath) params.set('project_path', projectPath);
  if (status) params.set('status', status);
  if (type) params.set('type', type);

  const queryString = params.toString();
  const url = `/api/knowledge/items${queryString ? `?${queryString}` : ''}`;

  const { data, error, mutate } = useSWR<KnowledgeItem[]>(url, fetcher);

  const approveItem = async (itemId: string) => {
    await fetch(`/api/knowledge/items/${itemId}/approve`, { method: 'POST' });
    mutate();
  };

  const rejectItem = async (itemId: string) => {
    await fetch(`/api/knowledge/items/${itemId}/reject`, { method: 'POST' });
    mutate();
  };

  const updateItem = async (itemId: string, updates: Partial<KnowledgeItem>) => {
    await fetch(`/api/knowledge/items/${itemId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    mutate();
  };

  const batchApprove = async (itemIds: string[]) => {
    await fetch('/api/knowledge/batch-approve', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ item_ids: itemIds }),
    });
    mutate();
  };

  return {
    items: data || [],
    isLoading: !error && !data,
    error,
    approveItem,
    rejectItem,
    updateItem,
    batchApprove,
    refresh: mutate,
  };
}

export function useProjects() {
  const { data, error, mutate } = useSWR<Project[]>(
    '/api/knowledge/projects',
    fetcher
  );

  return {
    projects: data || [],
    isLoading: !error && !data,
    error,
    refresh: mutate,
  };
}

export function useKnowledgeStats(projectPath?: string) {
  const params = new URLSearchParams();
  if (projectPath) params.set('project_path', projectPath);

  const queryString = params.toString();
  const url = `/api/knowledge/stats${queryString ? `?${queryString}` : ''}`;

  const { data, error } = useSWR<KnowledgeStats>(url, fetcher);

  return {
    stats: data,
    isLoading: !error && !data,
    error,
  };
}
```

- [ ] **Step 2: 验证 hook 语法**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -5`
Expected: 无 TypeScript 错误

- [ ] **Step 3: 提交**

```bash
git add frontend/src/hooks/useKnowledge.ts
git commit -m "feat: add useKnowledge hook for knowledge data fetching"
```

---

## Task 5: 前端基础组件

**Files:**
- Create: `frontend/src/components/ui/switch.tsx`
- Create: `frontend/src/components/knowledge/KnowledgeCard.tsx`
- Create: `frontend/src/components/knowledge/ProjectList.tsx`

**Interfaces:**
- Consumes: `useKnowledge` hook
- Produces: `Switch`, `KnowledgeCard`, `ProjectList` 组件

- [ ] **Step 1: 安装 shadcn switch 组件**

Run: `cd frontend && npx shadcn@latest add switch`
Expected: 创建 `src/components/ui/switch.tsx`

- [ ] **Step 2: 创建 KnowledgeCard 组件**

Create `frontend/src/components/knowledge/KnowledgeCard.tsx`:

```tsx
/**
 * 知识条目卡片组件
 */

import { Badge } from '@/components/ui/badge';
import type { KnowledgeItem } from '@/hooks/useKnowledge';

interface KnowledgeCardProps {
  item: KnowledgeItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onEdit: (item: KnowledgeItem) => void;
  onViewSources: (item: KnowledgeItem) => void;
}

const TYPE_LABELS: Record<string, string> = {
  code_style: '代码规范',
  architecture: '架构决策',
  tool_config: '工具配置',
  fix_pattern: '修复模式',
  preference: '用户偏好',
};

const STATUS_STYLES: Record<string, string> = {
  pending: 'bg-amber-100 text-amber-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
};

const STATUS_LABELS: Record<string, string> = {
  pending: '待审批',
  approved: '已批准',
  rejected: '已拒绝',
};

export function KnowledgeCard({
  item,
  onApprove,
  onReject,
  onEdit,
  onViewSources,
}: KnowledgeCardProps) {
  return (
    <div className="p-3 border rounded-lg hover:border-gray-300">
      <div className="flex items-start justify-between">
        <div className="flex-1">
          {/* 标签 */}
          <div className="flex items-center gap-2 mb-1.5">
            <Badge className={STATUS_STYLES[item.status]}>
              {STATUS_LABELS[item.status]}
            </Badge>
            <Badge variant="outline">{TYPE_LABELS[item.type]}</Badge>
            <span className="text-[10px] text-gray-400">
              置信度 {Math.round(item.confidence * 100)}%
            </span>
            {item.is_modified && (
              <Badge className="bg-amber-100 text-amber-700">已修改</Badge>
            )}
          </div>

          {/* 标题和内容 */}
          <h3 className="text-sm font-medium text-gray-800">
            {item.title || item.content.slice(0, 50)}
          </h3>
          {item.title && (
            <p className="text-xs text-gray-600 mt-1">{item.content}</p>
          )}

          {/* 来源 */}
          <div className="flex items-center gap-2 mt-2 text-[10px] text-gray-500">
            <div className="flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 rounded">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              <span>来自 {item.source_sessions.length} 个 session</span>
            </div>
            <button
              className="text-blue-600 hover:underline"
              onClick={() => onViewSources(item)}
            >
              查看详情
            </button>
          </div>

          {/* 同步状态 */}
          {item.synced_at && (
            <div className="flex items-center gap-2 mt-2 text-[10px]">
              <span className="text-gray-500">已同步到:</span>
              <Badge className={
                item.write_level === 'project'
                  ? 'bg-green-100 text-green-700'
                  : 'bg-purple-100 text-purple-700'
              }>
                {item.write_level === 'project' ? '项目级' : '用户级'}
              </Badge>
              <span className="text-gray-400">{item.synced_path}</span>
            </div>
          )}
        </div>

        {/* 操作按钮 */}
        <div className="flex items-center gap-1 ml-3">
          <button
            className="w-7 h-7 flex items-center justify-center rounded border bg-blue-50 text-blue-600 hover:bg-blue-100"
            title="编辑"
            onClick={() => onEdit(item)}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
          {item.status === 'pending' && (
            <>
              <button
                className="w-7 h-7 flex items-center justify-center rounded border bg-green-50 text-green-600 hover:bg-green-100"
                title="批准"
                onClick={() => onApprove(item.id)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                className="w-7 h-7 flex items-center justify-center rounded border bg-red-50 text-red-600 hover:bg-red-100"
                title="拒绝"
                onClick={() => onReject(item.id)}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 ProjectList 组件**

Create `frontend/src/components/knowledge/ProjectList.tsx`:

```tsx
/**
 * 项目列表组件
 */

import { useProjects } from '@/hooks/useKnowledge';

interface ProjectListProps {
  selectedProject: string | null;
  onSelectProject: (path: string | null) => void;
  onScanProjects: () => void;
}

export function ProjectList({
  selectedProject,
  onSelectProject,
  onScanProjects,
}: ProjectListProps) {
  const { projects, isLoading } = useProjects();

  return (
    <div className="w-72 bg-white rounded-lg border flex flex-col">
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Projects</h2>
          <button
            className="text-xs text-blue-600 hover:text-blue-700"
            onClick={onScanProjects}
          >
            扫描新项目
          </button>
        </div>
        <input
          type="text"
          placeholder="搜索项目..."
          className="w-full text-xs border rounded px-2 py-1.5"
        />
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {isLoading ? (
          <div className="text-xs text-gray-500 text-center py-4">加载中...</div>
        ) : projects.length === 0 ? (
          <div className="text-xs text-gray-500 text-center py-4">
            暂无项目，点击"扫描新项目"添加
          </div>
        ) : (
          projects.map((project) => (
            <div
              key={project.path}
              className={`p-2.5 rounded border cursor-pointer ${
                selectedProject === project.path
                  ? 'border-blue-200 bg-blue-50'
                  : 'border hover:bg-gray-50'
              }`}
              onClick={() => onSelectProject(project.path)}
            >
              <div className="flex items-center gap-2">
                <svg
                  className="w-4 h-4 text-gray-500"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z"
                  />
                </svg>
                <span className="text-xs font-medium">
                  {project.path.split('/').pop()}
                </span>
              </div>
              <div className="text-[10px] text-gray-500 mt-1 ml-6 truncate">
                {project.path}
              </div>
              <div className="flex items-center gap-3 mt-2 ml-6">
                <span className="text-[10px] text-gray-600">
                  {project.total_items} 个知识条目
                </span>
                {project.pending_items > 0 && (
                  <span className="text-[10px] text-amber-600">
                    {project.pending_items} 待审批
                  </span>
                )}
                {project.synced_items > 0 && (
                  <span className="text-[10px] text-green-600">
                    {project.synced_items} 已同步
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 验证组件语法**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -5`
Expected: 无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/ui/switch.tsx frontend/src/components/knowledge/
git commit -m "feat: add KnowledgeCard and ProjectList components"
```

---

## Task 6: 前端弹窗组件

**Files:**
- Create: `frontend/src/components/knowledge/EditModal.tsx`
- Create: `frontend/src/components/knowledge/SyncModal.tsx`
- Create: `frontend/src/components/knowledge/SessionDetailModal.tsx`

**Interfaces:**
- Consumes: `KnowledgeItem`, `useKnowledge` hook
- Produces: `EditModal`, `SyncModal`, `SessionDetailModal` 组件

- [ ] **Step 1: 创建 EditModal 组件**

Create `frontend/src/components/knowledge/EditModal.tsx`:

```tsx
/**
 * 编辑知识条目弹窗
 */

import { useState } from 'react';
import type { KnowledgeItem } from '@/hooks/useKnowledge';

interface EditModalProps {
  item: KnowledgeItem | null;
  onClose: () => void;
  onSave: (itemId: string, updates: Partial<KnowledgeItem>) => void;
}

const TYPE_OPTIONS = [
  { value: 'code_style', label: '代码规范' },
  { value: 'architecture', label: '架构决策' },
  { value: 'tool_config', label: '工具配置' },
  { value: 'fix_pattern', label: '修复模式' },
  { value: 'preference', label: '用户偏好' },
];

export function EditModal({ item, onClose, onSave }: EditModalProps) {
  const [type, setType] = useState(item?.type || 'code_style');
  const [content, setContent] = useState(item?.content || '');
  const [title, setTitle] = useState(item?.title || '');
  const [confidence, setConfidence] = useState(item?.confidence || 0.5);
  const [writeLevel, setWriteLevel] = useState(item?.write_level || 'project');

  if (!item) return null;

  const handleSave = () => {
    onSave(item.id, {
      type,
      content,
      title: title || undefined,
      confidence,
      write_level: writeLevel,
    });
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[520px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">编辑知识条目</h3>
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={onClose}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        <div className="p-4 space-y-4">
          {/* 类型选择 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">类型</label>
            <select
              className="w-full text-sm border rounded px-3 py-2"
              value={type}
              onChange={(e) => setType(e.target.value)}
            >
              {TYPE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>{opt.label}</option>
              ))}
            </select>
          </div>

          {/* 标题 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">标题（可选）</label>
            <input
              type="text"
              className="w-full text-sm border rounded px-3 py-2"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="简短描述"
            />
          </div>

          {/* 内容 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">内容</label>
            <textarea
              className="w-full text-sm border rounded px-3 py-2 h-24 resize-none"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
          </div>

          {/* 置信度 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              置信度: {Math.round(confidence * 100)}%
            </label>
            <input
              type="range"
              min="0"
              max="100"
              value={Math.round(confidence * 100)}
              onChange={(e) => setConfidence(parseInt(e.target.value) / 100)}
              className="w-full"
            />
          </div>

          {/* 写入级别 */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">写入级别</label>
            <div className="flex gap-2">
              <button
                className={`px-3 py-1.5 text-xs rounded border ${
                  writeLevel === 'project'
                    ? 'bg-green-100 text-green-700 border-green-200'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
                onClick={() => setWriteLevel('project')}
              >
                📁 项目级
              </button>
              <button
                className={`px-3 py-1.5 text-xs rounded border ${
                  writeLevel === 'user'
                    ? 'bg-purple-100 text-purple-700 border-purple-200'
                    : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                }`}
                onClick={() => setWriteLevel('user')}
              >
                👤 用户级
              </button>
            </div>
          </div>

          {/* 来源信息（只读） */}
          <div className="p-3 bg-gray-50 rounded-lg">
            <div className="text-xs font-medium text-gray-700 mb-2">来源（只读）</div>
            <div className="space-y-1 text-[10px] text-gray-500">
              {item.source_sessions.map((sessionId) => (
                <div key={sessionId} className="flex items-center gap-2">
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                  <span>{sessionId}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 flex items-center justify-end gap-2">
          <button
            className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
            onClick={onClose}
          >
            取消
          </button>
          <button
            className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-800"
            onClick={handleSave}
          >
            保存修改
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 创建 SyncModal 组件**

Create `frontend/src/components/knowledge/SyncModal.tsx`:

```tsx
/**
 * 同步到 CLAUDE.md 弹窗
 */

import { useState } from 'react';
import type { KnowledgeItem } from '@/hooks/useKnowledge';

interface SyncModalProps {
  items: KnowledgeItem[];
  onClose: () => void;
  onSync: (items: Array<{ id: string; write_level: string }>) => void;
}

export function SyncModal({ items, onClose, onSync }: SyncModalProps) {
  const [selectedItems, setSelectedItems] = useState<
    Array<{ id: string; write_level: string }>
  >(
    items.map((item) => ({
      id: item.id,
      write_level: item.write_level,
    }))
  );

  const handleToggleItem = (itemId: string) => {
    setSelectedItems((prev) =>
      prev.some((i) => i.id === itemId)
        ? prev.filter((i) => i.id !== itemId)
        : [...prev, { id: itemId, write_level: 'project' }]
    );
  };

  const handleWriteLevelChange = (itemId: string, level: string) => {
    setSelectedItems((prev) =>
      prev.map((i) => (i.id === itemId ? { ...i, write_level: level } : i))
    );
  };

  const handleSync = () => {
    onSync(selectedItems);
    onClose();
  };

  const projectCount = selectedItems.filter(
    (i) => i.write_level === 'project'
  ).length;
  const userCount = selectedItems.filter((i) => i.write_level === 'user').length;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[480px] max-h-[80vh] overflow-hidden">
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-gray-800">同步到 CLAUDE.md</h3>
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={onClose}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-1">为每个条目选择写入级别</p>
        </div>

        <div className="p-4 overflow-auto max-h-96 space-y-3">
          {items.map((item) => {
            const isSelected = selectedItems.some((i) => i.id === item.id);
            const writeLevel =
              selectedItems.find((i) => i.id === item.id)?.write_level ||
              item.write_level;

            return (
              <div key={item.id} className="border rounded-lg p-3">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1 rounded"
                    checked={isSelected}
                    onChange={() => handleToggleItem(item.id)}
                  />
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-medium text-gray-800">
                        {item.title || item.content.slice(0, 40)}
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-500 mt-1">{item.content}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-[10px] text-gray-500">写入到:</span>
                      <button
                        className={`px-2 py-0.5 text-[10px] rounded border ${
                          writeLevel === 'project'
                            ? 'bg-green-100 text-green-700 border-green-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        onClick={() => handleWriteLevelChange(item.id, 'project')}
                      >
                        📁 项目级
                      </button>
                      <button
                        className={`px-2 py-0.5 text-[10px] rounded border ${
                          writeLevel === 'user'
                            ? 'bg-purple-100 text-purple-700 border-purple-200'
                            : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
                        }`}
                        onClick={() => handleWriteLevelChange(item.id, 'user')}
                      >
                        👤 用户级
                      </button>
                      <span className="text-[10px] text-gray-400">
                        {writeLevel === 'project'
                          ? '.claude/CLAUDE.md'
                          : '~/.claude/CLAUDE.md'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="p-4 border-t bg-gray-50">
          <div className="flex items-center justify-between">
            <div className="text-xs text-gray-500">
              <span>已选 {selectedItems.length} 个条目</span>
              <span className="ml-2 text-green-600">{projectCount} 项目级</span>
              <span className="ml-2 text-purple-600">{userCount} 用户级</span>
            </div>
            <div className="flex gap-2">
              <button
                className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
                onClick={onClose}
              >
                取消
              </button>
              <button
                className="px-3 py-1.5 text-xs bg-gray-900 text-white rounded hover:bg-gray-800"
                onClick={handleSync}
              >
                确认同步
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 创建 SessionDetailModal 组件**

Create `frontend/src/components/knowledge/SessionDetailModal.tsx`:

```tsx
/**
 * Session 详情浮层
 */

import type { KnowledgeItem } from '@/hooks/useKnowledge';

interface SessionDetailModalProps {
  item: KnowledgeItem | null;
  onClose: () => void;
}

export function SessionDetailModal({ item, onClose }: SessionDetailModalProps) {
  if (!item) return null;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-[640px] max-h-[85vh] overflow-hidden flex flex-col">
        {/* 头部 */}
        <div className="p-4 border-b">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-sm font-semibold text-gray-800">
                知识来源详情
              </h3>
              <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-500">
                <span>{item.source_sessions.length} 个来源 session</span>
              </div>
            </div>
            <button
              className="text-gray-400 hover:text-gray-600"
              onClick={onClose}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
          <div className="mt-2 text-xs text-gray-600">
            提取的知识：<span className="font-medium">{item.content}</span>
          </div>
        </div>

        {/* 来源列表 */}
        <div className="flex-1 overflow-auto p-4">
          <div className="text-[10px] text-gray-400 font-medium mb-3">来源 Session</div>

          <div className="space-y-3">
            {item.source_sessions.map((sessionId, index) => (
              <div
                key={sessionId}
                className="flex gap-3 p-3 bg-gray-50 rounded-lg"
              >
                <div className="flex flex-col items-center">
                  <div className="w-6 h-6 rounded-full bg-gray-200 flex items-center justify-center">
                    <span className="text-[10px] font-medium text-gray-600">
                      {index + 1}
                    </span>
                  </div>
                </div>
                <div className="flex-1">
                  <div className="text-xs font-medium text-gray-800">
                    Session: {sessionId.slice(0, 8)}...
                  </div>
                  <div className="text-[10px] text-gray-500 mt-1">
                    点击在 Sessions 页面查看完整对话
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* 置信度说明 */}
          <div className="mt-4 p-3 bg-amber-50 rounded-lg border border-amber-100">
            <div className="flex items-start gap-2">
              <svg className="w-4 h-4 text-amber-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <div className="text-[10px] text-amber-800">
                <div className="font-medium mb-1">置信度计算</div>
                <div>
                  基于 {item.source_sessions.length} 个来源 session，
                  置信度 {Math.round(item.confidence * 100)}%
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* 底部 */}
        <div className="p-4 border-t bg-gray-50 flex items-center justify-end">
          <button
            className="px-3 py-1.5 text-xs border rounded hover:bg-gray-50"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 验证组件语法**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -5`
Expected: 无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/knowledge/
git commit -m "feat: add EditModal, SyncModal, SessionDetailModal components"
```

---

## Task 7: 前端 Knowledge 页面

**Files:**
- Create: `frontend/src/components/knowledge/KnowledgeList.tsx`
- Create: `frontend/src/pages/Knowledge.tsx`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `useKnowledge`, `KnowledgeCard`, `ProjectList`, modals
- Produces: `Knowledge` 页面

- [ ] **Step 1: 创建 KnowledgeList 组件**

Create `frontend/src/components/knowledge/KnowledgeList.tsx`:

```tsx
/**
 * 知识列表组件
 */

import { useState } from 'react';
import { useKnowledge, type KnowledgeItem } from '@/hooks/useKnowledge';
import { KnowledgeCard } from './KnowledgeCard';
import { EditModal } from './EditModal';
import { SyncModal } from './SyncModal';
import { SessionDetailModal } from './SessionDetailModal';

interface KnowledgeListProps {
  projectPath: string | null;
}

const TYPE_FILTERS = [
  { value: '', label: '所有类型' },
  { value: 'code_style', label: '代码规范' },
  { value: 'architecture', label: '架构决策' },
  { value: 'tool_config', label: '工具配置' },
  { value: 'fix_pattern', label: '修复模式' },
  { value: 'preference', label: '用户偏好' },
];

export function KnowledgeList({ projectPath }: KnowledgeListProps) {
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [editingItem, setEditingItem] = useState<KnowledgeItem | null>(null);
  const [viewingItem, setViewingItem] = useState<KnowledgeItem | null>(null);
  const [showSyncModal, setShowSyncModal] = useState(false);

  const {
    items,
    isLoading,
    approveItem,
    rejectItem,
    updateItem,
    batchApprove,
  } = useKnowledge(projectPath || undefined, statusFilter, typeFilter);

  // 获取所有已批准的条目（用于同步）
  const { items: allItems } = useKnowledge(projectPath || undefined, 'approved');

  const handleBatchApprove = async () => {
    const pendingIds = items
      .filter((i) => i.status === 'pending')
      .map((i) => i.id);
    if (pendingIds.length > 0) {
      await batchApprove(pendingIds);
    }
  };

  const handleSync = async (
    syncItems: Array<{ id: string; write_level: string }>
  ) => {
    // TODO: 调用同步 API
    console.log('Syncing items:', syncItems);
  };

  const projectName = projectPath?.split('/').pop() || '未知项目';

  return (
    <div className="flex-1 bg-white rounded-lg border flex flex-col">
      {/* 头部 */}
      <div className="p-3 border-b">
        <div className="flex items-center justify-between mb-3">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">{projectName}</h2>
            <p className="text-xs text-gray-500 mt-0.5">
              {projectPath} · {items.length} 个知识条目
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              className="text-xs px-3 py-1.5 border rounded hover:bg-gray-50"
              onClick={handleBatchApprove}
            >
              批量批准
            </button>
            <button
              className="text-xs px-3 py-1.5 bg-gray-900 text-white rounded hover:bg-gray-800"
              onClick={() => setShowSyncModal(true)}
            >
              同步到 CLAUDE.md
            </button>
          </div>
        </div>

        {/* 筛选 */}
        <div className="flex items-center gap-2">
          <div className="flex gap-1">
            <button
              className={`px-2 py-1 text-xs rounded ${
                statusFilter === ''
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => setStatusFilter('')}
            >
              全部 ({items.length})
            </button>
            <button
              className={`px-2 py-1 text-xs rounded ${
                statusFilter === 'pending'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => setStatusFilter('pending')}
            >
              待审批 ({items.filter((i) => i.status === 'pending').length})
            </button>
            <button
              className={`px-2 py-1 text-xs rounded ${
                statusFilter === 'approved'
                  ? 'bg-gray-900 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
              onClick={() => setStatusFilter('approved')}
            >
              已批准 ({items.filter((i) => i.status === 'approved').length})
            </button>
          </div>
          <div className="h-4 w-px bg-gray-200" />
          <select
            className="text-xs border rounded px-2 py-1"
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
          >
            {TYPE_FILTERS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 知识条目列表 */}
      <div className="flex-1 overflow-auto p-3 space-y-3">
        {isLoading ? (
          <div className="text-center py-8 text-gray-500">加载中...</div>
        ) : items.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            {projectPath ? '暂无知识条目' : '请先选择一个项目'}
          </div>
        ) : (
          items.map((item) => (
            <KnowledgeCard
              key={item.id}
              item={item}
              onApprove={approveItem}
              onReject={rejectItem}
              onEdit={setEditingItem}
              onViewSources={setViewingItem}
            />
          ))
        )}
      </div>

      {/* 底部统计 */}
      <div className="p-3 border-t bg-gray-50">
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center gap-4">
            <span>{items.length} 个条目</span>
            <span className="text-green-600">
              {items.filter((i) => i.status === 'approved').length} 已批准
            </span>
            <span className="text-amber-600">
              {items.filter((i) => i.status === 'pending').length} 待审批
            </span>
          </div>
          <button
            className="px-3 py-1 bg-gray-900 text-white rounded hover:bg-gray-800"
            onClick={() => setShowSyncModal(true)}
          >
            同步到 CLAUDE.md
          </button>
        </div>
      </div>

      {/* 弹窗 */}
      <EditModal
        item={editingItem}
        onClose={() => setEditingItem(null)}
        onSave={updateItem}
      />
      <SyncModal
        items={allItems}
        onClose={() => setShowSyncModal(false)}
        onSync={handleSync}
      />
      <SessionDetailModal
        item={viewingItem}
        onClose={() => setViewingItem(null)}
      />
    </div>
  );
}
```

- [ ] **Step 2: 创建 Knowledge 页面**

Create `frontend/src/pages/Knowledge.tsx`:

```tsx
/**
 * Knowledge 页面
 */

import { useState } from 'react';
import { ProjectList } from '@/components/knowledge/ProjectList';
import { KnowledgeList } from '@/components/knowledge/KnowledgeList';

export function Knowledge() {
  const [selectedProject, setSelectedProject] = useState<string | null>(null);
  const [showScanModal, setShowScanModal] = useState(false);

  const handleScanProjects = () => {
    // TODO: 实现扫描项目功能
    setShowScanModal(true);
  };

  return (
    <div className="flex gap-4 h-full">
      <ProjectList
        selectedProject={selectedProject}
        onSelectProject={setSelectedProject}
        onScanProjects={handleScanProjects}
      />
      <KnowledgeList projectPath={selectedProject} />
    </div>
  );
}
```

- [ ] **Step 3: 在 App.tsx 中添加路由和导航**

Modify `frontend/src/App.tsx`:

在文件顶部添加路由状态：

```typescript
const [currentPage, setCurrentPage] = useState<'sessions' | 'knowledge'>('sessions');
```

在顶部导航中添加 Knowledge tab（在 Sessions tab 后面）：

```tsx
<nav className="flex gap-1 ml-4">
  <button
    className={`px-3 py-1.5 text-sm rounded ${
      currentPage === 'sessions'
        ? 'bg-gray-900 text-white'
        : 'text-gray-600 hover:bg-gray-100'
    }`}
    onClick={() => setCurrentPage('sessions')}
  >
    Sessions
  </button>
  <button
    className={`px-3 py-1.5 text-sm rounded ${
      currentPage === 'knowledge'
        ? 'bg-gray-900 text-white'
        : 'text-gray-600 hover:bg-gray-100'
    }`}
    onClick={() => setCurrentPage('knowledge')}
  >
    Knowledge
  </button>
</nav>
```

在主内容区域添加条件渲染：

```tsx
{currentPage === 'sessions' ? (
  // 原有的 sessions 内容
) : (
  <Knowledge />
)}
```

- [ ] **Step 4: 验证页面语法**

Run: `cd frontend && npx tsc --noEmit 2>&1 | head -5`
Expected: 无 TypeScript 错误

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/knowledge/KnowledgeList.tsx frontend/src/pages/Knowledge.tsx frontend/src/App.tsx
git commit -m "feat: add Knowledge page with project list and knowledge list"
```

---

## Task 8: 功能验证

- [ ] **Step 1: 启动后端服务**

Run: `cd backend && python main.py &`
Expected: 服务启动在 http://localhost:8000

- [ ] **Step 2: 启动前端服务**

Run: `cd frontend && npm run dev &`
Expected: 前端启动在 http://localhost:5173

- [ ] **Step 3: 访问 Knowledge 页面**

在浏览器中打开 http://localhost:5173，点击 Knowledge tab

Expected: 看到左侧 Projects 列表（暂无项目），右侧空状态提示

- [ ] **Step 4: 测试 API 接口**

Run: `curl http://localhost:8000/api/knowledge/projects`
Expected: `[]`

- [ ] **Step 5: 清理并提交最终版本**

```bash
git add -A
git status
git commit -m "feat: complete knowledge extraction feature"
```

---

## Summary

| Task | 描述 | 产出 |
|------|------|------|
| 1 | 后端数据模型 | `analyzer/models.py`, `models.py` |
| 2 | AnalyzerService | `analyzer/service.py`, `analyzer/claude_code.py` |
| 3 | 后端 API 路由 | `api/knowledge.py`, `main.py` |
| 4 | 前端数据 Hook | `hooks/useKnowledge.ts` |
| 5 | 前端基础组件 | `switch.tsx`, `KnowledgeCard`, `ProjectList` |
| 6 | 前端弹窗组件 | `EditModal`, `SyncModal`, `SessionDetailModal` |
| 7 | 前端 Knowledge 页面 | `KnowledgeList`, `Knowledge`, `App.tsx` |
| 8 | 功能验证 | 验证所有功能正常工作 |

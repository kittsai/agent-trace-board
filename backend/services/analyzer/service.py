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
    KnowledgeType,
    SourceTurn,
    WriteLevel,
)
from .claude_code import ClaudeCodeAnalyzer


class AnalyzerService:
    """知识提取服务。"""

    def __init__(self):
        self.analyzer = ClaudeCodeAnalyzer()
        self._knowledge_items: dict[str, KnowledgeItem] = {}
        self._analysis_jobs: dict[str, AnalysisJob] = {}
        self._init_mock_data()

    def _init_mock_data(self):
        """初始化模拟数据。"""
        mock_items = [
            KnowledgeItem(
                id="mock-1",
                project_path="/Users/cosmic/Work/project/ai/agent-insight-board",
                type=KnowledgeType.CODE_STYLE,
                title="使用 React.memo 优化渲染性能",
                content="对于频繁渲染的列表组件，使用 React.memo 包裹可以避免不必要的重渲染。配合 useMemo 和 useCallback 使用效果更佳。",
                confidence=0.9,
                status=KnowledgeStatus.APPROVED,
                source_sessions=["session-abc123"],
                source_turns=[SourceTurn(session_id="session-abc123", turn_index=5, description="优化列表渲染")],
                write_level=WriteLevel.PROJECT,
                created_at=datetime(2026, 7, 28, 10, 30, 0),
                approved_at=datetime(2026, 7, 28, 11, 0, 0),
            ),
            KnowledgeItem(
                id="mock-2",
                project_path="/Users/cosmic/Work/project/ai/agent-insight-board",
                type=KnowledgeType.ARCHITECTURE,
                title="使用 SWR 进行数据获取",
                content="项目采用 SWR 作为数据获取库，提供自动缓存、重新验证和错误重试功能。所有 API 调用都通过自定义 hooks 封装。",
                confidence=0.85,
                status=KnowledgeStatus.PENDING,
                source_sessions=["session-def456"],
                source_turns=[SourceTurn(session_id="session-def456", turn_index=2, description="数据获取方案")],
                write_level=WriteLevel.PROJECT,
                created_at=datetime(2026, 7, 28, 14, 20, 0),
            ),
            KnowledgeItem(
                id="mock-3",
                project_path="/Users/cosmic/Work/project/ai/agent-insight-board",
                type=KnowledgeType.TOOL_CONFIG,
                title="ESLint 配置：禁止 any 类型",
                content="项目配置了 @typescript-eslint/no-explicit-any 规则为 error 级别，禁止使用 any 类型。应使用 unknown 或具体类型替代。",
                confidence=0.95,
                status=KnowledgeStatus.APPROVED,
                source_sessions=["session-ghi789"],
                source_turns=[SourceTurn(session_id="session-ghi789", turn_index=8, description="TypeScript 配置")],
                write_level=WriteLevel.USER,
                created_at=datetime(2026, 7, 27, 16, 45, 0),
                approved_at=datetime(2026, 7, 27, 17, 0, 0),
                synced_at=datetime(2026, 7, 27, 17, 30, 0),
                synced_path="~/.claude/CLAUDE.md",
            ),
            KnowledgeItem(
                id="mock-4",
                project_path="/Users/cosmic/Work/project/ai/agent-insight-board",
                type=KnowledgeType.FIX_PATTERN,
                title="修复 WebSocket 连接断开问题",
                content="当 WebSocket 连接断开时，使用指数退避策略进行重连。初始延迟 1 秒，最大延迟 30 秒，最多重试 5 次。",
                confidence=0.8,
                status=KnowledgeStatus.PENDING,
                source_sessions=["session-jkl012"],
                source_turns=[SourceTurn(session_id="session-jkl012", turn_index=12, description="WebSocket 重连")],
                write_level=WriteLevel.PROJECT,
                created_at=datetime(2026, 7, 28, 9, 15, 0),
            ),
            KnowledgeItem(
                id="mock-5",
                project_path="/Users/cosmic/Work/project/ai/agent-insight-board",
                type=KnowledgeType.PREFERENCE,
                title="使用 TailwindCSS 进行样式开发",
                content="项目使用 TailwindCSS 作为 CSS 框架。所有样式都通过 utility classes 实现，避免编写自定义 CSS。",
                confidence=0.92,
                status=KnowledgeStatus.APPROVED,
                source_sessions=["session-mno345"],
                source_turns=[SourceTurn(session_id="session-mno345", turn_index=3, description="样式方案")],
                write_level=WriteLevel.PROJECT,
                created_at=datetime(2026, 7, 26, 11, 30, 0),
                approved_at=datetime(2026, 7, 26, 12, 0, 0),
            ),
        ]

        for item in mock_items:
            self._knowledge_items[item.id] = item

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

    def add_project(self, project_path: str) -> dict:
        """添加项目。"""
        # 返回项目信息（如果已存在则返回现有信息）
        projects = self.get_projects()
        for p in projects:
            if p["path"] == project_path:
                return p

        # 新项目，返回基本信息
        return {
            "path": project_path,
            "total_items": 0,
            "pending_items": 0,
            "synced_items": 0,
        }

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
        job = AnalysisJob(
            id=str(uuid.uuid4()),
            session_id=session_id,
            project_path=project_path,
            status=AnalysisJobStatus.RUNNING,
            started_at=datetime.now(),
        )
        self._analysis_jobs[job.id] = job

        try:
            new_items = self.analyzer.analyze_session(
                session_data, session_id, project_path
            )
            merged_items = self._merge_items(new_items, project_path)

            for item in merged_items:
                self._knowledge_items[item.id] = item

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
        existing_items = [
            i for i in self._knowledge_items.values()
            if i.project_path == project_path
        ]

        merged = []
        for new_item in new_items:
            similar = None
            for existing in existing_items:
                if self._is_similar(new_item.content, existing.content):
                    similar = existing
                    break

            if similar:
                if new_item.source_sessions[0] not in similar.source_sessions:
                    similar.source_sessions.extend(new_item.source_sessions)
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


_service: Optional[AnalyzerService] = None


def get_analyzer_service() -> AnalyzerService:
    """获取 AnalyzerService 单例。"""
    global _service
    if _service is None:
        _service = AnalyzerService()
    return _service

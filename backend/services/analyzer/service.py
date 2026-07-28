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
        self._knowledge_items: dict[str, KnowledgeItem] = {}
        self._analysis_jobs: dict[str, AnalysisJob] = {}

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

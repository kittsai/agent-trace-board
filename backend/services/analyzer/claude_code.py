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
                source_turns=[]
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
        if "structured_output" in result:
            items = result["structured_output"]
        else:
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

"""Parser 基类。"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class ParseContext:
    """实时解析的累积状态。"""

    session_id: str = ""
    current_turn_index: int = 0
    current_prompt_id: str | None = None
    step_index: int = 0
    ai_title: str | None = None
    turns: list = field(default_factory=list)
    steps: list = field(default_factory=list)
    # 当前 turn 的 token 累计
    turn_input_tokens: int = 0
    turn_output_tokens: int = 0


class BaseParser(ABC):
    """Agent 日志解析器基类。"""

    @abstractmethod
    def parse_file(self, file_path: str) -> dict:
        """离线解析完整 JSONL 文件。

        返回:
            {
                "session": {...},
                "turns": [...],
                "steps": [...],
            }
        """

    @abstractmethod
    def parse_line(self, line: str, context: ParseContext) -> list[dict]:
        """解析单行 JSONL（实时模式）。

        返回本次解析产生的 step 列表。
        """

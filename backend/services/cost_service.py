"""Token / 成本分析服务 — 只读派生视图。

数据来源: parsed step 的 token 字段(input/output/cache_read/cache_creation)。
定价按 step.model 探测档位(opus/sonnet/haiku),默认 sonnet。所有成本均为 估算。
"""

from __future__ import annotations

from collections import Counter
from typing import Optional

from parsers.claude_code import ClaudeCodeParser

# 每百万 token 单价(USD)。2026 年 Claude 公开档位定价,仅作估算。
_PRICING = {
    "sonnet": {"input": 3.0, "output": 15.0, "cache_read": 0.30, "cache_creation": 3.75},
    "opus": {"input": 15.0, "output": 75.0, "cache_read": 1.50, "cache_creation": 18.75},
    "haiku": {"input": 0.80, "output": 4.0, "cache_read": 0.08, "cache_creation": 1.0},
}

_M = 1_000_000


def _tier_for_model(model: Optional[str]) -> str:
    """从 model 字符串探测档位,未知或缺失归 sonnet。"""
    if not model:
        return "sonnet"
    m = model.lower()
    if "opus" in m:
        return "opus"
    if "haiku" in m:
        return "haiku"
    return "sonnet"


def _step_cost(step: dict, tier: str) -> float:
    p = _PRICING[tier]
    return (
        step.get("input_tokens", 0) * p["input"]
        + step.get("output_tokens", 0) * p["output"]
        + step.get("cache_read_tokens", 0) * p["cache_read"]
        + step.get("cache_creation_tokens", 0) * p["cache_creation"]
    ) / _M


class CostService:
    def __init__(self, parser: Optional[ClaudeCodeParser] = None):
        self.parser = parser or ClaudeCodeParser()

    def analyze(self, session_id: str) -> Optional[dict]:
        """返回 session 的 token/成本分析。"""
        steps = self._get_steps(session_id)
        if steps is None:
            return None

        # 档位探测:统计 assistant step 的 model,取众数作为主档位
        tier_counts: Counter[str] = Counter()
        for s in steps:
            if s.get("type") == "assistant":
                tier_counts[_tier_for_model(s.get("model"))] += 1
        dominant_tier = tier_counts.most_common(1)[0][0] if tier_counts else "sonnet"

        # 汇总 + 每步成本(按各自档位)
        t_in = t_out = t_cr = t_cc = 0
        total_cost = 0.0
        for s in steps:
            t_in += s.get("input_tokens", 0)
            t_out += s.get("output_tokens", 0)
            t_cr += s.get("cache_read_tokens", 0)
            t_cc += s.get("cache_creation_tokens", 0)
            total_cost += _step_cost(s, _tier_for_model(s.get("model")))

        total_tokens = t_in + t_out + t_cr + t_cc

        # 每轮聚合
        per_turn = self._per_turn(session_id)

        # 每工具聚合
        per_tool = self._per_tool(steps)

        # 缓存效率
        cache_efficiency = {
            "fresh_input_ratio": round(t_in / total_tokens, 4) if total_tokens else 0.0,
            "cache_read_ratio": round(t_cr / total_tokens, 4) if total_tokens else 0.0,
            "cache_creation_ratio": round(t_cc / total_tokens, 4) if total_tokens else 0.0,
            "output_ratio": round(t_out / total_tokens, 4) if total_tokens else 0.0,
        }

        return {
            "session_id": session_id,
            "totals": {
                "input_tokens": t_in,
                "output_tokens": t_out,
                "cache_read_tokens": t_cr,
                "cache_creation_tokens": t_cc,
                "total_tokens": total_tokens,
                "estimated_cost_usd": round(total_cost, 4),
            },
            "pricing": {
                "tier": dominant_tier,
                "tiers_used": sorted(tier_counts.keys()),
                "input_per_mtok": _PRICING[dominant_tier]["input"],
                "output_per_mtok": _PRICING[dominant_tier]["output"],
                "cache_read_per_mtok": _PRICING[dominant_tier]["cache_read"],
                "cache_creation_per_mtok": _PRICING[dominant_tier]["cache_creation"],
                "note": "估算:按主模型档位定价,实际账单可能不同",
            },
            "per_turn": per_turn,
            "per_tool": per_tool,
            "cache_efficiency": cache_efficiency,
        }

    def _per_turn(self, session_id: str) -> list[dict]:
        """每轮 token/成本聚合(从 turn 嵌入的 steps 汇总)。"""
        from services.session_service import get_session_service

        turns = get_session_service().get_turns(session_id)
        rows = []
        for turn in turns:
            t_in = t_out = t_cr = t_cc = 0
            cost = 0.0
            for s in turn.get("steps", []):
                t_in += s.get("input_tokens", 0)
                t_out += s.get("output_tokens", 0)
                t_cr += s.get("cache_read_tokens", 0)
                t_cc += s.get("cache_creation_tokens", 0)
                cost += _step_cost(s, _tier_for_model(s.get("model")))
            rows.append({
                "turn_index": turn.get("turn_index", 0),
                "input_tokens": t_in,
                "output_tokens": t_out,
                "cache_read_tokens": t_cr,
                "cache_creation_tokens": t_cc,
                "estimated_cost_usd": round(cost, 4),
            })
        return rows

    def _per_tool(self, steps: list[dict]) -> list[dict]:
        """每个工具的 token/成本聚合(仅 assistant 步带 tool_name)。"""
        agg: dict[str, dict] = {}
        for s in steps:
            name = s.get("tool_name")
            if not name:
                continue
            tier = _tier_for_model(s.get("model"))
            row = agg.setdefault(name, {
                "tool_name": name,
                "count": 0,
                "input_tokens": 0,
                "output_tokens": 0,
                "cache_read_tokens": 0,
                "cache_creation_tokens": 0,
                "estimated_cost_usd": 0.0,
            })
            row["count"] += 1
            row["input_tokens"] += s.get("input_tokens", 0)
            row["output_tokens"] += s.get("output_tokens", 0)
            row["cache_read_tokens"] += s.get("cache_read_tokens", 0)
            row["cache_creation_tokens"] += s.get("cache_creation_tokens", 0)
            row["estimated_cost_usd"] += _step_cost(s, tier)
        for row in agg.values():
            row["estimated_cost_usd"] = round(row["estimated_cost_usd"], 4)
        return sorted(agg.values(), key=lambda r: r["estimated_cost_usd"], reverse=True)

    def _get_steps(self, session_id: str) -> Optional[list[dict]]:
        from services.session_service import get_session_service

        return get_session_service().get_steps(session_id)


# 模块级单例,与 SessionService 一致,共享底层缓存
_service: "CostService | None" = None


def get_cost_service() -> "CostService":
    global _service
    if _service is None:
        _service = CostService()
    return _service

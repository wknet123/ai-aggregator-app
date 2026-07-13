"""Agent 定义加载 + 多 SKILL 合并 + dry-run（P1-a）。

把「写死的 DEFAULT_AGENT 常量」升级为「从库加载 Agent + 合并其有序 Skill」的运行配置：
- `load_runtime(db, agent_key, tenant_id)` → 运行配置 dict（persona/allowed_plugins/policy/...）。
- `merge_skills(agent, skills)` → 合并各 Skill 的方法论 instructions、推荐 Plugin（∩白名单）、约束。
- `plan_only(runtime, goal, inputs)` → dry-run：只让 LLM 规划一次，返回拟调用工具，不执行/不扣费。

executor 用 load_runtime 的结果 + 快照进 agent_runs.agent_snapshot；续跑读快照保证一致。
"""
from __future__ import annotations

import logging
from typing import Optional

from sqlalchemy import select

logger = logging.getLogger(__name__)

# 内置系统智能体兜底：库中无 agent_id="default" 行时使用（首启动播种前 / 播种失败）。
DEFAULT_AGENT = {
    "key": "default",
    "persona": (
        "你是多模态创作智能体。根据用户目标，自主调用可用工具产出成品。\n"
        "需要图片时调用 image_generate 工具，并把画面描述写得具体、完整。\n"
        "需要视频时：可直接用 video_text_to_video 文生视频；若要基于一张图动起来，先用 "
        "image_generate 生成首帧、再用 video_image_to_video 并把该图产物的 key 传入 image_key。\n"
        "拿到工具产物后，若已满足目标就用一句话总结产出，不要重复调用工具。"
    ),
    "allowed_plugins": ["image.generate", "video.text_to_video", "video.image_to_video"],
    # budget_limit=500 容纳真实计费（图 40 / 视频 150）；confirm_cost_threshold 保持 1
    "policy": {"max_steps": 6, "budget_limit": 500, "confirm_cost_threshold": 1, "confirm_mode": "auto"},
}


def _agent_to_dict(a) -> dict:
    return {
        "agent_id": a.agent_id, "name": a.name, "persona": a.persona or "",
        "skill_ids": a.skill_ids or [], "allowed_plugins": a.allowed_plugins or [],
        "policy": a.policy or {}, "scope": a.scope,
    }


def _skill_to_dict(s) -> dict:
    return {
        "skill_id": s.skill_id, "name": s.name, "instructions": s.instructions or "",
        "when_to_use": s.when_to_use or "", "recommended_plugins": s.recommended_plugins or [],
        "constraints": s.constraints or {}, "inputs": s.inputs or [], "version": s.version,
    }


def _merge_constraints(skills: list[dict]) -> dict:
    """各 Skill 约束「更严格者优先」合并：aspect_ratio 取最后指定值，max_duration 取最小，禁词并集。"""
    merged: dict = {}
    forbidden: list[str] = []
    for s in skills:
        c = s.get("constraints") or {}
        if c.get("aspect_ratio"):
            merged["aspect_ratio"] = c["aspect_ratio"]
        if c.get("max_duration_sec") is not None:
            prev = merged.get("max_duration_sec")
            merged["max_duration_sec"] = c["max_duration_sec"] if prev is None else min(prev, c["max_duration_sec"])
        for w in (c.get("forbidden_words") or []):
            if w not in forbidden:
                forbidden.append(w)
    if forbidden:
        merged["forbidden_words"] = forbidden
    return merged


def merge_skills(agent: dict, skills: list[dict]) -> dict:
    """合并 Agent + 有序 Skills → 运行配置。"""
    allowed = list(agent.get("allowed_plugins") or [])
    allowed_set = set(allowed)

    # persona = agent 人设 + 各 Skill 方法论小标题
    parts = [agent.get("persona") or ""]
    for s in skills:
        instr = (s.get("instructions") or "").strip()
        if not instr:
            continue
        head = f"## 技能：{s.get('name') or s.get('skill_id')}"
        when = (s.get("when_to_use") or "").strip()
        if when:
            head += f"（适用：{when}）"
        parts.append(f"{head}\n{instr}")

    # 推荐 Plugin = ∪(skill.recommended) ∩ allowed（仅提示，白名单仍是硬边界）
    recommended: list[str] = []
    for s in skills:
        for p in (s.get("recommended_plugins") or []):
            if p in allowed_set and p not in recommended:
                recommended.append(p)
    if recommended:
        parts.append(f"优先推荐使用的工具：{', '.join(recommended)}（也可在允许范围内自行选择）。")

    constraints = _merge_constraints(skills)
    policy = dict(agent.get("policy") or {})
    default_ar = constraints.get("aspect_ratio") or policy.get("default_aspect_ratio")
    soft: list[str] = []
    if default_ar:
        soft.append(f"默认画面比例 {default_ar}（除非用户另有要求）")
    if constraints.get("forbidden_words"):
        soft.append(f"禁止出现词语：{', '.join(constraints['forbidden_words'])}")
    if constraints.get("max_duration_sec") is not None:
        soft.append(f"视频时长不超过 {constraints['max_duration_sec']} 秒")
    if soft:
        parts.append("约束：" + "；".join(soft) + "。")

    return {
        "agent_key": agent.get("agent_id") or agent.get("key") or "default",
        "persona": "\n\n".join(p for p in parts if p.strip()),
        "allowed_plugins": allowed,
        "recommended_plugins": recommended,
        "policy": policy,
        "constraints": constraints,
    }


async def load_runtime(db, agent_key: Optional[str], tenant_id: int) -> dict:
    """按 agent_key 加载 Agent + 其有序 Skills，合并成运行配置。查不到 → DEFAULT_AGENT 兜底。"""
    from app.models.agent import Agent, Skill

    key = (agent_key or "default").strip() or "default"

    agent_row = (await db.execute(
        select(Agent).where(
            Agent.agent_id == key,
            Agent.deleted_at.is_(None),
            Agent.scope.in_(["system"]) | (Agent.tenant_id == tenant_id),
        )
    )).scalar_one_or_none()

    if agent_row is None:
        if key == "default":
            return merge_skills(DEFAULT_AGENT, [])
        raise ValueError(f"Agent 不存在或无权访问: {key}")

    agent = _agent_to_dict(agent_row)
    skills: list[dict] = []
    for sid in (agent.get("skill_ids") or []):
        s = (await db.execute(
            select(Skill).where(Skill.skill_id == sid, Skill.deleted_at.is_(None))
        )).scalar_one_or_none()
        if s is not None:
            skills.append(_skill_to_dict(s))
    return merge_skills(agent, skills)


async def plan_only(runtime: dict, goal: str, inputs: Optional[dict] = None, user_id: Optional[int] = None) -> dict:
    """dry-run：让 LLM 基于合并后的 persona 规划一次，返回拟调用的工具（含预估花费），不执行/不扣费。"""
    from langchain_core.messages import SystemMessage, HumanMessage

    from app.harness.llm import get_llm
    from app.plugins.registry import all_plugins, load_builtin_plugins

    load_builtin_plugins()
    allowed = set(runtime.get("allowed_plugins") or [])
    plugins = [p for p in all_plugins() if p.name in allowed]
    tool_map = {p.tool_name: p for p in plugins}
    llm = get_llm(user_id=user_id).bind_tools([p.to_openai_tool() for p in plugins])

    user_text = goal if not inputs else f"{goal}\n\n[输入素材]{inputs}"
    resp = await llm.ainvoke([
        SystemMessage(content=runtime["persona"]),
        HumanMessage(content=user_text),
    ])

    planned = []
    for tc in (getattr(resp, "tool_calls", None) or []):
        plugin = tool_map.get(tc["name"])
        args = tc.get("args", {}) or {}
        planned.append({
            "name": tc["name"],
            "plugin": plugin.name if plugin else None,
            "label": plugin.label if plugin else tc["name"],
            "args": args,
            "cost": plugin.cost(args) if plugin else 0,
        })

    return {
        "plan_text": resp.content if isinstance(resp.content, str) else "",
        "planned_tool_calls": planned,
        "allowed_plugins": sorted(allowed),
        "estimated_cost": sum(p["cost"] for p in planned),
    }

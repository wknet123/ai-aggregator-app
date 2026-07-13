"""Custom Agent API（P0-a 骨架）—— 投递 Run + 查询状态。

POST /api/v1/agents/runs        启动一次 Run（建 AgentRun + arq enqueue），立即返回 run_id
GET  /api/v1/agents/runs/{id}   轮询 Run 状态（含 steps / progress / 产物）
GET  /api/v1/agents/plugins     可用 Plugin 能力清单

真正的执行在独立 harness-worker 容器（见 app/harness）。本路由不跑 loop。
"""
from __future__ import annotations

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.config import settings
from app.db.session import get_db
from app.dependencies import get_current_user
from app.harness.agent_config import load_runtime, plan_only
from app.models.agent import AgentRun, AgentStep, Agent, Skill
from app.models.user import User
from app.plugins.registry import all_plugins, load_builtin_plugins
from app.schemas.response import ResponseBase

router = APIRouter()


class CreateRunBody(BaseModel):
    goal: str
    inputs: Optional[dict] = None
    agent_key: str = "default"
    confirm_mode: Optional[str] = None    # 不传则取 agent.policy.confirm_mode（兜底 auto）


class ConfirmBody(BaseModel):
    action: str                                    # continue / edit / skip / abort
    edited_args: Optional[dict] = None             # action=edit：{tool_call_id: {...新参数...}}
    reason: Optional[str] = None                   # action=skip：跳过原因（回喂 LLM）


class AgentBody(BaseModel):
    name: str
    persona: str
    description: Optional[str] = None
    avatar: Optional[str] = None
    skill_ids: Optional[list[str]] = None
    allowed_plugins: Optional[list[str]] = None
    policy: Optional[dict] = None
    scope: str = "private"                          # private / tenant（system 仅播种）


class SkillBody(BaseModel):
    name: str
    instructions: str
    category: Optional[str] = None
    icon: Optional[str] = None
    description: Optional[str] = None
    when_to_use: Optional[str] = None
    recommended_plugins: Optional[list[str]] = None
    inputs: Optional[list] = None
    outputs: Optional[list] = None
    constraints: Optional[dict] = None
    few_shot: Optional[list] = None
    scope: str = "private"


class DryRunBody(BaseModel):
    goal: str
    inputs: Optional[dict] = None
    agent_key: str = "default"


def _run_to_dict(run: AgentRun, steps: Optional[list[AgentStep]] = None) -> dict:
    d = {
        "run_id": run.run_id,
        "agent_key": run.agent_key,
        "goal": run.goal,
        "status": run.status,
        "progress": run.progress,
        "confirm_mode": run.confirm_mode,
        "pending_confirmation": run.pending_confirmation,
        "plan": run.plan,
        "final_artifacts": run.final_artifacts,
        "total_cost": run.total_cost,
        "error_message": run.error_message,
        "created_at": run.created_at.isoformat() if run.created_at else None,
        "updated_at": run.updated_at.isoformat() if run.updated_at else None,
    }
    if steps is not None:
        d["steps"] = [
            {
                "step_index": s.step_index,
                "type": s.type,
                "plugin_name": s.plugin_name,
                "thought": s.thought,
                "input_data": s.input_data,
                "output_data": s.output_data,
                "status": s.status,
                "error_message": s.error_message,
            }
            for s in steps
        ]
    return d


@router.get("/plugins", response_model=ResponseBase)
async def list_plugins(current_user: User = Depends(get_current_user)):
    """可用 Plugin 能力清单（供前端/SKILL 编辑器）。"""
    load_builtin_plugins()
    return ResponseBase(success=True, data={
        "items": [
            {
                "name": p.name, "family": p.family, "label": p.label,
                "description": p.description, "output_type": p.output_type,
                "parameters_schema": p.parameters_schema,
            }
            for p in all_plugins()
        ]
    })


@router.post("/runs", response_model=ResponseBase)
async def create_run(
    body: CreateRunBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """启动一次 Run：落库 pending → arq enqueue → 立即返回 run_id。"""
    goal = (body.goal or "").strip()
    if not goal:
        raise HTTPException(status_code=400, detail="goal 不能为空")

    agent_key = (body.agent_key or "default").strip() or "default"
    # 校验 agent 可访问 + 取其默认 confirm_mode（load_runtime 对不存在的非 default key 会抛 ValueError）
    try:
        runtime = await load_runtime(db, agent_key, current_user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))

    if body.confirm_mode in ("auto", "checkpoint", "step"):
        confirm_mode = body.confirm_mode
    else:
        confirm_mode = (runtime.get("policy") or {}).get("confirm_mode") or "auto"

    run_id = str(uuid.uuid4())
    run = AgentRun(
        run_id=run_id, user_id=current_user.id, tenant_id=current_user.tenant_id,
        agent_key=agent_key, goal=goal, inputs=body.inputs,
        status="pending", progress=0, confirm_mode=confirm_mode,
    )
    db.add(run)
    await db.commit()

    # 投递到 harness worker
    from arq import create_pool
    from arq.connections import RedisSettings
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await pool.enqueue_job("run_agent", run_id)
        await pool.aclose()
    except Exception as exc:  # noqa: BLE001
        run.status = "failed"
        run.error_message = f"任务投递失败: {exc}"
        await db.commit()
        raise HTTPException(status_code=503, detail=f"任务队列不可用: {exc}")

    return ResponseBase(success=True, message="已提交", data={"run_id": run_id})


@router.get("/runs/{run_id}", response_model=ResponseBase)
async def get_run(
    run_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    run = (await db.execute(
        select(AgentRun).where(
            AgentRun.run_id == run_id,
            AgentRun.user_id == current_user.id,
            AgentRun.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")

    steps = (await db.execute(
        select(AgentStep).where(AgentStep.run_id == run_id).order_by(AgentStep.step_index)
    )).scalars().all()

    return ResponseBase(success=True, data=_run_to_dict(run, steps))


@router.post("/runs/{run_id}/cancel", response_model=ResponseBase)
async def cancel_run(
    run_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """取消一个 Run：置 status=cancelled。worker 在下一步检查点/工具前会察觉并中止。"""
    run = (await db.execute(
        select(AgentRun).where(
            AgentRun.run_id == run_id,
            AgentRun.user_id == current_user.id,
            AgentRun.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status in ("completed", "failed", "cancelled"):
        return ResponseBase(success=True, message=f"Run 已是 {run.status}，无需取消",
                            data={"status": run.status})
    run.status = "cancelled"
    await db.commit()
    return ResponseBase(success=True, message="已取消", data={"status": "cancelled"})


@router.post("/runs/{run_id}/confirm", response_model=ResponseBase)
async def confirm_run(
    run_id: str,
    body: ConfirmBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """人工确认一个挂起的 Run：落 confirm_decision → 置 running → 重新入队恢复图执行。

    action: continue（原样执行）/ edit（改参数后执行）/ skip（跳过此步）/ abort（终止）。
    """
    action = (body.action or "").strip()
    if action not in ("continue", "edit", "skip", "abort"):
        raise HTTPException(status_code=400, detail="action 必须是 continue/edit/skip/abort")

    run = (await db.execute(
        select(AgentRun).where(
            AgentRun.run_id == run_id,
            AgentRun.user_id == current_user.id,
            AgentRun.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")
    if run.status != "awaiting_confirmation":
        raise HTTPException(status_code=409, detail=f"Run 当前 {run.status}，无待确认项")

    decision = {"action": action}
    if action == "edit":
        decision["edited_args"] = body.edited_args or {}
    if action == "skip":
        decision["reason"] = body.reason or "用户跳过此步"

    run.confirm_decision = decision
    run.pending_confirmation = None
    run.status = "running"          # worker 恢复时凭 confirm_decision 判定为 confirm_resume
    await db.commit()

    from arq import create_pool
    from arq.connections import RedisSettings
    try:
        pool = await create_pool(RedisSettings.from_dsn(settings.REDIS_URL))
        await pool.enqueue_job("run_agent", run_id)
        await pool.aclose()
    except Exception as exc:  # noqa: BLE001
        # 入队失败：回滚到 awaiting，让用户可重试确认
        run.status = "awaiting_confirmation"
        run.confirm_decision = None
        await db.commit()
        raise HTTPException(status_code=503, detail=f"任务队列不可用: {exc}")

    return ResponseBase(success=True, message="已确认", data={"action": action, "status": "running"})


@router.get("/runs/{run_id}/artifact")
async def get_run_artifact(
    run_id: str,
    key: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """鉴权流式输出某 Run 的产物（图/视频）。key 必须落在本 Run 的私有产物目录内。

    产物 MinIO key 形如 users/{uid}/agents/{run_id}/xxx.png，属用户私有，无法直连 minio，
    也不能开放代理。这里校验归属 + 前缀后经后端流式吐出，供前端 <img>/<video> 走 blob 展示。
    """
    run = (await db.execute(
        select(AgentRun).where(
            AgentRun.run_id == run_id,
            AgentRun.user_id == current_user.id,
            AgentRun.deleted_at.is_(None),
        )
    )).scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run 不存在")

    prefix = f"users/{current_user.id}/agents/{run_id}/"
    if not key.startswith(prefix) or ".." in key:
        raise HTTPException(status_code=400, detail="非法产物 key")

    from fastapi.responses import Response
    from app.services.storage import get_storage_service
    try:
        data, content_type = await get_storage_service().get_object_bytes(key)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=404, detail=f"产物不存在: {exc}")
    return Response(
        content=data,
        media_type=content_type or "application/octet-stream",
        headers={"Cache-Control": "private, max-age=3600", "Accept-Ranges": "bytes"},
    )


@router.get("/runs", response_model=ResponseBase)
async def list_runs(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    runs = (await db.execute(
        select(AgentRun).where(
            AgentRun.user_id == current_user.id,
            AgentRun.deleted_at.is_(None),
        ).order_by(AgentRun.created_at.desc()).limit(50)
    )).scalars().all()
    return ResponseBase(success=True, data={"items": [_run_to_dict(r) for r in runs]})


# ══════════════════════════════════════════════════════════════════════════════
# P1-a：Agent / Skill 定义 CRUD + dry-run
# 注意：所有 /{agent_id} 动态单段路由必须注册在本区块末尾（在 /plugins /runs /skills
# /dry-run 等静态路由之后），否则 FastAPI 会把 "plugins"/"runs" 当成 agent_id 捕获。
# ══════════════════════════════════════════════════════════════════════════════

def _agent_out(a: Agent) -> dict:
    return {
        "agent_id": a.agent_id, "name": a.name, "description": a.description,
        "avatar": a.avatar, "persona": a.persona, "skill_ids": a.skill_ids or [],
        "allowed_plugins": a.allowed_plugins or [], "policy": a.policy or {},
        "scope": a.scope, "is_active": a.is_active,
        "created_at": a.created_at.isoformat() if a.created_at else None,
        "updated_at": a.updated_at.isoformat() if a.updated_at else None,
    }


def _skill_out(s: Skill) -> dict:
    return {
        "skill_id": s.skill_id, "name": s.name, "category": s.category, "icon": s.icon,
        "description": s.description, "when_to_use": s.when_to_use, "instructions": s.instructions,
        "recommended_plugins": s.recommended_plugins or [], "inputs": s.inputs or [],
        "outputs": s.outputs or [], "constraints": s.constraints or {}, "few_shot": s.few_shot or [],
        "scope": s.scope, "version": s.version,
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _validate_plugins(names: Optional[list[str]]) -> list[str]:
    """校验 plugin 名都已注册；返回去重后的列表。"""
    if not names:
        return []
    load_builtin_plugins()
    registered = {p.name for p in all_plugins()}
    unknown = [n for n in names if n not in registered]
    if unknown:
        raise HTTPException(status_code=400, detail=f"未知 Plugin：{', '.join(unknown)}")
    seen, out = set(), []
    for n in names:
        if n not in seen:
            seen.add(n); out.append(n)
    return out


@router.get("/", response_model=ResponseBase)
async def list_agents(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """列出可见 Agent：system + 本租户(tenant scope) + 本人(private)。"""
    rows = (await db.execute(
        select(Agent).where(
            Agent.deleted_at.is_(None),
            or_(
                Agent.scope == "system",
                (Agent.scope == "tenant") & (Agent.tenant_id == current_user.tenant_id),
                (Agent.scope == "private") & (Agent.user_id == current_user.id),
            ),
        ).order_by(Agent.scope.desc(), Agent.created_at.desc())
    )).scalars().all()
    return ResponseBase(success=True, data={"items": [_agent_out(a) for a in rows]})


@router.post("/", response_model=ResponseBase)
async def create_agent(
    body: AgentBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """创建自定义 Agent。用户不可创建 system 级（仅播种）。"""
    name = (body.name or "").strip()
    persona = (body.persona or "").strip()
    if not name or not persona:
        raise HTTPException(status_code=400, detail="name 与 persona 不能为空")
    scope = body.scope if body.scope in ("private", "tenant") else "private"
    allowed = _validate_plugins(body.allowed_plugins) or ["image.generate"]

    agent = Agent(
        agent_id=str(uuid.uuid4()), tenant_id=current_user.tenant_id, user_id=current_user.id,
        name=name, description=body.description, avatar=body.avatar, persona=persona,
        skill_ids=body.skill_ids or [], allowed_plugins=allowed,
        policy=body.policy or {"max_steps": 6, "budget_limit": 100,
                               "confirm_cost_threshold": 1, "confirm_mode": "auto"},
        scope=scope, is_active=1,
    )
    db.add(agent)
    await db.commit()
    return ResponseBase(success=True, message="已创建", data=_agent_out(agent))


@router.get("/skills", response_model=ResponseBase)
async def list_skills(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    rows = (await db.execute(
        select(Skill).where(
            Skill.deleted_at.is_(None),
            or_(
                Skill.scope == "system",
                (Skill.scope == "tenant") & (Skill.tenant_id == current_user.tenant_id),
                (Skill.scope == "private") & (Skill.user_id == current_user.id),
            ),
        ).order_by(Skill.scope.desc(), Skill.created_at.desc())
    )).scalars().all()
    return ResponseBase(success=True, data={"items": [_skill_out(s) for s in rows]})


@router.post("/skills", response_model=ResponseBase)
async def create_skill(
    body: SkillBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    name = (body.name or "").strip()
    instructions = (body.instructions or "").strip()
    if not name or not instructions:
        raise HTTPException(status_code=400, detail="name 与 instructions 不能为空")
    scope = body.scope if body.scope in ("private", "tenant") else "private"
    _validate_plugins(body.recommended_plugins)   # 校验（不强制非空）

    skill = Skill(
        skill_id=str(uuid.uuid4()), tenant_id=current_user.tenant_id, user_id=current_user.id,
        name=name, category=body.category, icon=body.icon, description=body.description,
        when_to_use=body.when_to_use, instructions=instructions,
        recommended_plugins=body.recommended_plugins or [], inputs=body.inputs or [],
        outputs=body.outputs or [], constraints=body.constraints or {}, few_shot=body.few_shot or [],
        scope=scope, version=1,
    )
    db.add(skill)
    await db.commit()
    return ResponseBase(success=True, message="已创建", data=_skill_out(skill))


async def _get_owned_skill(db, skill_id: str, current_user: User) -> Skill:
    s = (await db.execute(
        select(Skill).where(Skill.skill_id == skill_id, Skill.deleted_at.is_(None))
    )).scalar_one_or_none()
    if not s:
        raise HTTPException(status_code=404, detail="Skill 不存在")
    if s.scope == "system" or (s.user_id != current_user.id and s.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=403, detail="无权修改此 Skill")
    return s


@router.put("/skills/{skill_id}", response_model=ResponseBase)
async def update_skill(
    skill_id: str,
    body: SkillBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    s = await _get_owned_skill(db, skill_id, current_user)
    _validate_plugins(body.recommended_plugins)
    s.name = (body.name or s.name).strip()
    s.instructions = (body.instructions or s.instructions).strip()
    s.category = body.category; s.icon = body.icon; s.description = body.description
    s.when_to_use = body.when_to_use
    s.recommended_plugins = body.recommended_plugins or []
    s.inputs = body.inputs or []; s.outputs = body.outputs or []
    s.constraints = body.constraints or {}; s.few_shot = body.few_shot or []
    s.version = (s.version or 1) + 1        # 编辑自增
    await db.commit()
    return ResponseBase(success=True, message="已更新", data=_skill_out(s))


@router.delete("/skills/{skill_id}", response_model=ResponseBase)
async def delete_skill(
    skill_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime
    s = await _get_owned_skill(db, skill_id, current_user)
    s.deleted_at = datetime.utcnow()
    await db.commit()
    return ResponseBase(success=True, message="已删除", data={"skill_id": skill_id})


@router.post("/dry-run", response_model=ResponseBase)
async def dry_run(
    body: DryRunBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """干跑：只让智能体规划一次，返回拟调用工具（含预估花费），不建 Run、不执行、不扣费。"""
    goal = (body.goal or "").strip()
    if not goal:
        raise HTTPException(status_code=400, detail="goal 不能为空")
    try:
        runtime = await load_runtime(db, body.agent_key, current_user.tenant_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    try:
        result = await plan_only(runtime, goal, body.inputs, user_id=current_user.id)
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=502, detail=f"规划失败: {exc}")
    return ResponseBase(success=True, data=result)


# ── /{agent_id} 动态路由：务必位于所有静态路由之后 ──────────────────────────────
async def _get_owned_agent(db, agent_id: str, current_user: User) -> Agent:
    a = (await db.execute(
        select(Agent).where(Agent.agent_id == agent_id, Agent.deleted_at.is_(None))
    )).scalar_one_or_none()
    if not a:
        raise HTTPException(status_code=404, detail="Agent 不存在")
    return a


@router.get("/{agent_id}", response_model=ResponseBase)
async def get_agent(
    agent_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    a = await _get_owned_agent(db, agent_id, current_user)
    if a.scope != "system" and a.tenant_id != current_user.tenant_id:
        raise HTTPException(status_code=403, detail="无权访问此 Agent")
    return ResponseBase(success=True, data=_agent_out(a))


@router.put("/{agent_id}", response_model=ResponseBase)
async def update_agent(
    agent_id: str,
    body: AgentBody,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    a = await _get_owned_agent(db, agent_id, current_user)
    if a.scope == "system" or (a.user_id != current_user.id and a.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=403, detail="无权修改此 Agent")
    a.name = (body.name or a.name).strip()
    a.persona = (body.persona or a.persona).strip()
    a.description = body.description; a.avatar = body.avatar
    if body.skill_ids is not None:
        a.skill_ids = body.skill_ids
    if body.allowed_plugins is not None:
        a.allowed_plugins = _validate_plugins(body.allowed_plugins)
    if body.policy is not None:
        a.policy = body.policy
    if body.scope in ("private", "tenant"):
        a.scope = body.scope
    await db.commit()
    return ResponseBase(success=True, message="已更新", data=_agent_out(a))


@router.delete("/{agent_id}", response_model=ResponseBase)
async def delete_agent(
    agent_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    from datetime import datetime
    a = await _get_owned_agent(db, agent_id, current_user)
    if a.scope == "system" or (a.user_id != current_user.id and a.tenant_id != current_user.tenant_id):
        raise HTTPException(status_code=403, detail="无权删除此 Agent")
    a.deleted_at = datetime.utcnow()
    await db.commit()
    return ResponseBase(success=True, message="已删除", data={"agent_id": agent_id})
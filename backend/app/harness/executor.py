"""执行器（P0-b-2）：装配 checkpointer + 扣费/退款/幂等/预算/取消 + 人工确认，驱动 LangGraph 跑一个 Run。

相对 P0-a 新增（P0-b）：
- **续跑**：per-run AsyncSqliteSaver 检查点（落共享 storage 卷）。worker 重启后对 status=running
  的 Run 重新入队 → 以 input=None 从检查点恢复（不重跑已完成节点）。
- **扣费/退款**：tool 执行前 deduct，失败 recharge；total_cost 累加。
- **幂等**：以 tool_call_id 为键——执行前查 agent_steps 是否已完成，命中则复用产物（不重复扣费/生图）。
  覆盖「Plugin 已执行+已提交，但检查点未落盘就崩溃」的重跑窗口。
- **预算/步数**：budget_limit 超限则不再执行并回喂提示；max_steps 由 recursion_limit 约束。
- **取消**：check_cancelled 每步查 status；被取消则中止且不翻转为 completed。

P0-b-2 新增 **人工确认（interrupt ↔ confirm_mode）**：
- confirm_mode ∈ {auto, checkpoint, step}（per-run，落 agent_runs.confirm_mode）。
- confirm_gate 节点 interrupt() 挂起后，ainvoke 返回；本执行器用 aget_state 检测挂起 →
  置 awaiting_confirmation + 写 pending_confirmation（供前端展示待执行动作）→ worker 任务结束。
- POST /confirm 落 confirm_decision + 置 running 重新入队 → 本执行器用 Command(resume=decision) 恢复。
- 三种入口：fresh（首次 init_state）/ confirm_resume（Command(resume)）/ crash_resume（None）。
"""
from __future__ import annotations

import logging
import os

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from langgraph.types import Command
from sqlalchemy import select

from app.config import settings
from app.core.credits import InsufficientCreditsError
from app.db.session import AsyncSessionLocal
from app.harness.graph import build_graph, GraphCancelled, AgentState
from app.harness.llm import get_llm
from app.harness.agent_config import load_runtime, merge_skills, DEFAULT_AGENT, build_user_text
from app.models.agent import AgentRun, AgentStep
from app.plugins.base import PluginContext
from app.plugins.registry import all_plugins, get_plugin, load_builtin_plugins
from app.services.credit_service import CreditService
from app.services.storage import get_storage_service
from app.integrations.gateway.client import get_gateway_client_for_user
from app.services import gateway_config_service

logger = logging.getLogger(__name__)

# 检查点目录（共享 storage 卷；per-run 一个文件，避免 sqlite 跨 run 锁竞争）
_CKPT_DIR = os.path.join(settings.STORAGE_BASE_PATH, "agent_ckpt")


async def _load_run(db, run_id: str):
    return (await db.execute(select(AgentRun).where(AgentRun.run_id == run_id))).scalar_one_or_none()


async def execute_run(run_id: str) -> None:
    load_builtin_plugins()
    os.makedirs(_CKPT_DIR, exist_ok=True)

    # 判定入口模式：fresh（首次）/ confirm_resume（人工确认后）/ crash_resume（崩溃重入队）
    async with AsyncSessionLocal() as db:
        # worker 是独立进程：确保网关解析缓存已加载（首个 Run 时冷启动）
        if not gateway_config_service.is_loaded():
            await gateway_config_service.refresh_cache(db)
        run = await _load_run(db, run_id)
        if not run:
            logger.error("execute_run: run %s 不存在", run_id)
            return
        if run.status in ("completed", "cancelled", "failed"):
            logger.info("execute_run: run %s 已是 %s，跳过", run_id, run.status)
            return
        orig_status = run.status
        decision = run.confirm_decision          # 人工确认决定（若有）
        if decision is not None:
            entry = "confirm_resume"
        elif orig_status == "pending":
            entry = "fresh"
        else:                                    # running/awaiting_confirmation 无 decision → 崩溃续跑
            entry = "crash_resume"
        confirm_mode = run.confirm_mode or "auto"
        run.status = "running"
        run.confirm_decision = None              # 消费决定，防重复恢复
        run.pending_confirmation = None          # 清旧的待确认 payload
        # 回写挂起时留下的 confirm 占位步终态，避免「Run 已完成、该步仍 pending」。
        if entry == "confirm_resume" and isinstance(decision, dict):
            _CONFIRM_STEP_STATUS = {
                "continue": "completed", "edit": "completed",
                "skip": "skipped", "abort": "cancelled",
            }
            pending_confirm = (await db.execute(
                select(AgentStep).where(
                    AgentStep.run_id == run_id,
                    AgentStep.type == "confirm",
                    AgentStep.status == "pending",
                ).order_by(AgentStep.step_index.desc())
            )).scalars().first()
            if pending_confirm is not None:
                pending_confirm.status = _CONFIRM_STEP_STATUS.get(decision.get("action"), "completed")
        # 运行配置：fresh 从库加载 Agent+Skill 合并并快照；resume 读快照（防定义漂移/保证续跑一致）
        if entry == "fresh":
            try:
                runtime = await load_runtime(db, run.agent_key, run.tenant_id)
            except ValueError as exc:
                run.status = "failed"
                run.error_message = str(exc)[:2000]
                await db.commit()
                logger.error("execute_run: %s", exc)
                return
            run.agent_snapshot = runtime
            run.progress = 10
        else:
            runtime = run.agent_snapshot or merge_skills(DEFAULT_AGENT, [])
        user_id, tenant_id, goal, inputs = run.user_id, run.tenant_id, run.goal, run.inputs
        # 取出用户选定的模型偏好（不进 user_text），注入 constraints 供 _enforce_constraints 使用。
        model_prefs = None
        if isinstance(inputs, dict) and "__model_prefs__" in inputs:
            inputs = dict(inputs)
            model_prefs = inputs.pop("__model_prefs__", None)
        if model_prefs:
            constraints = dict(runtime.get("constraints") or {})
            constraints["model_by_plugin"] = model_prefs
            runtime["constraints"] = constraints
        policy = runtime["policy"]
        await db.commit()

    ctx = PluginContext(
        user_id=user_id, tenant_id=tenant_id, run_id=run_id,
        storage=get_storage_service(), gateway=get_gateway_client_for_user(user_id),
    )
    allowed = set(runtime["allowed_plugins"])
    plugins = [p for p in all_plugins() if p.name in allowed]
    tool_specs = [p.to_openai_tool() for p in plugins]
    tool_map = {p.tool_name: p for p in plugins}
    llm = get_llm(user_id=user_id).bind_tools(tool_specs)

    step_counter = {"i": 0}
    # 恢复入口下从已有最大 step_index 续号，避免跨 invocation 索引冲突（轨迹可读）
    async with AsyncSessionLocal() as db:
        rows = (await db.execute(
            select(AgentStep.step_index).where(AgentStep.run_id == run_id)
        )).scalars().all()
        step_counter["i"] = max(rows) if rows else 0

    # ── 取消检查 ──────────────────────────────────────────────────────────────
    async def check_cancelled() -> bool:
        async with AsyncSessionLocal() as db:
            r = await _load_run(db, run_id)
            return bool(r and r.status == "cancelled")

    # ── 单工具执行：幂等 → 预算 → 扣费 → 执行 → 退款/记账 ─────────────────────
    async def run_tool(tool_name: str, args: dict, tool_call_id: str):
        plugin = tool_map.get(tool_name)
        if plugin is None:
            await _write_step(run_id, step_counter, "tool_call", tool_name, tool_call_id,
                              args, None, error=f"未知工具 {tool_name}（不在白名单）")
            return None, f"未知工具 {tool_name}"

        # 0) 约束硬校验（P1-b）：按 runtime.constraints 强制画面比例 / 截断时长，
        #    覆盖 LLM 传入值。覆盖后的 args 既用于执行、也记入 step.input_data（前端可见真实参数）。
        args = _enforce_constraints(plugin, dict(args or {}), runtime.get("constraints") or {})

        # 1) 幂等：已完成过同一 tool_call_id → 复用产物，不重复扣费/执行
        async with AsyncSessionLocal() as db:
            done = (await db.execute(
                select(AgentStep).where(
                    AgentStep.run_id == run_id,
                    AgentStep.tool_call_id == tool_call_id,
                    AgentStep.status == "completed",
                )
            )).scalar_one_or_none()
            if done and done.output_data:
                logger.info("run %s: tool_call %s 幂等命中，复用产物", run_id, tool_call_id)
                return done.output_data, None

        cost = plugin.cost(args)

        # 2) 预算 + 余额
        async with AsyncSessionLocal() as db:
            r = await _load_run(db, run_id)
            budget = policy.get("budget_limit", 0)
            if budget and (r.total_cost or 0) + cost > budget:
                await _write_step(run_id, step_counter, "tool_call", plugin.name, tool_call_id,
                                  args, None, error=f"超出预算上限（{budget}）")
                return None, f"超出预算上限（已用 {r.total_cost}，本次需 {cost}）"
            cs = CreditService(db)
            if cost > 0 and not await cs.check_sufficient_credits(tenant_id, cost):
                await _write_step(run_id, step_counter, "tool_call", plugin.name, tool_call_id,
                                  args, None, error="积分余额不足")
                return None, "积分余额不足"

        # 3) 扣费
        charged = False
        if cost > 0:
            try:
                async with AsyncSessionLocal() as db:
                    await CreditService(db).deduct(tenant_id, cost, f"agent[{run_id[:8]}] {plugin.name}")
                    charged = True
            except InsufficientCreditsError:
                await _write_step(run_id, step_counter, "tool_call", plugin.name, tool_call_id,
                                  args, None, error="积分余额不足")
                return None, "积分余额不足"

        # 4) 执行 Plugin
        try:
            result = await plugin.execute(ctx, args)
        except Exception as exc:  # noqa: BLE001
            logger.exception("run %s: plugin %s 执行失败", run_id, plugin.name)
            if charged:  # 退款
                async with AsyncSessionLocal() as db:
                    await CreditService(db).recharge(tenant_id, cost, "refund", f"agent-fail-{run_id[:8]}")
            await _write_step(run_id, step_counter, "tool_call", plugin.name, tool_call_id,
                              args, None, error=str(exc), cost=0)
            return None, str(exc)

        # 5) 记账：写完成 step + 累加 total_cost
        await _write_step(run_id, step_counter, "tool_call", plugin.name, tool_call_id,
                          args, result.artifact, error=None, cost=cost, add_cost=cost)
        return result.artifact, None

    # ── 人工确认：依 confirm_mode 决定是否挂起，构造 interrupt payload ──────────
    threshold = policy.get("confirm_cost_threshold", 1)

    def confirm_payload(tool_calls: list) -> dict | None:
        if confirm_mode == "auto":
            return None
        pend, trigger = [], False
        for tc in tool_calls:
            plugin = tool_map.get(tc["name"])
            cost = plugin.cost(tc.get("args", {}) or {}) if plugin else 0
            pend.append({
                "tool_call_id": tc["id"],
                "name": tc["name"],
                "plugin": plugin.name if plugin else None,
                "label": plugin.label if plugin else tc["name"],
                "args": tc.get("args", {}) or {},
                "cost": cost,
            })
            if confirm_mode == "step" or (confirm_mode == "checkpoint" and cost >= threshold):
                trigger = True
        if not trigger:
            return None
        return {
            "type": "confirm",
            "mode": confirm_mode,
            "pending": pend,
            "actions": ["continue", "edit", "skip", "abort"],
            "message": f"智能体准备执行 {len(pend)} 个动作，请确认（continue/edit/skip/abort）",
        }

    # ── 跳过：为被跳过的 tool_calls 写 skipped step ───────────────────────────
    async def record_skip(tool_calls: list, reason: str) -> None:
        for tc in tool_calls:
            plugin = tool_map.get(tc["name"])
            await _write_step(run_id, step_counter, "tool_call",
                              plugin.name if plugin else tc["name"], tc["id"],
                              tc.get("args", {}) or {}, None,
                              error=None, cost=0, status="skipped")

    builder = build_graph(llm, run_tool, check_cancelled, confirm_payload, record_skip)

    sys_prompt = runtime["persona"]
    user_text = build_user_text(goal, inputs, runtime.get("input_schema"))
    ckpt_path = os.path.join(_CKPT_DIR, f"{run_id}.sqlite")
    config = {
        "configurable": {"thread_id": run_id},
        "recursion_limit": policy["max_steps"] * 4 + 6,   # confirm_gate 加了节点 + 跨 resume 累计
    }

    try:
        async with AsyncSqliteSaver.from_conn_string(ckpt_path) as saver:
            graph = builder.compile(checkpointer=saver)
            if entry == "confirm_resume":
                logger.info("run %s: 人工确认后恢复 decision=%s", run_id, decision)
                final = await graph.ainvoke(Command(resume=decision), config)
            elif entry == "crash_resume":
                logger.info("run %s: 从检查点续跑", run_id)
                final = await graph.ainvoke(None, config)   # None → 从检查点恢复
            else:  # fresh
                init_state: AgentState = {
                    "messages": [SystemMessage(content=sys_prompt), HumanMessage(content=user_text)],
                    "artifacts": [],
                }
                final = await graph.ainvoke(init_state, config)

            # 检测是否停在 interrupt（人工确认挂起）
            snap = await graph.aget_state(config)
            pending = [it for t in snap.tasks for it in (t.interrupts or [])]
            if pending:
                await _enter_awaiting(run_id, step_counter, pending[0].value)
                logger.info("run %s: 挂起等待人工确认", run_id)
                return
    except GraphCancelled:
        logger.info("run %s 被取消/中止", run_id)
        async with AsyncSessionLocal() as db:      # abort 场景 status 仍是 running，翻 cancelled
            r = await _load_run(db, run_id)
            if r and r.status not in ("completed", "failed", "cancelled"):
                r.status = "cancelled"
            await _settle_dangling_confirm_steps(db, run_id, "cancelled")
            await db.commit()
        return
    except Exception as exc:  # noqa: BLE001
        logger.exception("run %s 执行失败", run_id)
        async with AsyncSessionLocal() as db:
            r = await _load_run(db, run_id)
            if r and r.status not in ("cancelled",):
                r.status = "failed"
                r.error_message = str(exc)[:2000]
            await _settle_dangling_confirm_steps(db, run_id, "failed")
            await db.commit()
        return

    # 收尾
    artifacts = final.get("artifacts", []) or []
    summary = ""
    for m in reversed(final.get("messages", [])):
        if isinstance(m, AIMessage) and isinstance(m.content, str) and m.content.strip():
            summary = m.content.strip()
            break

    async with AsyncSessionLocal() as db:
        r = await _load_run(db, run_id)
        if r and r.status != "cancelled":
            r.status = "completed"
            r.progress = 100
            r.final_artifacts = artifacts
            r.plan = {"summary": summary}
            step_counter["i"] += 1
            db.add(AgentStep(
                run_id=run_id, step_index=step_counter["i"], type="summary",
                thought=summary, output_data={"artifacts": artifacts}, status="completed",
            ))
            await _settle_dangling_confirm_steps(db, run_id, "completed")
            works = await _register_artifacts_as_works(
                db, user_id=user_id, tenant_id=tenant_id, run_id=run_id,
                agent_key=(r.agent_key or ""),
                goal=goal, artifacts=artifacts,
            )
            await db.commit()
            logger.info("run %s 登记 %d 件产物为作品", run_id, works)
    logger.info("run %s 完成，产物 %d 件，累计花费 %s", run_id, len(artifacts),
                (r.total_cost if r else "?"))


def _enforce_constraints(plugin, args: dict, constraints: dict) -> dict:
    """按合并后的 SKILL 约束硬校验工具入参（P1-b）：强制画面比例、截断时长。

    仅当 plugin 的 parameters_schema 声明了对应参数才注入/覆盖，避免污染无关工具。
    """
    if not constraints:
        return args
    props = (getattr(plugin, "parameters_schema", None) or {}).get("properties") or {}
    ar = constraints.get("aspect_ratio")
    if ar:
        for k in ("aspect_ratio", "ratio"):
            if k in props:
                args[k] = ar
    max_dur = constraints.get("max_duration_sec")
    if max_dur is not None and "duration" in props:
        try:
            cur = int(args.get("duration")) if args.get("duration") is not None else None
        except (TypeError, ValueError):
            cur = None
        if cur is None or cur > max_dur:
            args["duration"] = max_dur
    # 用户为该插件选定的模型（按需求+单价）：仅当 schema 暴露 model 且属该插件候选时注入。
    model_by_plugin = constraints.get("model_by_plugin") or {}
    chosen = model_by_plugin.get(getattr(plugin, "name", ""))
    if chosen and "model" in props:
        from app.core.pricing import model_options
        allowed = {o["model"] for o in model_options(getattr(plugin, "name", ""))}
        if chosen in allowed:
            args["model"] = chosen
    return args


async def _enter_awaiting(run_id, step_counter, payload: dict) -> None:
    """图停在 interrupt：置 awaiting_confirmation + 落 pending_confirmation + 记一条 confirm step。"""
    step_counter["i"] += 1
    async with AsyncSessionLocal() as db:
        db.add(AgentStep(
            run_id=run_id, step_index=step_counter["i"], type="confirm",
            thought=payload.get("message"), input_data=payload, status="pending",
        ))
        r = await _load_run(db, run_id)
        if r and r.status == "running":          # 取消可能已抢先置 cancelled
            r.status = "awaiting_confirmation"
            r.pending_confirmation = payload
        await db.commit()


async def _register_artifacts_as_works(
    db, *, user_id: int, tenant_id: int, run_id: str, agent_key: str,
    goal: str, artifacts: list,
) -> int:
    """把 Run 的最终 image/video 产物登记为「作品」（generation_tasks，show_in_gallery=1），
    使其出现在「我的作品」/AI图片/AI视频列表。复用现有 /task/{id}/file 取流端点。
    需与调用方共用同一 session（由调用方 commit）。返回登记数量。"""
    import json
    import uuid as _uuid
    from app.models.generation_task import GenerationTask

    n = 0
    for a in artifacts or []:
        a_type = a.get("type")
        key = a.get("key")
        if a_type not in ("image", "video") or not key:
            continue
        db.add(GenerationTask(
            task_id=f"agent-{run_id}-{_uuid.uuid4().hex[:8]}",
            user_id=user_id, tenant_id=tenant_id,
            model_id=f"agent:{agent_key}",          # 标记来源为智能体
            task_type=a_type,
            prompt=(goal or "")[:2000] or "智能体产物",
            parameters=json.dumps({"source": "agent", "run_id": run_id,
                                   "note": a.get("note")}, ensure_ascii=False),
            status="completed", progress=100,
            result_path=key,                         # MinIO key → 走 is_minio_key 取流
            show_in_gallery=1,
        ))
        n += 1
    return n


async def _settle_dangling_confirm_steps(db, run_id: str, final_status: str) -> None:
    """Run 落终态时，把仍 pending 的 confirm 占位步翻成对应终态，避免「Run 已完成、步骤仍 pending」。
    需与调用方共用同一 session（由调用方 commit）。"""
    fallback = "cancelled" if final_status in ("cancelled", "failed") else "completed"
    rows = (await db.execute(
        select(AgentStep).where(
            AgentStep.run_id == run_id,
            AgentStep.type == "confirm",
            AgentStep.status == "pending",
        )
    )).scalars().all()
    for s in rows:
        s.status = fallback


async def _write_step(run_id, step_counter, kind, plugin_name, tool_call_id,
                      input_data, output_data, *, error=None, cost=0, add_cost=0,
                      status=None) -> None:
    """写一条 AgentStep + 推进 progress（+可选累加 run.total_cost）。独立 session。"""
    step_counter["i"] += 1
    async with AsyncSessionLocal() as db:
        db.add(AgentStep(
            run_id=run_id, step_index=step_counter["i"], type=kind,
            plugin_name=plugin_name, tool_call_id=tool_call_id,
            input_data=input_data, output_data=output_data,
            status=status or ("failed" if error else "completed"),
            error_message=error, cost=cost,
        ))
        r = await _load_run(db, run_id)
        if r and r.status == "running":
            r.progress = min(90, 10 + step_counter["i"] * 25)
            if add_cost:
                r.total_cost = (r.total_cost or 0) + add_cost
        await db.commit()

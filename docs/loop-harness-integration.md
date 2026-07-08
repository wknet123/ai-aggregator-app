# Loop Harness 集成设计增补 —— 独立 Worker 服务 × LangGraph 状态图

> 本文档是 `custom-agent-skill-plugin-design.md` 的**执行层增补**，落实两项已确认的架构决策：
> 1. **独立 Harness 服务**：新增 Redis 队列 + 独立 worker 容器专跑 agent loop，FastAPI 仅投递任务。
> 2. **LangGraph 内核**：agentic loop 用 LangGraph `StateGraph` 承载，复用其 checkpointer（续跑）与 interrupt（人工确认）。
>
> ⚠️ 本方案**主动推翻**原文档三处基调，见 §7「对原文档的修订」。
>
> 定位：把原 §3.1 那段"手写在 orchestrator 里、靠 BackgroundTasks 跑"的主循环，升级为一个健壮、可续跑、可水平扩展的独立运行时（Loop Harness）。

---

## 1. 架构总览

```
┌─────────────────────────────────────────────────────────────────────┐
│  FastAPI (ai-aggregator-backend)  —— 投递端 + 查询端，不跑 loop        │
│    POST /api/v1/agents/runs                                           │
│      1) 建 AgentRun(status=pending) + agent_snapshot 落 MySQL         │
│      2) 预扣费校验(余额够不够起步)                                     │
│      3) arq.enqueue_job("run_agent", run_id)  → 立即返回 run_id       │
│    GET  /runs/{id}         查 MySQL（worker 写的 plan/steps/progress） │
│    POST /runs/{id}/confirm 写确认信号 → 唤醒被 interrupt 挂起的图      │
│    POST /runs/{id}/cancel  置 cancel 标志（worker 每步检查）           │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ enqueue (arq)                  │ resume 信号 (Redis pub/DB)
                ▼                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Redis  (新增容器)                                                     │
│    • arq 任务队列（run_agent / retry / cancel）                        │
│    • LangGraph AsyncRedisSaver checkpointer（图执行状态，thread=run_id）│
│    • confirm/cancel 信号通道                                           │
└───────────────┬───────────────────────────────────────────────────────┘
                │ 消费
                ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Harness Worker  (新增容器，复用 backend 镜像，command=arq worker)     │
│    LangGraph StateGraph 驱动 agentic loop：                            │
│      plan → route → tool_call → observe → (confirm_gate?) → ... → done │
│    • checkpointer 每节点后持久化图状态（续跑/中断恢复）                 │
│    • interrupt() 命中 confirm_mode → 挂起等 resume                     │
│    • 每步写 agent_steps / agent_runs (MySQL)                          │
│    • Artifact 落 MinIO；长任务 Plugin 复用 GenerationTask 轮询         │
│    • 调 integrations/gateway/client.py（复用）                        │
└───────────────┬────────────────────────┬──────────────────────────────┘
                ▼                         ▼
          MySQL (业务状态)          MinIO (产物)
```

**职责切分（关键）**：
- **FastAPI**：只做 CRUD、鉴权、投递、状态查询、确认/取消信号。**绝不在请求线程里跑 loop**。
- **Redis**：队列 + LangGraph checkpoint 后端 + 控制信号，三合一。
- **Worker**：唯一执行 agent loop 的地方，可起多副本水平扩展。
- **MySQL**：前端可见的业务真相（AgentRun/AgentStep/花费/产物引用）。
- **LangGraph checkpoint(Redis)**：图执行的**内部**状态，仅供续跑与 interrupt resume；与 MySQL 业务状态**双写、以 run_id/thread_id 关联**，MySQL 是对外唯一读源。

---

## 2. 选型决策

| 关注点 | 选型 | 理由 | 状态 |
|---|---|---|---|
| 队列/worker 框架 | **arq** | 纯 asyncio 原生、基于 Redis、轻量，与现有 async FastAPI/aiomysql/httpx 一致；Celery 对 async 支持弱且重，RQ 是同步 | 推荐（待确认可换 Celery） |
| loop 内核 | **LangGraph** `StateGraph` | 状态机/checkpointer(续跑)/interrupt(人工确认)开箱即用，正好覆盖 §3.2/§7.4 痛点 | 已定 |
| checkpointer 后端 | **AsyncRedisSaver**（`langgraph-checkpoint-redis`） | 复用已引入的 Redis，免自写 MySQL saver（LangGraph 官方无 MySQL saver） | 推荐 |
| 业务状态存储 | **MySQL**（AgentRun/AgentStep） | 前端轮询唯一读源，与 checkpoint 分工 | 已定 |
| worker 镜像 | **复用 backend 镜像**，`command` 换 `arq app.harness.worker.WorkerSettings` | 共享 models/gateway/plugins/storage 代码，零重复 | 已定 |
| LLM 调用 | 复用 `integrations/gateway/client.py`，用 LangGraph 的 `ChatOpenAI`(指向 gateway 兼容端点) 或自定义 `Runnable` 包 gateway | gateway 是 OpenAI 兼容则直接用 langchain-openai；否则薄封装 | 待确认 gateway 协议 |

---

## 3. LangGraph 图设计

### 3.1 State（图状态，随 checkpoint 持久化）

```python
class AgentState(TypedDict):
    run_id: str
    goal: str
    inputs: dict                 # 用户素材引用
    system_prompt: str           # persona + 合并 SKILL.instructions + 约束（启动时组装一次）
    allowed_plugins: list[str]   # 白名单（∩ SKILL.recommended）
    policy: dict                 # max_steps / budget_limit / confirm_mode
    messages: Annotated[list, add_messages]   # LLM 对话历史（工具调用+结果回喂）
    artifacts: list[dict]        # 累积产物引用
    step_index: int
    total_cost: int
    plan: dict | None            # 智能体当前规划（回写 agent_runs.plan）
```

### 3.2 节点与边

```
      ┌──────────┐
      │  plan    │  首个 LLM 推理，产出计划 → 写 agent_runs.plan
      └────┬─────┘
           ▼
      ┌──────────┐   route: LLM 返回是否有 tool_call？
      │  agent   │◄────────────────────────┐
      └────┬─────┘                          │ observe 回喂后继续
    tool?  │  no-tool & done                │
   ┌───────┴────────┐                       │
   ▼                ▼                        │
┌──────────┐   ┌──────────┐                 │
│confirm_  │   │ summarize│ 收尾→final_     │
│gate?     │   │          │ artifacts        │
└────┬─────┘   └────┬─────┘                 │
     │ interrupt()   ▼                        │
     │ 若命中 confirm_mode → 挂起等 resume    │
     ▼                                        │
┌──────────┐                                  │
│tool_call │ 白名单校验→参数校验(schema)→约束硬校验→扣费→执行 Plugin→落 MinIO
└────┬─────┘──────────────────────────────────┘
     │ observe: Artifact 结构化描述回喂 messages（必要时多模态回看）
     └─ 失败→退款+错误回喂→交回 agent 决策重试/换方案/放弃
```

- **`agent` 节点**：调 gateway LLM（带 allowed_plugins 的 function-calling tools）。
- **条件边 `route`**：有 tool_call → `confirm_gate`；LLM 声明完成/无 tool → `summarize`；超 `max_steps`/超 `budget_limit` → `summarize`(截断) 或 `interrupt`(询问加预算)。
- **`confirm_gate`**：依 `confirm_mode` 决定是否 `interrupt()`。`auto` 直通；`checkpoint` 仅关键节点(最终合成前/单步花费>阈值)挂起；`step` 每步挂起。
- **`tool_call`**：横切控制全在此——白名单、schema 校验、`constraints` 硬校验(aspect_ratio 强制/max_duration 截断)、`deduct` 扣费、执行 Plugin、`recharge` 退款。
- **续跑**：worker 崩溃/重启后，用同 `thread_id=run_id` 从 checkpointer 恢复图，从最后完成节点继续。
- **中断确认**：`interrupt(payload)` 挂起并把 payload(当前计划+待执行动作+已产出预览) 写 agent_runs；`POST /confirm` 用 `graph.ainvoke(Command(resume=用户决定), config={thread_id})` 恢复。

### 3.3 interrupt ↔ confirm_mode ↔ 现有状态机映射

| LangGraph | 设计语义(§3.2) | MySQL AgentRun.status |
|---|---|---|
| `interrupt()` 挂起 | 等待人工确认 | `awaiting_confirmation` |
| `Command(resume=continue)` | 确认继续 | `running` |
| `Command(resume=edit_params)` | 编辑参数后继续 | `running` |
| `Command(resume=skip)` | 跳过此步 | `running`（step=skipped） |
| `Command(resume=abort)` | 终止 | `cancelled` |

---

## 4. 部署与依赖变更

### 4.1 `deploy/docker-compose.yml`（新增 2 服务）

```yaml
  redis:
    image: redis:7-alpine
    container_name: ai-aggregator-redis
    restart: unless-stopped
    volumes: [ ./redis_data:/data ]
    command: redis-server --appendonly yes
    networks: [ ai-aggregator-network ]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s; timeout: 5s; retries: 5

  harness-worker:
    build: { context: ../backend, dockerfile: ../deploy/dockerfiles/Dockerfile.backend }
    container_name: ai-aggregator-harness-worker
    restart: unless-stopped
    command: arq app.harness.worker.WorkerSettings   # 复用 backend 镜像，换入口
    environment:
      # 与 backend 同一套 DATABASE_URL / MINIO_* / AI_GATEWAY_* ...
      REDIS_URL: redis://redis:6379/0
    depends_on:
      db: { condition: service_healthy }
      redis: { condition: service_healthy }
      minio: { condition: service_healthy }
    networks: [ ai-aggregator-network ]
    # 水平扩展：deploy.replicas 或 docker compose up --scale harness-worker=N
```

backend 服务 environment 补 `REDIS_URL: redis://redis:6379/0`，并 `depends_on: redis`。

### 4.2 `backend/requirements.txt`（新增）

```
langgraph==<pin>
langgraph-checkpoint-redis==<pin>
langchain-openai==<pin>        # 若 gateway 为 OpenAI 兼容；否则自写 Runnable 包 gateway
arq==<pin>
# redis==5.2.1 已存在
```

### 4.3 新增代码结构

```
backend/app/harness/
  __init__.py
  worker.py            # arq WorkerSettings + run_agent 任务入口（load Run→build graph→ainvoke）
  graph.py             # LangGraph StateGraph 定义（节点/边/State）
  nodes.py             # plan / agent / tool_call / confirm_gate / summarize 节点实现
  checkpoint.py        # AsyncRedisSaver 装配
  llm.py               # gateway → LangChain Runnable 适配（function-calling）
backend/app/plugins/   # （原设计）base/registry/image|video|audio —— worker 与 api 共用
backend/app/services/agent_orchestrator.py   # 瘦身为「装配图+投递」的 facade，真正执行在 worker
backend/app/api/v1/agents.py                  # 投递/查询/确认/取消（enqueue arq）
```

---

## 5. 执行时序（一次 Run）

```
1. 前端 POST /runs {agent_id, goal, inputs}
2. FastAPI：建 AgentRun(pending)+snapshot 落 MySQL；预扣费校验；arq enqueue run_agent(run_id)；返回 run_id
3. Worker 消费：load AgentRun+snapshot → 组装 system_prompt(SKILL 解析) → build graph(thread_id=run_id)
4. graph.ainvoke：plan→agent→(tool_call: 白名单/schema/约束/扣费/gateway/MinIO)→observe 回喂→循环
5. 命中 confirm_mode → interrupt() → 写 awaiting_confirmation → worker 该任务结束（状态在 checkpoint+MySQL）
6. 前端轮询 GET /runs/{id} 拿 plan/steps/progress/预览
7. 用户 POST /confirm → FastAPI enqueue resume 任务 → worker 用 Command(resume) 恢复图继续
8. summarize → final_artifacts 落 MySQL；status=completed；可选存画廊(GenerationTask.show_in_gallery)
```

崩溃恢复：worker 启动钩子扫描 MySQL `status in (running, planning)` 的 Run，对每个重新 enqueue resume（checkpointer 保证从断点续跑，不重复已完成步骤/不重复扣费——扣费前查 agent_steps 幂等）。

---

## 6. 计费 / 安全 / 幂等（worker 内落地）

- **扣费位置**：从原 BackgroundTasks 迁到 worker 的 `tool_call` 节点；调用前 `deduct`、失败 `recharge`，租户级，与现有 router 层约定一致。
- **续跑幂等**：每步扣费前检查 `agent_steps` 是否已有该 step_index 的 completed 记录，避免重启重复扣费。
- **白名单**：`allowed_plugins` 外的工具即使 LLM 幻觉也在 `tool_call` 节点拒绝。
- **预算/步数**：`budget_limit`/`max_steps` 在条件边检查，超限 `interrupt` 询问加预算或 `summarize` 截断。
- **内容安全**：透传 gateway `GatewayContentModerationError`，该步失败+退款+提示。
- **多租户**：worker 用 run 的 tenant_id/user_id 组织 MinIO key `users/{uid}/agents/{run_id}/...`。

---

## 7. 对原文档 `custom-agent-skill-plugin-design.md` 的修订

| 章节 | 原内容 | 需改为 |
|---|---|---|
| §1.3 非目标 | "不引入 Celery/独立队列（沿用 BackgroundTasks）" | **删除**；改为"引入 Redis+arq worker 独立 Harness 服务" |
| §3.1 执行主循环 | 手写 `while` 主循环伪码 | 改为 LangGraph StateGraph（本文 §3） |
| §7.3 执行机制 | BackgroundTasks + `background_tasks.add_task` | 改为 arq enqueue → worker 消费（本文 §5） |
| §7.4 已知限制 | "BackgroundTasks 进程内、重启中断" 列为限制 | **该限制被解决**（worker+checkpointer 续跑+水平扩展）；新增"运维复杂度↑：多一 Redis+worker 容器"作为新代价 |
| §6 数据模型 | agent_runs/agent_steps | 基本不变；checkpoint 存 Redis 不入业务表，仅 thread_id=run_id 关联 |
| §14 文件清单 | orchestrator 为执行核心 | 增 `app/harness/*`、arq worker、compose 加 redis+harness-worker、requirements 加 langgraph/arq |

---

## 8. 待确认技术点

> **§8-1 与 §8-4 已于 2026-07-07 实测核实**（直连 `neolink.com/api/v1` + `deepseek-v4-flash`）。

1. **gateway LLM 协议**：✅ **已核实为标准 OpenAI 兼容**。`/v1/chat/completions` + Bearer + `choices[0].message.content`；**function-calling 完整支持**（实测 `tools` + `tool_choice:auto` → 返回 `finish_reason:tool_calls` + 标准 `tool_calls` 数组）。→ `harness/llm.py` **直接** `ChatOpenAI(base_url, api_key, model=deepseek-v4-flash) + bind_tools`，LangGraph `ToolNode`/`tools_condition` 标准路径可用，**无需自写 Runnable**。
2. **队列框架**：arq（推荐）vs Celery。若团队已有 Celery 经验或需更丰富的重试/定时生态，可换 Celery（但 async 支持较弱）。
3. **checkpointer 后端**：Redis（推荐，复用）vs 自写 MySQL saver（多一份实现，但 checkpoint 与业务同库便于排障）。
4. **多模态看图决策**：⚠️ **已核实 `deepseek-v4-flash` 不支持视觉**（网关接受 `image_url` content 部分但模型忽略图像，实测回"未上传图片"）。→ **一期降级为"仅凭产物元数据/文本描述决策"**（智能体看不到生成图，只看 Artifact 的结构化描述）。若要真正"看图决策"，需在网关侧确认并切一个视觉模型（如 gpt-4o / qwen-vl 等，**待确认网关是否提供**）。
5. **worker 副本数与并发**：单 worker 内 arq 并发度 + 副本数如何配；是否需 Run 级租户限流（防单租户占满）。

---

## 9. 分期（在原 §12 路线图基础上前移基础设施）

| 期 | 范围 |
|---|---|
| **P0-a 地基** | Redis+harness-worker 容器起来；arq 跑通；LangGraph 最小图（plan→单 `image.generate`→summarize）端到端跑通一个 Run；MySQL 状态写入+前端轮询 |
| **P0-b 控制面** | checkpointer 续跑、interrupt↔confirm、扣费/退款/幂等、白名单/预算/max_steps、cancel |
| **P1** | 多 Plugin(image.*+video.*)、多 SKILL 合并、AgentStudio 前端、dry-run |
| **P2/P3** | 音频闭环、从成功 Run 沉淀 SKILL、Agent 市场（同原 §12） |

---

## 10. P0-a 落地记录（2026-07-07 DONE ✅）

**已实现并端到端验证通过**（生产 deploy 栈）：

- **依赖**：`langgraph==0.2.61`、`langchain-openai==0.2.14`、`arq==0.26.3`（镜像构建通过）
- **数据表**：`agent_runs` + `agent_steps`（`create_all` 自动建；Agent/Skill 表留 P1）
- **Plugin 层**：`app/plugins/{base,registry}` + `image/generate.py`（复用 `GatewayClient.generate_image` 落 MinIO）
- **Harness**：`app/harness/{llm,graph,executor,worker}` —— 手搓最小 `StateGraph`（agent⇄tools），`ChatOpenAI` 直连 gateway + `bind_tools`
- **API**：`POST /api/v1/agents/runs`（arq enqueue）、`GET /runs/{id}`、`GET /runs`、`GET /plugins`
- **部署**：`deploy/docker-compose.yml` 新增 `redis` + `harness-worker`（复用 `ai-aggregator-backend:local` 镜像，`command=arq app.harness.worker.WorkerSettings`），backend/worker 注入 `REDIS_URL`

**验证结果**：提交 goal「生成一张日落海滩图 16:9」→ worker 消费(36.4s) → LLM 自主调 `image_generate`(自动扩写 prompt) → 生图落 MinIO(1.88MB 有效 PNG) → 产物回喂 → LLM 出总结 → `status=completed / progress=100 / 2 steps / 1 artifact`。全链路活。

**P0-a 有意省略（留 P0-b）**：checkpointer 续跑、interrupt↔confirm、扣费/退款/幂等、白名单硬拒、多轮 artifacts 累加 reducer（当前单轮正确）、多模态看图（gateway 文本模型不支持，已知）。

---

## 11. P0-b 落地记录（2026-07-07 DONE ✅）

**已实现并端到端验证通过**（生产 deploy 栈）。范围：续跑 + 扣费/退款/幂等 + 取消 + 预算/步数。

- **checkpointer 续跑**：`langgraph-checkpoint-sqlite==2.0.11`（**须配 `aiosqlite==0.20.0`**——0.22 移除 Thread 基类致 saver `setup()` 调 `is_alive()` 失败）。**per-run** 检查点文件 `storage/agent_ckpt/{run_id}.sqlite`（避免跨 run 锁竞争）。`build_graph` 改返回未编译 builder，executor 用 `AsyncSqliteSaver` 编译 + `thread_id=run_id`。
- **续跑触发**：worker `on_startup` 扫描 MySQL `status=running` 的 Run → 重新入队 → `ainvoke(None, config)` 从检查点恢复（`status==running` 判定为 resume）。
- **扣费/退款/幂等**：graph 薄化——`tools_node` 委托 executor 的 `run_tool` 闭包：幂等(查 `agent_steps.tool_call_id` 已完成则复用产物) → 取消检查 → 预算/余额 → `CreditService.deduct` → 执行 Plugin → 失败 `recharge` 退款 → 记账累加 `total_cost`。`image.generate` cost=1（占位，待对齐 pricing）。
- **取消**：`POST /runs/{id}/cancel` 置 `cancelled`；`check_cancelled` 每步查库，命中抛 `GraphCancelled` 中止且不翻转 completed。
- **多轮 artifacts**：`AgentState.artifacts` 加 `operator.add` reducer（修正 P0-a 单轮覆盖）。
- **schema**：`agent_steps` 加 `tool_call_id`（`_COLUMN_MIGRATIONS` 幂等补列）。

**验证结果**：
- **T1 正常扣费**：余额 330→329（精确 -1），completed / cost=1 / 1 artifact / 2 steps。
- **T2 取消**：立即 cancel → 稳定 `cancelled`（等待后不翻转 completed），cost=0，余额不变（取消发生在首个 tool 执行前）。
- **T3 续跑幂等**：把已完成 run 的 status 改回 running 模拟崩溃 → 重启 worker → startup 扫描自动重入队 → 从检查点恢复（**8.48s** vs 首次 38.4s，未重新生图）→ completed，**余额不变、无重复扣费/重复 step**。

**P0-b 仍留白（→ P0-b-2 / P1）**：interrupt ↔ confirm_mode 人工确认（auto/checkpoint/step 挂起-恢复）；多 worker 并发下的 sqlite→共享 DB checkpointer（当前 per-run 文件对单/多 worker 均可，但检查点不集中）；白名单"硬拒+审计"细化（当前未知工具已软回喂错误）。

---

## 12. P0-b-2 落地记录（2026-07-08 DONE ✅）

**已实现并端到端验证通过**（生产 deploy 栈）。范围：interrupt ↔ confirm_mode 人工确认。

- **schema**：`agent_runs` 加三列（`_COLUMN_MIGRATIONS` 幂等补列）：`confirm_mode`(auto/checkpoint/step)、`pending_confirmation`(JSON，挂起时待确认 payload)、`confirm_decision`(JSON，用户决定，worker 恢复时消费后清空)。
- **graph（`graph.py`）**：新增 `confirm_gate` 节点，插在 `agent → confirm_gate → tools` 之间。命中确认时调 `interrupt(payload)` 挂起；恢复后按 `decision.action` 分流：`continue`(直通 tools) / `edit`(用 `edited_args` 覆盖 tool_calls 参数、同 id 替换 AIMessage → tools) / `skip`(回喂 skipped ToolMessage → 回 agent) / `abort`(抛 GraphCancelled)。**interrupt() 之前保持纯函数**（无副作用），保证节点重跑幂等；`record_skip` 在其后仅恢复时执行一次。新增条件边 `route_after_gate`（skip 路径回 agent，其余去 tools）。
- **executor（`executor.py`）**：三种入口——`fresh`(init_state) / `confirm_resume`(`Command(resume=decision)`) / `crash_resume`(`None`)，凭 `confirm_decision` 是否存在区分 confirm vs 崩溃续跑。`ainvoke` 后用 `graph.aget_state(config)` 检测挂起（`任一 task.interrupts` 非空——**0.2.61 的 `ainvoke` 返回值不含 `__interrupt__`**，须走 get_state），命中则置 `awaiting_confirmation` + 落 `pending_confirmation` + 记一条 `confirm` step 后结束任务。`confirm_payload` 闭包依 `confirm_mode` 决定是否挂起（step=每步；checkpoint=单步 cost≥`confirm_cost_threshold`(默认1)；auto=不挂）。`GraphCancelled` 处理补上 abort 场景的 `→ cancelled` 翻转。step_counter 从已有 max(step_index) 续号避免跨 invocation 冲突。
- **API（`agents.py`）**：`POST /runs/{id}/confirm`（body: `action` + 可选 `edited_args`/`reason`）→ 落 `confirm_decision` + 置 `running` + arq 重新入队；入队失败回滚 `awaiting_confirmation`。`CreateRunBody` 加 `confirm_mode`；`_run_to_dict` 暴露 `confirm_mode`+`pending_confirmation`。
- **recursion_limit** 提到 `max_steps*4+6`（confirm_gate 加节点 + 跨 resume 累计）。

**验证结果**（起始余额 329，终 326，精确对账）：
- **T-auto**：confirm_mode=auto → 不挂起直接 completed / cost=1（回归 P0-a/P0-b 行为不变）。
- **T-step-continue**：step 模式挂起(`awaiting_confirmation` + pending_confirmation 含 tool_call_id/args/cost) → confirm continue → completed / cost=1（**恢复无重复扣费**，精确 -1）。
- **T-step-abort**：挂起 → abort → `cancelled` / cost=0。
- **T-step-edit**：挂起 → edit 换 prompt/aspect → 执行 step 入参确为用户覆盖值（`EDITED_BY_USER…` / 1:1）/ 扣 1；step 模式下后续动作再次挂起（符合"每步确认"语义）。
- **T-step-skip**：挂起 → skip → 记 `tool_call` step status=`skipped`/cost=0 → LLM 收尾 completed / 总 cost=0。
- **T-checkpoint**：checkpoint 模式(cost1≥阈值1) 同样挂起 → abort 收尾。三模式路由均通。

**P0-b-2 仍留白（→ P1）**：`confirm` trace step 恢复后仍显示 `pending`（纯展示，pending_confirmation 已清为权威信号）；"最终合成前"挂起点未单独建模（无独立 summary 节点，checkpoint 仅按单步 cost 阈值触发）；多 worker 共享 DB checkpointer；白名单硬拒+审计；Agent/Skill 定义表 + AgentStudio 前端。

---

## 13. P1-a 落地记录（2026-07-08 DONE ✅）—— Custom Agent 定义层

**已实现并端到端验证通过**（生产 deploy 栈）。范围：把写死的 `DEFAULT_AGENT` 常量升级为**库内可 CRUD 的 Agent + Skill 定义**，executor 从库加载 + 快照，加多 SKILL 合并与 dry-run。视频 Plugin/计费对齐/前端为后续 P1-b/P1-c（视频定「同步轮询+拉高 job_timeout」）。

- **数据模型**：新增 `agents` / `skills` 表（`models/agent.py`，`models/__init__.py` 导出）；`agent_runs` 加 `agent_snapshot`(JSON)（`_COLUMN_MIGRATIONS` 补列）。`agent_key` 复用为 agent 标识（"default" 或 agent_id uuid）。
- **`harness/agent_config.py`（新）**：`DEFAULT_AGENT` 常量（从 executor 迁入，兜底）；`merge_skills(agent, skills)` 合并——persona 拼各 Skill `## 技能：{name}\n{instructions}` 小标题 + 推荐工具(∪recommended ∩ allowed) + 软约束(默认比例/禁词/时长)注入 prompt，allowed_plugins 为硬白名单；`load_runtime(db, agent_key, tenant_id)` 按 key 查 Agent+有序 Skill 合并，查不到且 key=default → 常量兜底；`plan_only(runtime, goal)` dry-run 只 LLM 规划一次返回拟调用工具(含 cost)，不执行/不扣费。
- **executor**：6 处 `DEFAULT_AGENT` 引用改为——fresh 入口 `load_runtime` 并落 `run.agent_snapshot`；confirm_resume/crash_resume 入口**读快照**（防定义漂移/续跑一致）。persona/allowed/policy 全取自 runtime。
- **API（`agents.py`）**：Agent CRUD（`GET /`、`POST /`、`GET/PUT/DELETE /{agent_id}`）、Skill CRUD（`/skills`、`/skills/{id}` PUT 版本自增/DELETE 软删）、`POST /dry-run`。`CreateRunBody.confirm_mode` 改 Optional，未传时取 agent.policy.confirm_mode。`create_run` 用 `load_runtime` 校验 agent_key 可访问。**路由顺序**：`/{agent_id}` 动态段注册在文件末尾（在 `/plugins`、`/runs`、`/skills`、`/dry-run` 之后），避免捕获冲突。
- **播种**：`main.py` lifespan 迁移后幂等播种 system `default` agent（镜像 DEFAULT_AGENT）+ 示例 system skill「电商带货分镜法」。

**验证结果**（余额起 326，全程精确对账）：
- **路由**：`/plugins`、`/runs`、`/skills`、`/{agent_id}` 各命中正确 handler，无 `plugins`/`runs` 被当 agent_id 捕获。
- **CRUD**：建 skill→建 agent(引用 skill)→GET/列表/PUT/DELETE 全通；软删后列表仅剩 system default。
- **多SKILL合并 + Run**：自定义 agent Run completed / cost 1；`agent_snapshot.persona` 确含「自定义 persona + `## 技能：赛博朋克风` + 推荐工具提示」。
- **快照隔离**：PUT 改 persona 后，旧 completed run 快照仍为 V1（冻结）；新 run 用 V2 persona。
- **confirm 集成**：agent policy `confirm_mode=step` → 新 run 自动挂起 `awaiting_confirmation`（P0-b-2 与库加载 agent 无缝）。
- **dry-run**：返回 planned_tool_calls(含 cost) + plan_text，**不建 Run、余额不变**（326→326，run 数不增）。
- **回归**：`agent_key=default` Run 照常 completed（库播种 + 常量兜底两路径均通）。

**P1 仍留白（→ P1-b / P1-c）**：视频 Plugin（video.image_to_video/text_to_video，同步轮询 + `job_timeout` 拉高）；Plugin.cost 对齐 `/pricing`(40/80/150/120)；硬约束在 tool_call 节点强制(aspect_ratio/max_duration)；`agent_steps.generation_task_id` 长任务复用；AgentStudio 前端（agent 列表/编辑、Skill 编辑器、Run+confirm 交互、dry-run 面板）。

---

## 14. P1-b 落地记录（2026-07-08 DONE ✅）—— 视频 Plugin + 计费对齐 + 约束硬校验

**已实现并端到端验证通过**（生产 deploy 栈，真实 gateway 出片）。视频走用户拍板的**简单版**：`execute()` 内同步轮询 + 拉高 `job_timeout`（不引 submit/poll 基建）。引擎选 **Seedance**（`seedance_create`/`seedance_poll`，drama 生产已验证），首帧以**原始 bytes** 传入 → gateway `_as_data_url` base64 内联（gateway 访问不到 MinIO，无需 PUBLIC_BASE_URL/新端点）。

- **计费单一真源 `core/pricing.py`（新）**：`pricing_table()`(供 `/pricing`，新增 Seedance 150) + `PLUGIN_COST`/`plugin_cost(name)`。`models.py /pricing` 与 `image/generate.py cost()` 均改为引用之（image 1→40）。
- **视频 Plugin `plugins/video/`（新）**：`_common.run_seedance`（create→轮询 `is_done`/`is_failed`，interval 8s × ≤180→`fetch_bytes`→`agent_artifact_key(*.mp4)`→`upload_bytes video/mp4`，artifact `{type:video,key,aspect_ratio,duration,note}`）。`text_to_video`（prompt+ratio+duration）、`image_to_video`（+`image_key` 读 `storage.get_object_bytes`→bytes 首帧）。均 `is_long_running=True`、cost 150。`registry.load_builtin_plugins` 注册。
- **worker**：`job_timeout` 600→1800（容纳 ~20min 轮询）。局限：轮询期不检查 cancel（in-flight 视频不可中途取消）。
- **DEFAULT_AGENT**：`allowed_plugins` 加两视频 plugin；`budget_limit` 100→500（真实价 image40/video150）；persona 补视频引导。`main.py` 播种改**幂等 upsert**（default agent 已存在则同步 persona/allowed_plugins/policy，使常量变更随重启传播）。
- **约束硬校验 `executor._enforce_constraints`**：run_tool 执行前按 `runtime.constraints` 强制 `aspect_ratio`/`ratio`、截断 `duration`（仅当 plugin schema 声明该参数），覆盖值写入 step.input_data。

**验证结果**（tenant1 充值到 ~2300 覆盖测试）：
- `/pricing` 含 image40/80、video Hailuo150/HappyHorse120/Seedance150；`/agents/plugins` 列 image.generate + video.text_to_video + video.image_to_video。
- **image cost 对齐**：图 Run cost=40（不再 1）。
- **text_to_video**：真实 gateway → completed，产物 mp4 落 MinIO **3.5MB**，Run cost=150，余额精确 -190(40图+150视频)。
- **image_to_video**：容器内直调 plugin（取上一步 image 产物 key）→ 生成 **5.4MB** mp4，bytes 首帧内联路径通，cost()=150。
- **约束硬校验**：skill `aspect_ratio=9:16` + persona/goal 均倾向 16:9 → 执行 step 入参全被强制 9:16。
- **预算拒绝**：agent budget_limit=50 跑视频(150) → `超出预算上限（50）`，cost=0、余额不变、不出片。
- **dry-run**：视频目标 → planned `video_text_to_video` cost=150，不建 Run/不扣费。
- **回归**：default agent 图 Run 照常 completed。

**P1 仍留白（→ P1-c）**：AgentStudio 前端（agent 列表/编辑、Skill 编辑器、Run+confirm 交互、dry-run 面板）；可选：`agent_steps.generation_task_id` 长任务复用 GenerationTask、轮询期 cancel、更多引擎(Hailuo/HappyHorse)与按参数分级计费(pro/时长)、参考视频/音频(需公网 URL 端点)。

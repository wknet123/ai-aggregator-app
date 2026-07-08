# AI Aggregator Platform

多租户 AI 内容生产 SaaS 平台 —— 一个网关聚合文本 / 图像 / 视频生成，配套短剧生产线（OmniWeaver）与可编排的自定义智能体（AI Agent Studio）。

后端 **FastAPI (Python 3.12)**，前端 **React 19 + TypeScript + Vite**，对象存储 **MinIO**，任务队列 **Redis + arq**，智能体内核 **LangGraph**。

---

## ✨ 核心特色

- 🧩 **统一 AI 网关聚合** —— 文本 / 图像 / 视频全部走一个 OpenAI 兼容网关（`deepseek-v4-flash` 文本、`wan` 图像、`seedance / hailuo / happyhorse` 视频），一套凭据、一处切换模型。
- 🎬 **OmniWeaver 短剧生产线** —— 以剧本为主线：剧本创作 → 时间段分镜 → 参考图/角色一致性 → 逐镜视频合成 → 成片。适配 Seedance 2.0 的「图 N / 视频 1 / 音频 1」素材编排，支持项目/多集管理与素材库。
- 🤖 **AI Agent Studio（自定义智能体）** —— 智能体 = **技能（SKILL）× 插件（Plugin）**。可视化编排智能体与技能、发起运行、**人工确认**（继续/改参/跳过/终止）、**dry-run 预估花费**、实时观察步骤与产物。执行层是独立 worker + LangGraph 状态图，支持断点续跑、扣费幂等、白名单/预算/步数硬约束。
- 🏢 **多租户架构** —— `X-Tenant-ID` 贯穿请求，租户级隔离数据、积分与任务。
- 💳 **积分 + 支付** —— 内置积分计费（图 40 / 视频 150 等，单一定价源）、交易流水、支付宝充值。
- 🗄️ **MinIO 对象存储** —— 生成物统一入桶，经后端鉴权流式下发（不暴露 MinIO 直链）。
- 🔐 **JWT 认证** —— access / refresh 双令牌，前端 401 静默刷新。
- 📱 **抖音发布** —— OAuth 授权 + 视频直发。

## 🖥️ 功能页面

| 页面 | 路由 | 说明 |
|---|---|---|
| 作品画廊 / 发现 | `/gallery` `/discover` | 生成物管理与探索 |
| AI 图片 / 视频 / 3D | `/image-generation` `/video-generation` | 单点生成工作台 |
| AI 短视频 / 特效 / 动作模仿 / 视频改视频 / 视频编辑 | `/short-video` `/ai-effects` `/motion-imitation` `/video-to-video` `/video-edit` | 各类视频能力 |
| **OmniWeaver** | `/omni-weaver` | 短剧剧本 → 分镜 → 成片生产线 |
| **智能体工作室** | `/agent-studio` | 自定义智能体编排 / 运行 / 确认 / dry-run |
| 积分 / 充值 / 定价 / 设置 | `/credits` `/recharge` `/pricing` `/settings` | 账户与计费 |

---

## 🏗️ 架构

```
                 ┌────────────── React 19 + Vite (Nginx) ──────────────┐
                 │  pages / components / services(axios) / Zustand      │
                 └───────────────────────┬─────────────────────────────┘
                                         │ /api/v1/*  (JWT + X-Tenant-ID)
┌────────────────────────────────────────▼────────────────────────────┐
│ FastAPI backend                                                       │
│   API routers → services → repositories → SQLAlchemy(async) → MySQL   │
│   integrations/{openai,google,flux,gateway,douyin,alipay}             │
│                                                                       │
│   AI Agent Studio 定义层：agents / skills CRUD、dry-run               │
└───────────────┬───────────────────────────────┬──────────────────────┘
                │ enqueue (arq)                  │ 生成物
        ┌───────▼────────┐              ┌────────▼─────────┐
        │ Redis 队列      │              │ MinIO 对象存储    │
        └───────┬────────┘              └──────────────────┘
        ┌───────▼───────────────────────────────┐
        │ harness-worker (独立容器)               │
        │   LangGraph StateGraph:                │
        │   plan → agent → confirm_gate → tools  │
        │   checkpoint(sqlite) 续跑 / 扣费幂等    │
        └────────────────────────────────────────┘
```

**Docker 服务与端口**

| 容器 | 端口 | 说明 |
|---|---|---|
| `db` (MySQL 8) | 3306 | 主数据库 |
| `minio` | 9000 / 9001 | 对象存储 API / 控制台 |
| `redis` | 6379 | 智能体任务队列 + checkpoint |
| `backend` (FastAPI) | 8000 | API 服务 |
| `harness-worker` | — | 智能体执行 worker（arq） |
| `frontend` (Nginx) | 3000 → 80 | 前端 + API 反代 |

## 🧰 技术栈

**后端**：FastAPI · SQLAlchemy 2 (async) · aiomysql · **LangGraph 0.2** · **arq (Redis)** · MinIO SDK · httpx · Pydantic Settings · python-jose (JWT)

**前端**：React 19 · TypeScript · Vite 7 · Tailwind CSS 4 · Zustand · React Router · axios · lucide-react

**基础设施**：MySQL 8 · Redis 7 · MinIO · Docker Compose · Nginx

---

## 🚀 快速开始（Docker，推荐）

前置：Docker Engine 20.10+ / Docker Compose 2.0+。

```bash
cd deploy

# 1) 配置环境变量（务必填入真实密钥）
cp .env.example .env
#   至少设置：DB_*、SECRET_KEY、AI_GATEWAY_API_KEY
#   支付宝 / 抖音 / 各 AI 直连 key 视需要填写

# 2) 一键启动全部服务（首次会构建镜像）
docker compose up -d --build

# 3) 查看日志
docker compose logs -f backend
```

启动后：

- 前端：<http://localhost:3000>
- 后端 API：<http://localhost:8000>
- API 文档（Swagger）：<http://localhost:8000/api/docs>
- MinIO 控制台：<http://localhost:9001>

常用运维：

```bash
docker compose up -d --build backend    # 仅重建后端
docker compose up -d --build frontend   # 仅重建前端
docker compose restart harness-worker   # 重启智能体 worker
docker compose down                      # 停止全部
```

## 🛠️ 本地开发（不走 Docker）

需自备 MySQL 8、Redis、MinIO（或用 compose 只起这三个依赖）。

**后端**

> 环境变量已统一到 `deploy/.env`（唯一实效来源，模板见 `deploy/.env.example`）。
> 本地不走 Docker 时，backend 需要一份指向 localhost 的 `backend/.env`（已被 `.gitignore` 忽略）。
> 键的含义参照 `deploy/.env.example`，下方给出可直接粘贴的最小配置：

```bash
cd backend
python -m venv .venv && source .venv/bin/activate   # Windows: .venv\Scripts\activate
pip install -r requirements.txt

# 手写一份本地 .env（指向本机依赖；密码里的 @ 需 URL 编码为 %40）
cat > .env <<'EOF'
DATABASE_URL="mysql+aiomysql://ai_user:Ai%40User2024@localhost:3306/ai_aggregator"
REDIS_URL=redis://localhost:6379/0
SECRET_KEY=dev-secret-change-me-min-32-chars
AI_GATEWAY_BASE_URL=https://neolink.com/api/v1
AI_GATEWAY_API_KEY=your-ai-gateway-api-key
MINIO_ENDPOINT=localhost:9000
MINIO_ACCESS_KEY=minioadmin
MINIO_SECRET_KEY=minioadmin
MINIO_BUCKET=ai-aggregator
# 如需本地联调支付宝 / 抖音，再从 deploy/.env(.example) 补 ALIPAY_* / DOUYIN_*
EOF

uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # 启动即自动建表

# 另开一个终端启动智能体执行 worker
arq app.harness.worker.WorkerSettings
```

> 数据表在应用启动时自动创建（`Base.metadata.create_all`，仅建缺失表、不改已有表）；Docker 首次启动还会执行 `deploy/init-scripts/init.sql`。

> 注意：`DATABASE_URL` 中密码里的特殊字符需 URL 编码（`@` → `%40`）。

**前端**

```bash
cd frontend
npm install
npm run dev                  # http://localhost:3000（/api 已代理到 localhost:8000）
npm run build                # 生产构建（tsc + vite）
```

> 前端无需单独的 `.env`：dev 服务器已将 `/api` 反代到 `localhost:8000`。
> 如需指向其它后端，临时设置环境变量即可：`VITE_API_URL=http://host:port npm run dev`。
> Docker 构建时 `VITE_API_URL` 由 `deploy/.env` 经 build-arg 注入。

---

## 📡 主要 API（前缀 `/api/v1`）

| 分组 | 前缀 | 说明 |
|---|---|---|
| 认证 | `/auth` | 注册 / 登录 / 刷新令牌 |
| 用户 / 租户 | `/users` `/tenants` | 账户与多租户 |
| 积分 / 支付 | `/credits` `/payment` | 余额 / 流水 / 支付宝充值 |
| 模型 / 定价 | `/models` | 可用模型与定价表 |
| 图像 | `/openai` `/flux` `/google` | 生图（GPT-Image / Flux Kontext / Imagen） |
| 视频 | `/google` `/studio` `/render/pipeline` | 生视频 / 媒体工作台 / 渲染流水线 |
| 短剧 | `/drama` `/drama/projects` | OmniWeaver 大纲 / 分镜 / 项目 CRUD |
| 角色素材 | `/characters` `/ai-characters` `/project-assets` | 角色库与项目素材 |
| **智能体** | `/agents` | 智能体 / 技能 CRUD、Run 投递/轮询/取消/**确认**、**dry-run**、产物取流 |
| 存储 / 静态 | `/storage` `/static` | 文件流式下发 |
| 抖音 | `/douyin` | OAuth 与视频发布 |

完整交互式文档见 `/api/docs`（Swagger）与 `/api/redoc`。

## 🤖 AI Agent Studio 用法速览

1. 进入 **智能体工作室**（`/agent-studio`）。
2. 在「技能」页创建技能（SKILL）：填写方法论 instructions、推荐插件、约束（如画幅 `9:16`、最大时长）。
3. 在「智能体」页创建智能体：选技能 + 允许的插件（`image.generate` / `video.text_to_video` / `video.image_to_video`）+ 策略（最大步数 / 预算 / 确认模式）。
4. 「预估（dry-run）」：不建 Run、不扣费，先看智能体会调哪些工具、预估花费。
5. 「运行」：发起 Run。若确认模式为「逐步 / 检查点」，命中时会挂起等待你 **继续 / 改参 / 跳过 / 终止**；完成后在产物区预览生成的图片 / 视频。

> 执行层为独立 worker：崩溃/重启可从 checkpoint 续跑，续跑不重复扣费；`allowed_plugins` 外的调用即使被模型幻觉也会被硬拒。

---

## 🔒 提交约定与安全

- 环境变量统一到 `deploy/.env`（唯一实效来源，已被 `.gitignore` 忽略）；仓库仅提交模板 `deploy/.env.example`（占位符）。backend/frontend 目录不再各自维护 `.env`。
  本地非 Docker 开发时按上文自建 `backend/.env`（同样被忽略）。
- Docker 运行时数据目录（`deploy/mysql_data` `deploy/minio_data` `deploy/redis_data` `deploy/storage` `backend/storage`）、`node_modules`、构建产物、`__pycache__`、TLS 证书 `*.pem`、备份目录（`*.bak-*`）均不入库。
- 切勿将真实 `SECRET_KEY`、数据库密码、AI 网关 token、支付宝私钥提交到仓库。

## 📄 License

MIT

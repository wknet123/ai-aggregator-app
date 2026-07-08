# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Multi-tenant SaaS platform for AI content generation. Integrates OpenAI, Google (Gemini/Imagen/Veo), Flux, Replicate, and Douyin, plus a unified OpenAI-compatible **AI gateway** (`neolink.com/api/v1`) that fronts text/image/video models. Backend is FastAPI (Python 3.12+), frontend is React 19 + TypeScript + Vite. Two flagship subsystems sit on top: **OmniWeaver** (script→storyboard→video drama pipeline) and **AI Agent Studio** (custom agents = SKILL × Plugin, executed by a LangGraph-based Loop Harness worker).

## Development Commands

### Docker (production-like, from deploy/)
```bash
cd deploy
docker compose up -d --build backend    # rebuild + restart backend only
docker compose up -d --build frontend   # rebuild + restart frontend only
docker compose up -d                    # start all services
docker compose logs -f backend          # tail backend logs
```

### Backend (local dev)
```bash
cd backend
pip install -r requirements.txt
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000   # tables auto-created on startup
arq app.harness.worker.WorkerSettings                       # Agent Studio execution worker (separate process)
```
Schema is created at startup via `Base.metadata.create_all` (creates missing tables only; never alters existing ones). There is **no Alembic**; ad-hoc column additions are handled by `_COLUMN_MIGRATIONS` in `main.py`. Docker first-run also applies `deploy/init-scripts/init.sql`.

### Frontend (local dev)
```bash
cd frontend
npm install
npm run dev       # vite dev server (port 3000)
npm run build     # tsc && vite build
npm run lint      # eslint
```

## Architecture

### Backend Layers
```
API routers (backend/app/api/v1/)
  → Services (backend/app/services/)
    → Repositories (backend/app/repositories/)
      → SQLAlchemy models (backend/app/models/) → MySQL
  → Integration clients (backend/app/integrations/{openai,google,flux,gateway,douyin,alipay}/client.py)
    → External AI APIs / unified gateway
  → Agent Studio: definition layer in api/v1/agents.py; execution in harness/ (arq worker + LangGraph)
```

All routers are registered in `backend/app/main.py`. Config is in `backend/app/config.py` (Pydantic Settings, reads env vars). Auth dependency: `backend/app/dependencies.py` → `get_current_user`. Pricing single-source: `backend/app/core/pricing.py`.

### Frontend Structure
```
frontend/src/
  pages/          # route components (AIWorkbench, OmniWeaverPro, AgentStudio, Gallery, etc.)
  components/     # layout/, drama/, model/, agent/ component groups
  services/       # axios API clients (one per backend integration)
  store/          # Zustand stores (auth, credit, tenant)
  App.tsx         # React Router config
```

API base client is `frontend/src/services/api.ts` (axios with JWT interceptor, auto-logout on 401).

### Services & Ports (Docker)
| Container | Port | Internal hostname | Role |
|-----------|------|-------------------|------|
| MySQL 8 | 3306 | db | primary database |
| MinIO | 9000 (API), 9001 (console) | minio | object storage |
| Redis 7 | 6379 | redis | Agent Studio task queue (arq) + checkpoints |
| Backend | 8000 | backend | FastAPI API |
| harness-worker | — | harness-worker | Agent Studio executor (`arq app.harness.worker.WorkerSettings`, reuses backend image) |
| Frontend | 80 (prod) / 3000 (dev) | frontend | React app + nginx API proxy |

### Storage (MinIO)
- All generated files stored in MinIO bucket `ai-aggregator`
- Object keys: `users/{uid}/images/`, `users/{uid}/videos/`, `users/{uid}/drama/{project_id}/`, `users/{uid}/agents/{run_id}/`
- `result_path` in DB = MinIO object key; files served by streaming through backend
- **Never** use `RedirectResponse` to presigned MinIO URLs — browsers can't resolve `minio:9000`
- Storage service: `backend/app/services/storage.py` (upload, stream, presign)
- Key detection: `StorageService.is_minio_key(path)` checks prefixes `users/`, `public/`, `shared/`

### Multi-Tenancy
Request flow: `X-Tenant-ID` header → `TenantContextMiddleware` → tenant-scoped queries. Users belong to tenants; credits and tasks are tenant-scoped.

### AI Drama Pipeline (OmniWeaver)
Script-first drama production in `frontend/src/pages/OmniWeaverPro.tsx` (project list → project = a series with episodes → per episode: script → time-segment storyboard → per-shot generation → composite):
1. 剧本创作 → outline / parse-script (`/api/v1/drama/outline`, `/api/v1/drama/parse-script`)
2. 分镜规划 → storyboard + per-shot prompt (`/api/v1/drama/storyboard`, `/api/v1/drama/compose-shot-prompt`)
3. 逐镜生成 → video via unified gateway/Seedance (`/api/v1/drama/generate-shot-video`, or `/api/v1/render/pipeline` for batch)
4. 成片合成 → composite (`/api/v1/render/pipeline/{id}/composite`)

Each shot's hard prerequisites: ordered reference images (character/ref, ≥1) + time-segment beats; optional single reference video/audio. Adapted to Seedance 2.0's "image N / video 1 / audio 1" material mapping.
Storyboard editor: `frontend/src/components/drama/ShotStoryboardEditor.tsx`
Asset config / library: `frontend/src/components/drama/{AssetConfigPanel,AssetPickerModal,AICharacterLibraryModal}.tsx`
Drama endpoints: `backend/app/api/v1/drama.py`; project CRUD: `backend/app/api/v1/drama_projects.py`; render pipeline: `backend/app/api/v1/render_pipeline.py`

### AI Agent Studio & Loop Harness
Custom agents = **SKILL × Plugin**, executed off the request path by an independent worker.
- **Definition layer** (`backend/app/api/v1/agents.py`): `agents`/`skills` CRUD, plugin catalog, run submit/poll/cancel/**confirm**, **dry-run**, authenticated artifact streaming. Frontend: `frontend/src/pages/AgentStudio.tsx` + `frontend/src/components/agent/{AgentEditor,SkillEditor,RunDetail}.tsx`, service `frontend/src/services/agent.service.ts`.
- **Execution layer** (`backend/app/harness/`): FastAPI enqueues a run (arq→Redis); `harness-worker` builds a LangGraph `StateGraph` (`plan → agent → confirm_gate → tools`), streams to MySQL (`agent_runs`/`agent_steps`, the frontend's poll source). Checkpoints go to per-run SQLite (`backend/storage/agent_ckpt/{run_id}.sqlite`) for crash-resume.
- **LLM brain** goes through `langchain-openai` (gateway is OpenAI-compatible, function-calling supported, no vision). **Plugins** (`backend/app/plugins/`: `image.generate`, `video.text_to_video`, `video.image_to_video`) call the gateway directly and write artifacts to MinIO under `users/{uid}/agents/{run_id}/`.
- Safety/billing in the tool node: `allowed_plugins` whitelist (hard-reject), budget/max_steps, per-`tool_call_id` idempotent deduct/refund (resume never double-charges), constraint enforcement (aspect_ratio/max_duration). Costs come from a single source: `backend/app/core/pricing.py`.
- confirm_mode: `auto` (never pause) / `checkpoint` (pause when a step's cost ≥ threshold) / `step` (pause every step). Pause = LangGraph `interrupt()`; run goes `awaiting_confirmation`; user resumes via `/runs/{id}/confirm` with `continue`/`edit`/`skip`/`abort`.

Design docs: `docs/loop-harness-integration.md`, `docs/custom-agent-skill-plugin-design.md`.

## Key Conventions

- Env config is consolidated into a single `deploy/.env` (template `deploy/.env.example`). docker-compose uses it for variable substitution and `backend`/`harness-worker` load it via `env_file:`; the `environment:` block still overrides container-internal topology (`DATABASE_URL`/`REDIS_URL`/`MINIO_ENDPOINT`). No separate `.env` under `backend/` or `frontend/` (frontend `VITE_API_URL` comes from a build-arg). `.dockerignore` keeps any local `.env` out of images. For non-Docker backend dev, hand-write `backend/.env` pointing at localhost (see root README).
- DB password contains `@` — must be URL-encoded (`%40`) in `DATABASE_URL`
- Backend async throughout: async SQLAlchemy, httpx for external calls, uvicorn
- Frontend styling: Tailwind CSS 4 utility classes, dark theme (`bg-[#0d0d15]` etc.)
- Icons: `lucide-react`
- State management: Zustand (not Redux)
- API docs available at `/api/docs` (Swagger) and `/api/redoc`

## Core Data Models (backend/app/models/)

| Domain | Tables |
|--------|--------|
| Tenancy & auth | `tenants`, `users`, `api_keys` |
| Billing | `credits`, `transactions`, `credit_packages`, `payment_orders` |
| Generation | `generation_tasks`, `model_usages` |
| Drama / assets | `drama_projects`, `render_pipelines`, `project_assets`(+`project_asset_images`), `characters`(+`character_images`), `ai_characters`(+`ai_character_categories`,`ai_character_images`) |
| Workflows | `workflow_instances`, `workflow_steps` |
| Agent Studio | `agents`, `skills`, `agent_runs`, `agent_steps` |
| Integrations | `douyin_accounts` |

Note: `generation_tasks.result_path` holds the MinIO object key; `agent_runs` carries `agent_snapshot` (frozen definition for consistent resume), `confirm_mode`, `pending_confirmation`, `final_artifacts`, `total_cost`.

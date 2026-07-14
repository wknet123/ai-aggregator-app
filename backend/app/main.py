"""
FastAPI Application Entry Point
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.staticfiles import StaticFiles
from contextlib import asynccontextmanager
from pathlib import Path

from app.config import settings
from app.api.v1 import auth, users, tenants, credits, models, openai, google, flux, workflows, payment, douyin, suggestions, storage, drama, drama_projects, static_media, characters, render_pipeline, media_studio, project_assets, ai_characters, agents, admin_gateway
from app.middleware.tenant_context import TenantContextMiddleware
from app.middleware.logging import LoggingMiddleware
from app.middleware.error_handler import error_handler_middleware
from app.db.session import engine
from app.db.base import Base


# Additive, idempotent column migrations keyed by table name (MySQL 8).
# Run after Base.metadata.create_all to bring pre-existing tables up to date.
_COLUMN_MIGRATIONS = {
    "drama_projects": {
        "script_text": "TEXT NULL",
        "source_mode": "VARCHAR(20) DEFAULT 'concept'",
        "style_lock": "VARCHAR(20) NULL",
        "final_video_path": "VARCHAR(500) NULL",
        "episodes_data": "TEXT NULL",
        "archived_at": "DATETIME NULL",
    },
    "generation_tasks": {
        # 收藏标记 (0=否, 1=是)。模型自始有此列，但早期库可能未建，补齐。
        "is_favorite": "INT NOT NULL DEFAULT 0",
        # 公开标记 (0=私有, 1=公开)。模型有此列但缺对应迁移，旧库缺列导致查询/写入 1054。
        "is_public": "INT NOT NULL DEFAULT 0",
        # 作品展示标记：1=作为作品展示(作品画廊/AI图片/AI视频)，0=中间过程产物/上传素材。
        # 默认 1 让历史既有数据保持可见；中间产物在写库时显式置 0。
        "show_in_gallery": "TINYINT NOT NULL DEFAULT 1",
    },
    "project_assets": {
        # AI 角色库「应用到画布」实例化的要素记录其来源 character_key（溯源用途）。
        "source_ai_character_key": "VARCHAR(36) NULL",
    },
    "project_asset_images": {
        # 每图视角描述定义（角色名+视角，如「林晚的肖像特写」），选图/成片提示词代入。
        "caption": "VARCHAR(500) NULL",
    },
    "agent_steps": {
        # Loop Harness 幂等键：LLM tool_call id，防续跑重复扣费/重复执行。
        "tool_call_id": "VARCHAR(64) NULL",
    },
    "agent_runs": {
        # P0-b-2 人工确认（interrupt ↔ confirm_mode）。
        "confirm_mode": "VARCHAR(20) DEFAULT 'auto'",
        "pending_confirmation": "JSON NULL",
        "confirm_decision": "JSON NULL",
        # P1-a：Run 启动时的合并后运行配置快照。
        "agent_snapshot": "JSON NULL",
    },
    "users": {
        # 多组网关：用户→网关配置映射（NULL=默认组）。create_all 不改已存在的 users 表。
        "gateway_config_id": "INT NULL",
    },
}


async def _ensure_schema_migrations(conn) -> None:
    """Add any missing columns listed in _COLUMN_MIGRATIONS. Best-effort, never fatal."""
    from sqlalchemy import text
    for table, columns in _COLUMN_MIGRATIONS.items():
        try:
            res = await conn.execute(text(
                "SELECT column_name FROM information_schema.columns "
                "WHERE table_schema = DATABASE() AND table_name = :t"
            ), {"t": table})
            existing = {row[0] for row in res}
            for col, ddl in columns.items():
                if col not in existing:
                    await conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {col} {ddl}"))
                    print(f"🛠️  schema: added {table}.{col}")
        except Exception as exc:
            print(f"⚠️  schema migration for {table} skipped: {exc}")


async def _seed_default_agent() -> None:
    """幂等播种内置 system default agent + 一个示例 system skill。已存在则跳过。"""
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.agent import Agent, Skill
    from app.harness.agent_config import DEFAULT_AGENT
    try:
        async with AsyncSessionLocal() as db:
            exists = (await db.execute(
                select(Agent).where(Agent.agent_id == "default")
            )).scalar_one_or_none()
            if exists is None:
                db.add(Agent(
                    agent_id="default", tenant_id=None, user_id=None,
                    name="通用创作智能体", description="内置默认智能体：根据目标自主生图/生视频",
                    persona=DEFAULT_AGENT["persona"],
                    skill_ids=[], allowed_plugins=DEFAULT_AGENT["allowed_plugins"],
                    policy=DEFAULT_AGENT["policy"], scope="system", is_active=1,
                ))
                print("🌱 seeded system agent: default")
            else:
                # 幂等同步：让 DEFAULT_AGENT 常量的能力/预算/人设变更随重启传播到库
                exists.persona = DEFAULT_AGENT["persona"]
                exists.allowed_plugins = DEFAULT_AGENT["allowed_plugins"]
                exists.policy = DEFAULT_AGENT["policy"]
                print("🔄 synced system agent: default")
            skill_exists = (await db.execute(
                select(Skill).where(Skill.skill_id == "sys-ecommerce-storyboard")
            )).scalar_one_or_none()
            if skill_exists is None:
                db.add(Skill(
                    skill_id="sys-ecommerce-storyboard", tenant_id=None, user_id=None,
                    name="电商带货分镜法", category="影视创作", icon="clapperboard",
                    description="面向电商短视频的分镜方法论",
                    when_to_use="需要为商品制作带货短视频/分镜时",
                    instructions=(
                        "按「痛点开场→产品展示→卖点特写→使用场景→促单收尾」组织画面；"
                        "每个镜头描述具体、突出商品质感；语言口语化、有代入感。"
                    ),
                    recommended_plugins=["image.generate"],
                    inputs=[{"key": "product", "type": "text", "required": True, "label": "商品/卖点"}],
                    outputs=[], constraints={"aspect_ratio": "9:16", "forbidden_words": ["最", "根治"]},
                    few_shot=[], scope="system", version=1,
                ))
                print("🌱 seeded system skill: 电商带货分镜法")
            await db.commit()
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  seed default agent skipped: {exc}")


async def _seed_default_gateway_config() -> None:
    """幂等：把 .env 的 AI_GATEWAY_* 迁移为 DB 里的默认网关组，并预热解析缓存。

    若已存在 is_default=True 的行则不覆盖（尊重 admin 后续的界面修改）。
    """
    from sqlalchemy import select
    from app.db.session import AsyncSessionLocal
    from app.models.gateway_config import GatewayConfig
    from app.services import gateway_config_service
    try:
        async with AsyncSessionLocal() as db:
            existing = (await db.execute(
                select(GatewayConfig).where(GatewayConfig.is_default.is_(True))
            )).scalar_one_or_none()
            if existing is None:
                db.add(GatewayConfig(
                    name="默认网关（迁移自 .env）",
                    base_url=(settings.AI_GATEWAY_BASE_URL or "").rstrip("/"),
                    api_key=settings.AI_GATEWAY_API_KEY or "",
                    is_default=True,
                    is_active=True,
                ))
                await db.commit()
                print("🌱 seeded default gateway config from .env")
            # 预热进程内解析缓存
            await gateway_config_service.refresh_cache(db)
    except Exception as exc:  # noqa: BLE001
        print(f"⚠️  seed default gateway config skipped: {exc}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events"""
    # Startup
    print("🚀 Starting AI Aggregator Platform...")
    
    # Create local storage directory (used as staging area)
    storage_path = Path(settings.STORAGE_BASE_PATH)
    storage_path.mkdir(exist_ok=True)
    print(f"📁 Local staging directory: {storage_path.absolute()}")

    # Initialize MinIO bucket
    if settings.MINIO_ENABLED:
        from app.services.storage import get_storage_service
        try:
            storage = get_storage_service()
            await storage.ensure_bucket()
            print(f"✅ MinIO storage ready: {settings.MINIO_ENDPOINT}/{settings.MINIO_BUCKET}")
        except Exception as _minio_err:
            print(f"⚠️  MinIO not available ({_minio_err}), falling back to local storage")
    
    # Create database tables
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Idempotent column additions for tables that pre-date a schema change
        # (create_all only creates missing tables, never alters existing ones).
        await _ensure_schema_migrations(conn)

    # P1-a: 幂等播种内置 system default agent（+ 示例 skill），让列表非空且 executor 可从库加载
    await _seed_default_agent()

    # 多组网关：把 .env 的 AI_GATEWAY_* 迁移为 DB 默认组并预热解析缓存
    await _seed_default_gateway_config()

    yield
    
    # Shutdown
    print("👋 Shutting down AI Aggregator Platform...")
    await engine.dispose()


# Create FastAPI application
app = FastAPI(
    title=settings.PROJECT_NAME,
    description="Multi-modal AI Aggregator Platform with Multi-tenant SaaS Architecture",
    version="1.0.0",
    docs_url="/api/docs",
    redoc_url="/api/redoc",
    openapi_url="/api/openapi.json",
    lifespan=lifespan
)

# CORS Middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.BACKEND_CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Gzip Compression
app.add_middleware(GZipMiddleware, minimum_size=1000)

# Custom Middlewares
app.add_middleware(TenantContextMiddleware)
app.add_middleware(LoggingMiddleware)
app.middleware("http")(error_handler_middleware)

# API Routes
app.include_router(auth.router, prefix="/api/v1/auth", tags=["Authentication"])
app.include_router(users.router, prefix="/api/v1/users", tags=["Users"])
app.include_router(tenants.router, prefix="/api/v1/tenants", tags=["Tenants"])
app.include_router(credits.router, prefix="/api/v1/credits", tags=["Credits"])
app.include_router(payment.router, prefix="/api/v1/payment", tags=["Payment"])
app.include_router(models.router, prefix="/api/v1/models", tags=["Models"])
app.include_router(openai.router, prefix="/api/v1/openai", tags=["OpenAI"])
app.include_router(google.router, prefix="/api/v1/google", tags=["Google"])
app.include_router(flux.router, prefix="/api/v1/flux", tags=["Image (wan)"])
app.include_router(workflows.router, prefix="/api/v1/workflows", tags=["Workflows"])
app.include_router(douyin.router, prefix="/api/v1/douyin", tags=["Douyin"])
app.include_router(suggestions.router, prefix="/api/v1/suggestions", tags=["Suggestions"])
app.include_router(storage.router, prefix="/api/v1/storage", tags=["Storage"])
app.include_router(drama.router, prefix="/api/v1/drama", tags=["AI Drama"])
app.include_router(drama_projects.router, prefix="/api/v1/drama/projects", tags=["Drama Projects"])
app.include_router(static_media.router, prefix="/api/v1/static", tags=["Static Media"])
app.include_router(characters.router, prefix="/api/v1/characters", tags=["Characters"])
app.include_router(project_assets.router, prefix="/api/v1/project-assets", tags=["Project Assets"])
app.include_router(ai_characters.router, prefix="/api/v1/ai-characters", tags=["AI Characters"])
app.include_router(agents.router, prefix="/api/v1/agents", tags=["Custom Agents"])
app.include_router(render_pipeline.router, prefix="/api/v1/render/pipeline", tags=["Render Pipeline"])
app.include_router(media_studio.router, prefix="/api/v1/studio", tags=["Media Studio"])
app.include_router(admin_gateway.router, prefix="/api/v1/admin/gateway", tags=["Admin Gateway"])

# Mount static files for serving generated content
storage_path = Path(settings.STORAGE_BASE_PATH)
if storage_path.exists():
    app.mount(
        "/api/v1/google/outputs",
        StaticFiles(directory=str(storage_path), html=False),
        name="outputs"
    )
    app.mount(
        "/api/v1/flux/outputs",
        StaticFiles(directory=str(storage_path), html=False),
        name="flux_outputs"
    )
    app.mount(
        "/api/v1/openai/outputs",
        StaticFiles(directory=str(storage_path), html=False),
        name="openai_outputs"
    )


@app.get("/")
async def root():
    """Root endpoint"""
    return {
        "message": "Welcome to AI Aggregator Platform API",
        "version": "1.0.0",
        "docs": "/api/docs"
    }


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {
        "status": "healthy",
        "service": "ai-aggregator-api"
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(
        "app.main:app",
        host="0.0.0.0",
        port=8000,
        reload=True
    )

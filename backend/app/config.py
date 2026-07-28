"""
Application Configuration
"""
from typing import List, Optional
from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    """Application settings"""
    
    # Project Info
    PROJECT_NAME: str = "AI Aggregator Platform"
    VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"
    
    # Security
    SECRET_KEY: str = "your-secret-key-change-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    # Login/Register graphic CAPTCHA (stateless, HMAC-signed; no Redis needed)
    CAPTCHA_ENABLED: bool = True          # 置 False 关闭校验（本地/自动化测试）
    CAPTCHA_TTL_SECONDS: int = 300        # 验证码有效期（秒）
    CAPTCHA_LENGTH: int = 4               # 验证码字符数

    # Database
    DATABASE_URL: str = "mysql+aiomysql://ai_user:Ai@User2024@db:3306/ai_aggregator"
    
    # CORS
    BACKEND_CORS_ORIGINS: List[str] = ["http://localhost:3000", "http://localhost:3001", "http://localhost:3002", "http://localhost:5173"]
    
    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            import json
            v = v.strip().strip("'")
            if v.startswith("["):
                try:
                    return json.loads(v)
                except json.JSONDecodeError:
                    pass
            return [i.strip() for i in v.split(",")]
        return v
    
    # Redis (for caching and rate limiting)
    REDIS_URL: str = "redis://localhost:6379/0"
    
    # ── AI Aggregation Gateway (New API, OpenAI-compatible) ──────────────────
    # All AI model calls route through a single aggregation gateway with one token.
    AI_GATEWAY_BASE_URL: str = "https://neolink.com/api/v1"   # OpenAI-style prefix
    AI_GATEWAY_API_KEY: Optional[str] = None                  # single bearer token

    # Model bindings per service (override via env if the catalog changes)
    GATEWAY_TEXT_MODEL: str = "deepseek-v4-flash"             # all text reasoning
    GATEWAY_IMAGE_MODEL: str = "wan2.7-image"                 # 文生图/图生图 (standard)
    GATEWAY_IMAGE_PRO_MODEL: str = "wan2.7-image-pro"         # 文生图/图生图 (pro)
    GATEWAY_VIDEO_HAILUO_MODEL: str = "MiniMax/MiniMax-Hailuo-2.3"  # 海螺 t2v/i2v (OpenAI-style /videos)
    GATEWAY_VIDEO_HAPPYHORSE: str = "happyhorse-1.0"          # HappyHorse base id
    GATEWAY_DRAMA_VIDEO_MODEL: str = "doubao-seedance-2-0-260128"  # 短剧 Seedance

    # ── Media Studio models (M1 骨架；视频类待补充真实模型 ID) ────────────────
    # 短视频 / 图像特效复用现有可用模型(wan / Hailuo / Seedance),M1 即可出结果。
    GATEWAY_SHORT_VIDEO_MODEL: str = "MiniMax/MiniMax-Hailuo-2.3"  # AI短视频 (文/图生视频,海螺)
    GATEWAY_EFFECT_IMAGE_MODEL: str = "wan2.7-image"          # AI特效 (图像类,复用 wan 图生图)
    # M2: 按 neolink 文档填实。视频→视频/动作模仿走 Seedance 多模态(reference_video);
    # 视频编辑走 HappyHorse /videos(input_reference=输入视频);视频类特效沿用 HappyHorse i2v。
    GATEWAY_VIDEO2VIDEO_MODEL: str = "doubao-seedance-2-0-260128"   # 视频→视频 (Seedance reference_video)
    GATEWAY_MOTION_MODEL: str = "doubao-seedance-2-0-260128"        # 动作模仿 (Seedance ref_image+ref_video, 回退档)
    # 动作模仿 Kling 档:走 /api/kling/v1/videos/* 端点(需 token 开通 kling 分组)
    GATEWAY_KLING_MOTION_MODEL: str = "kling-v3"       # Kling 动作控制 (motion-control; doc model_name 枚举值 = kling-v3)
    GATEWAY_KLING_OMNI_MODEL: str = "kling-v3-omni"    # Kling Omni (omni-video 端点)
    GATEWAY_VIDEO_EDIT_MODEL: str = "happyhorse-1.0-edit-720p"  # 视频编辑 (HappyHorse edit;文档 id: happyhorse-1.0-edit-{res})
    GATEWAY_EFFECT_VIDEO_MODEL: str = "happyhorse-1.0-i2v-720p"     # AI特效 (视频类:挤压/融化/亲吻等)

    # Credit System
    DEFAULT_CREDITS: int = 200  # 新用户赠送200积分
    CREDIT_RECHARGE_ENABLED: bool = True
    
    # Rate Limiting
    RATE_LIMIT_PER_MINUTE: int = 60
    
    # Storage Configuration (local filesystem, used as staging area)
    STORAGE_BASE_PATH: str = "storage"
    UPLOAD_DIR: str = "uploads"
    OUTPUT_DIR: str = "outputs"
    MAX_UPLOAD_SIZE: int = 10 * 1024 * 1024  # 10MB
    ALLOWED_IMAGE_TYPES: List[str] = ["image/jpeg", "image/png", "image/webp"]
    RATE_LIMIT_PER_HOUR: int = 1000

    # MinIO Object Storage
    MINIO_ENDPOINT: str = "minio:9000"       # host:port (no scheme) — internal Docker address
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "ai-aggregator"
    MINIO_SECURE: bool = False               # True for HTTPS
    MINIO_ENABLED: bool = True               # Set False to disable MinIO and keep local-only
    # Presigned URL expiry in seconds (default 7 days)
    MINIO_PRESIGN_EXPIRES: int = 604800
    # Public endpoint used for presigned URL generation (browser-accessible).
    # Defaults to MINIO_ENDPOINT if not set. In production set to your domain.
    # Example: "localhost:9000" or "minio.example.com" (no scheme).
    MINIO_PUBLIC_ENDPOINT: Optional[str] = None

    # Public origin of THIS backend, reachable from the open internet (no trailing slash).
    # Used to build public, token-signed streaming URLs for external services (e.g. Seedance
    # fetching reference video/audio). Example: "https://www.juai8.com". Empty = feature off.
    PUBLIC_BASE_URL: str = ""

    # Logging
    LOG_LEVEL: str = "INFO"

    # Alipay Configuration (支付宝配置)
    ALIPAY_APPID: Optional[str] = None  # 支付宝应用ID
    ALIPAY_APP_PRIVATE_KEY: Optional[str] = None  # 应用私钥
    ALIPAY_PUBLIC_KEY: Optional[str] = None  # 支付宝公钥
    ALIPAY_GATEWAY: str = "https://openapi-sandbox.dl.alipaydev.com/gateway.do"  # 沙箱网关，生产环境改为：https://openapi.alipay.com/gateway.do
    ALIPAY_SIGN_TYPE: str = "RSA2"  # 签名类型
    ALIPAY_RETURN_URL: Optional[str] = None  # 前端回调地址
    ALIPAY_NOTIFY_URL: Optional[str] = None  # 后端异步通知地址
    ALIPAY_ORDER_TIMEOUT: int = 30  # 订单超时时间（分钟）

    # Douyin Open Platform (抖音开放平台)
    DOUYIN_CLIENT_KEY: Optional[str] = None
    DOUYIN_CLIENT_SECRET: Optional[str] = None
    DOUYIN_REDIRECT_URI: Optional[str] = None

    class Config:
        env_file = ".env"
        case_sensitive = True
        # Tolerate legacy/unused env vars (e.g. removed per-provider API keys now
        # superseded by the unified AI_GATEWAY_* settings) instead of crashing.
        extra = "ignore"


settings = Settings()

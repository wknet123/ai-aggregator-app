"""Admin 网关管理 API —— 多组网关凭证 CRUD + 用户映射。

平台级全局，全部端点仅限 is_admin（check_admin_permission）。
每次写操作后刷新进程内解析缓存（gateway_config_service.refresh_cache）。
"""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import check_admin_permission
from app.models.gateway_config import GatewayConfig
from app.models.user import User
from app.schemas.gateway_config import (
    GatewayConfigCreate,
    GatewayConfigUpdate,
    UserMappingUpdate,
)
from app.schemas.response import ResponseBase
from app.services import gateway_config_service

router = APIRouter()


def _mask(api_key: str | None) -> str:
    if not api_key:
        return ""
    return f"****{api_key[-4:]}" if len(api_key) >= 4 else "****"


def _config_out(c: GatewayConfig) -> dict:
    return {
        "id": c.id,
        "name": c.name,
        "base_url": c.base_url,
        "api_key_masked": _mask(c.api_key),
        "is_default": c.is_default,
        "is_active": c.is_active,
        "created_at": c.created_at,
        "updated_at": c.updated_at,
    }


# ── 网关配置 CRUD ────────────────────────────────────────────────────────────
@router.get("/configs", response_model=ResponseBase)
async def list_configs(
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    rows = (await db.execute(select(GatewayConfig).order_by(GatewayConfig.id))).scalars().all()
    return ResponseBase(success=True, data={"items": [_config_out(c) for c in rows]})


@router.post("/configs", response_model=ResponseBase)
async def create_config(
    body: GatewayConfigCreate,
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    config = GatewayConfig(
        name=body.name,
        base_url=body.base_url.rstrip("/"),
        api_key=body.api_key,
        is_default=body.is_default,
        is_active=body.is_active,
    )
    db.add(config)
    await db.flush()
    if body.is_default:
        # 取消其它默认组，保证全库仅一行 is_default
        await _clear_other_defaults(db, keep_id=config.id)
    await db.commit()
    await db.refresh(config)
    await gateway_config_service.refresh_cache(db)
    return ResponseBase(success=True, message="已创建", data=_config_out(config))


@router.put("/configs/{config_id}", response_model=ResponseBase)
async def update_config(
    config_id: int,
    body: GatewayConfigUpdate,
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    config = await db.get(GatewayConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="配置不存在")
    if body.name is not None:
        config.name = body.name
    if body.base_url is not None:
        config.base_url = body.base_url.rstrip("/")
    if body.api_key:  # 留空 = 不改
        config.api_key = body.api_key
    if body.is_active is not None:
        if not body.is_active and config.is_default:
            raise HTTPException(status_code=409, detail="默认组不可停用，请先切换默认组")
        config.is_active = body.is_active
    await db.commit()
    await db.refresh(config)
    await gateway_config_service.refresh_cache(db)
    return ResponseBase(success=True, message="已更新", data=_config_out(config))


@router.delete("/configs/{config_id}", response_model=ResponseBase)
async def delete_config(
    config_id: int,
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    config = await db.get(GatewayConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="配置不存在")
    if config.is_default:
        raise HTTPException(status_code=409, detail="默认组不可删除，请先切换默认组")
    refs = (await db.execute(
        select(func.count()).select_from(User).where(User.gateway_config_id == config_id)
    )).scalar_one()
    if refs > 0:
        raise HTTPException(status_code=409, detail=f"仍有 {refs} 个用户映射到该配置，请先解除映射")
    await db.delete(config)
    await db.commit()
    await gateway_config_service.refresh_cache(db)
    return ResponseBase(success=True, message="已删除", data={"id": config_id})


@router.post("/configs/{config_id}/set-default", response_model=ResponseBase)
async def set_default_config(
    config_id: int,
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    config = await db.get(GatewayConfig, config_id)
    if not config:
        raise HTTPException(status_code=404, detail="配置不存在")
    if not config.is_active:
        raise HTTPException(status_code=409, detail="已停用的配置不可设为默认组")
    await _clear_other_defaults(db, keep_id=config_id)
    config.is_default = True
    await db.commit()
    await gateway_config_service.refresh_cache(db)
    return ResponseBase(success=True, message="已设为默认组", data={"id": config_id})


async def _clear_other_defaults(db: AsyncSession, keep_id: int) -> None:
    rows = (await db.execute(
        select(GatewayConfig).where(GatewayConfig.is_default.is_(True), GatewayConfig.id != keep_id)
    )).scalars().all()
    for c in rows:
        c.is_default = False


# ── 用户映射 ────────────────────────────────────────────────────────────────
@router.get("/user-mappings", response_model=ResponseBase)
async def list_user_mappings(
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=200),
):
    total = (await db.execute(select(func.count()).select_from(User))).scalar_one()
    rows = (await db.execute(
        select(User).order_by(User.id).offset((page - 1) * page_size).limit(page_size)
    )).scalars().all()
    items = [
        {
            "user_id": u.id,
            "email": u.email,
            "username": u.username,
            "is_admin": u.is_admin,
            "gateway_config_id": u.gateway_config_id,
        }
        for u in rows
    ]
    return ResponseBase(success=True, data={"items": items, "total": total, "page": page, "page_size": page_size})


@router.put("/user-mappings/{user_id}", response_model=ResponseBase)
async def set_user_mapping(
    user_id: int,
    body: UserMappingUpdate,
    _admin: Annotated[User, Depends(check_admin_permission)],
    db: Annotated[AsyncSession, Depends(get_db)],
):
    user = await db.get(User, user_id)
    if not user:
        raise HTTPException(status_code=404, detail="用户不存在")
    if body.gateway_config_id is not None:
        config = await db.get(GatewayConfig, body.gateway_config_id)
        if not config:
            raise HTTPException(status_code=404, detail="目标配置不存在")
        if not config.is_active:
            raise HTTPException(status_code=409, detail="不可映射到已停用的配置")
    user.gateway_config_id = body.gateway_config_id
    await db.commit()
    await gateway_config_service.refresh_cache(db)
    return ResponseBase(
        success=True, message="已更新映射",
        data={"user_id": user_id, "gateway_config_id": body.gateway_config_id},
    )

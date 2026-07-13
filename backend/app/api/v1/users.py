"""
User API endpoints
"""
from typing import Annotated
from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.dependencies import get_current_active_user
from app.models.user import User
from app.schemas.user import UserResponse, UserUpdate, ChangePasswordRequest
from app.schemas.response import ResponseBase
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService


router = APIRouter()


@router.get("/me", response_model=ResponseBase[UserResponse])
async def get_current_user(
    current_user: Annotated[User, Depends(get_current_active_user)]
):
    """Get current user information"""
    return ResponseBase(
        success=True,
        message="User retrieved successfully",
        data=UserResponse.model_validate(current_user)
    )


@router.put("/me", response_model=ResponseBase[UserResponse])
async def update_current_user(
    user_update: UserUpdate,
    current_user: Annotated[User, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Update current user information"""
    user_repo = UserRepository(db)
    
    updated_user = await user_repo.update(
        current_user.id,
        **user_update.model_dump(exclude_unset=True)
    )
    
    return ResponseBase(
        success=True,
        message="User updated successfully",
        data=UserResponse.model_validate(updated_user)
    )


@router.post("/me/change-password", response_model=ResponseBase[dict])
async def change_password(
    body: ChangePasswordRequest,
    current_user: Annotated[User, Depends(get_current_active_user)],
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """修改当前用户密码。成功后保持当前会话（不轮换 token）。"""
    auth_service = AuthService(db)
    await auth_service.change_password(
        current_user, body.current_password, body.new_password
    )
    return ResponseBase(
        success=True,
        message="密码修改成功",
        data={"changed": True},
    )

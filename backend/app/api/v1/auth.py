"""
Authentication API endpoints
"""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status, Form
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr

from jose import JWTError

from app.config import settings
from app.db.session import get_db
from app.core.security import decode_token, create_access_token
from app.core.captcha import generate_captcha_data_url, verify_captcha
from app.repositories.user_repository import UserRepository
from app.services.auth_service import AuthService
from app.schemas.user import UserResponse
from app.schemas.response import ResponseBase


router = APIRouter()


class RegisterRequest(BaseModel):
    """User registration request"""
    email: EmailStr
    username: str
    password: str
    full_name: str | None = None
    tenant_name: str | None = None
    captcha_token: str | None = None
    captcha_answer: str | None = None


class RefreshRequest(BaseModel):
    """Refresh token request"""
    refresh_token: str


class LoginResponse(BaseModel):
    """Login response"""
    access_token: str
    refresh_token: str
    token_type: str
    user: UserResponse


def _require_captcha(token: str | None, answer: str | None) -> None:
    """校验图形验证码；CAPTCHA_ENABLED=False 时跳过。失败抛 400。"""
    if not settings.CAPTCHA_ENABLED:
        return
    if not verify_captcha(token or "", answer or ""):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="验证码错误或已过期",
        )


@router.get("/captcha", response_model=ResponseBase[dict])
async def get_captcha():
    """生成一张图形验证码，返回不透明 token 与 base64 图片。"""
    token, data_url = generate_captcha_data_url()
    return ResponseBase(
        success=True,
        message="Captcha generated",
        data={"captcha_token": token, "captcha_image": data_url},
    )


@router.post("/register", response_model=ResponseBase[UserResponse])
async def register(
    request: RegisterRequest,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Register a new user"""
    _require_captcha(request.captcha_token, request.captcha_answer)

    auth_service = AuthService(db)
    
    user = await auth_service.register_user(
        email=request.email,
        username=request.username,
        password=request.password,
        full_name=request.full_name,
        tenant_name=request.tenant_name
    )
    
    return ResponseBase(
        success=True,
        message="User registered successfully",
        data=UserResponse.model_validate(user)
    )


@router.post("/login", response_model=ResponseBase[LoginResponse])
async def login(
    form_data: Annotated[OAuth2PasswordRequestForm, Depends()],
    db: Annotated[AsyncSession, Depends(get_db)],
    captcha_token: Annotated[str | None, Form()] = None,
    captcha_answer: Annotated[str | None, Form()] = None,
):
    """User login"""
    _require_captcha(captcha_token, captcha_answer)

    auth_service = AuthService(db)
    
    user = await auth_service.authenticate_user(form_data.username, form_data.password)
    
    if not user:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    tokens = auth_service.create_tokens(user)
    
    return ResponseBase(
        success=True,
        message="Login successful",
        data=LoginResponse(
            **tokens,
            user=UserResponse.model_validate(user)
        )
    )


@router.post("/refresh", response_model=ResponseBase[dict])
async def refresh_token(
    request: RefreshRequest,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Exchange a valid refresh token for a fresh access token."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid refresh token",
        headers={"WWW-Authenticate": "Bearer"},
    )

    try:
        payload = decode_token(request.refresh_token)
    except JWTError:
        raise credentials_exception

    # Must be a refresh token (not an access token) carrying a user id.
    if payload.get("type") != "refresh":
        raise credentials_exception
    user_id = payload.get("sub")
    if user_id is None:
        raise credentials_exception

    user = await UserRepository(db).get(int(user_id))
    if user is None or not user.is_active:
        raise credentials_exception

    access_token = create_access_token(data={"sub": str(user.id)})
    return ResponseBase(
        success=True,
        message="Token refreshed",
        data={"access_token": access_token, "token_type": "bearer"},
    )

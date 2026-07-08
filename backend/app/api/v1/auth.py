"""
Authentication API endpoints
"""
from typing import Annotated
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, EmailStr

from jose import JWTError

from app.db.session import get_db
from app.core.security import decode_token, create_access_token
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


class RefreshRequest(BaseModel):
    """Refresh token request"""
    refresh_token: str


class LoginResponse(BaseModel):
    """Login response"""
    access_token: str
    refresh_token: str
    token_type: str
    user: UserResponse


@router.post("/register", response_model=ResponseBase[UserResponse])
async def register(
    request: RegisterRequest,
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """Register a new user"""
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
    db: Annotated[AsyncSession, Depends(get_db)]
):
    """User login"""
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

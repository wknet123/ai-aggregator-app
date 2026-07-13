"""
Authentication Service
"""
from typing import Optional
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import HTTPException, status
from app.models.user import User
from app.models.tenant import Tenant
from app.models.credit import Credit
from app.repositories.user_repository import UserRepository
from app.repositories.tenant_repository import TenantRepository
from app.core.security import verify_password, get_password_hash, create_access_token, create_refresh_token
from app.config import settings


class AuthService:
    """Authentication service"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
        self.user_repo = UserRepository(db)
        self.tenant_repo = TenantRepository(db)
    
    async def authenticate_user(self, username: str, password: str) -> Optional[User]:
        """Authenticate user with username or email and password"""
        login_id = (username or "").strip()
        user = await self.user_repo.get_by_username(login_id)

        if not user and "@" in login_id:
            user = await self.user_repo.get_by_email(login_id)

        if not user:
            return None
        
        if not verify_password(password, user.hashed_password):
            return None
        
        if not user.is_active:
            return None
        
        return user
    
    async def register_user(
        self,
        email: str,
        username: str,
        password: str,
        full_name: Optional[str] = None,
        tenant_name: Optional[str] = None
    ) -> User:
        """Register a new user with a new tenant"""
        # Check if user exists
        existing_user = await self.user_repo.get_by_email(email)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Email already registered"
            )
        
        existing_user = await self.user_repo.get_by_username(username)
        if existing_user:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Username already taken"
            )
        
        # Create tenant
        tenant_slug = tenant_name.lower().replace(" ", "-") if tenant_name else username
        tenant = Tenant(
            name=tenant_name or f"{username}'s Organization",
            slug=tenant_slug,
            is_active=True
        )
        self.db.add(tenant)
        await self.db.flush()
        
        # Create default credit for tenant
        credit = Credit(
            tenant_id=tenant.id,
            balance=settings.DEFAULT_CREDITS
        )
        self.db.add(credit)
        
        # Create user
        user = User(
            email=email,
            username=username,
            hashed_password=get_password_hash(password),
            full_name=full_name,
            is_active=True,
            is_admin=True,  # First user is admin
            tenant_id=tenant.id
        )
        self.db.add(user)
        
        await self.db.commit()
        await self.db.refresh(user)
        
        return user
    
    def create_tokens(self, user: User) -> dict:
        """Create access and refresh tokens for user"""
        access_token = create_access_token(data={"sub": str(user.id)})
        refresh_token = create_refresh_token(data={"sub": str(user.id)})

        return {
            "access_token": access_token,
            "refresh_token": refresh_token,
            "token_type": "bearer"
        }

    async def change_password(self, user: User, current_password: str, new_password: str) -> None:
        """校验当前密码后更新为新密码。失败抛 HTTPException(400)。"""
        if not verify_password(current_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="当前密码不正确",
            )
        if verify_password(new_password, user.hashed_password):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="新密码不能与当前密码相同",
            )
        user.hashed_password = get_password_hash(new_password)
        await self.db.commit()


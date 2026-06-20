# Auth routes (Phase 1, Step 2): signup, login, refresh, logout, /users/me.
#
# Access tokens come from the JWTStrategy (app/auth/backend.py) so the standard
# current_active_user dependency validates them. Refresh tokens are custom,
# DB-backed and rotated on every use (old row revoked, new one issued). Bearer
# in the Authorization header only - no cookies.

import hashlib
import secrets
from datetime import datetime, timedelta, timezone

from beanie import PydanticObjectId
from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.security import OAuth2PasswordRequestForm
from pydantic import BaseModel, EmailStr

from app.auth.backend import (
    current_active_user,
    fastapi_users,
    get_jwt_strategy,
)
from app.auth.manager import UserManager, get_user_manager
from app.core.config import settings
from app.models.refresh_token import RefreshToken
from app.models.user import User
from app.schemas.user import UserRead, UserCreate, UserUpdate


# ---- request / response bodies ----------------------------------------------


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RefreshRequest(BaseModel):
    refresh_token: str


class LogoutRequest(BaseModel):
    refresh_token: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


# ---- refresh-token helpers ---------------------------------------------------


def _hash_token(raw: str) -> str:
    """sha256 hex digest - what we store and look up by (never the raw token)."""
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def _as_aware_utc(dt: datetime) -> datetime:
    """MongoDB returns naive UTC datetimes; normalise so comparisons against an
    aware 'now' never raise."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


async def _issue_refresh_token(user_id: PydanticObjectId) -> str:
    """Create a new refresh-token row and return the RAW token (stored hashed)."""
    raw = secrets.token_urlsafe(48)
    expires_at = datetime.now(timezone.utc) + timedelta(
        seconds=settings.REFRESH_TOKEN_LIFETIME_SECONDS
    )
    await RefreshToken(
        user_id=user_id, token_hash=_hash_token(raw), expires_at=expires_at
    ).insert()
    return raw


# ---- custom auth endpoints (login / refresh / logout) ------------------------

custom_auth_router = APIRouter(prefix="/auth", tags=["auth"])


@custom_auth_router.post("/login", response_model=TokenResponse)
async def login(
    credentials: LoginRequest,
    user_manager: UserManager = Depends(get_user_manager),
):
    """Email/password login. Returns a JWT access token + a new refresh token."""
    # authenticate() handles password verification (and a constant-time dummy
    # hash on unknown emails to avoid leaking which addresses exist).
    form = OAuth2PasswordRequestForm(
        username=credentials.email, password=credentials.password, scope=""
    )
    user = await user_manager.authenticate(form)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST, detail="LOGIN_BAD_CREDENTIALS"
        )

    access_token = await get_jwt_strategy().write_token(user)
    refresh_token = await _issue_refresh_token(user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


@custom_auth_router.post("/refresh", response_model=TokenResponse)
async def refresh(
    body: RefreshRequest,
    user_manager: UserManager = Depends(get_user_manager),
):
    """Exchange a valid refresh token for a fresh access token, ROTATING the
    refresh token (old one is revoked, a new one is issued)."""
    row = await RefreshToken.find_one(
        RefreshToken.token_hash == _hash_token(body.refresh_token)
    )
    now = datetime.now(timezone.utc)
    if row is None or row.revoked or _as_aware_utc(row.expires_at) <= now:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN"
        )

    # Rotate first: revoke the presented token so it can't be reused even if the
    # rest of this request fails.
    row.revoked = True
    await row.save()

    user = await user_manager.get(row.user_id)
    if user is None or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="INVALID_REFRESH_TOKEN"
        )

    access_token = await get_jwt_strategy().write_token(user)
    new_refresh = await _issue_refresh_token(user.id)
    return TokenResponse(access_token=access_token, refresh_token=new_refresh)


@custom_auth_router.post("/logout", status_code=status.HTTP_200_OK)
async def logout(
    body: LogoutRequest,
    user: User = Depends(current_active_user),
):
    """Revoke the given refresh token for the authenticated user. Access tokens
    are stateless and simply expire. Idempotent."""
    row = await RefreshToken.find_one(
        RefreshToken.token_hash == _hash_token(body.refresh_token),
        RefreshToken.user_id == user.id,
    )
    if row is not None and not row.revoked:
        row.revoked = True
        await row.save()
    return {"detail": "Logged out."}


# ---- aggregate router (mounted in app/main.py) -------------------------------

router = APIRouter()
# Signup: fastapi-users register router -> POST /auth/register
router.include_router(
    fastapi_users.get_register_router(UserRead, UserCreate),
    prefix="/auth",
    tags=["auth"],
)
# Custom login / refresh / logout
router.include_router(custom_auth_router)
# Self-service profile: GET/PATCH /users/me (and admin-by-id) via current_active_user
router.include_router(
    fastapi_users.get_users_router(UserRead, UserUpdate),
    prefix="/users",
    tags=["users"],
)

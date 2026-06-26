# The access-token authentication backend (Phase 1, Step 2).
#
# Bearer JWT access tokens, minted and validated by a single JWTStrategy so the
# standard current_active_user dependency below validates exactly what /login
# and /refresh hand out. The long-lived REFRESH token is custom and DB-backed
# (see app/models/refresh_token.py + app/auth/routes.py) - it is NOT a JWT.

from datetime import datetime, timezone

from beanie import PydanticObjectId
from fastapi import Depends, HTTPException, status
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)

from app.auth.manager import get_user_manager
from app.core.config import settings
from app.models.assessor_profile import AssessorProfile, AssessorStatus
from app.models.user import User

# tokenUrl points at our custom login route (used for the OpenAPI "Authorize"
# button / docs); the actual login handler lives in app/auth/routes.py.
bearer_transport = BearerTransport(tokenUrl="auth/login")


def get_jwt_strategy() -> JWTStrategy:
    """The single source of truth for access tokens. Reused by /login and
    /refresh so every access token is signed and validated identically."""
    return JWTStrategy(
        secret=settings.AUTH_SECRET,
        lifetime_seconds=settings.ACCESS_TOKEN_LIFETIME_SECONDS,
    )


auth_backend = AuthenticationBackend(
    name="jwt",
    transport=bearer_transport,
    get_strategy=get_jwt_strategy,
)

fastapi_users = FastAPIUsers[User, PydanticObjectId](get_user_manager, [auth_backend])

# Dependency for protected routes: requires a valid, non-expired access token
# belonging to an active user. (No existing route is gated yet - that's Step 3.)
current_active_user = fastapi_users.current_user(active=True)


def _as_aware_utc(dt: datetime) -> datetime:
    """MongoDB returns naive UTC datetimes; normalise so comparisons against an
    aware 'now' never raise (mirrors the helper in auth/routes.py - duplicated
    here to avoid a circular import, since auth/routes imports this module)."""
    return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)


def _is_expired(expiry: datetime | None, now: datetime) -> bool:
    """An expiry blocks only if it is present AND in the past. A None expiry
    never blocks - the backfilled assessors carry null expiries and must pass."""
    return expiry is not None and _as_aware_utc(expiry) < now


async def current_assessor(user: User = Depends(current_active_user)) -> User:
    """Gate for the assessor Console (CONSOLE-B1 + Phase 3). Layers on top of
    current_active_user; precedence is proven by behaviour:

      - no / invalid / expired token            -> 401 (current_active_user)
      - valid token, role != "assessor"         -> 403 ("assessor access only")
      - role == "assessor", no/!APPROVED profile-> 403 ("assessor access not approved")
      - role == "assessor", APPROVED, expired    -> 403 ("assessor access not approved")
      - role == "assessor", APPROVED, not expired-> the User

    Phase 3 makes admin approval the only path to access: a promoted role alone
    is no longer enough - the caller must also have an APPROVED AssessorProfile
    whose accreditation/insurance are not past their (optional) expiry. The
    profile lookup is one indexed point-read on the unique user_id, and only runs
    for callers who already cleared the role check."""
    if getattr(user, "role", "consumer") != "assessor":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="assessor access only",
        )

    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None or profile.status != AssessorStatus.APPROVED:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="assessor access not approved",
        )

    now = datetime.now(timezone.utc)
    if _is_expired(profile.accreditation_expiry, now) or _is_expired(
        profile.insurance_expiry, now
    ):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="assessor access not approved",
        )

    return user


async def current_admin(user: User = Depends(current_active_user)) -> User:
    """Gate for the admin app (Phase 3). Mirrors current_assessor's role check:

      - no / invalid / expired token   -> 401 (current_active_user)
      - valid token, role != "admin"   -> 403 ("admin access only")
      - valid token, role == "admin"    -> the User

    There is no public path to role="admin"; the first admin is minted out-of-band
    by scripts/set_admin.py, exactly like the first assessor was."""
    if getattr(user, "role", "consumer") != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="admin access only",
        )
    return user

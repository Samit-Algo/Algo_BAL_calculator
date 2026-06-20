# The access-token authentication backend (Phase 1, Step 2).
#
# Bearer JWT access tokens, minted and validated by a single JWTStrategy so the
# standard current_active_user dependency below validates exactly what /login
# and /refresh hand out. The long-lived REFRESH token is custom and DB-backed
# (see app/models/refresh_token.py + app/auth/routes.py) - it is NOT a JWT.

from beanie import PydanticObjectId
from fastapi_users import FastAPIUsers
from fastapi_users.authentication import (
    AuthenticationBackend,
    BearerTransport,
    JWTStrategy,
)

from app.auth.manager import get_user_manager
from app.core.config import settings
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

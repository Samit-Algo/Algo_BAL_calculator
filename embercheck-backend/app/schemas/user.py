# API schemas for the consumer-account endpoints (Phase 1, Step 2).
#
# These are the request/response shapes fastapi-users uses for register / me.
# They deliberately mirror the User document but NEVER expose hashed_password -
# the fastapi-users base schemas already exclude it; we only add `name` (and the
# read-only created_at / auth_provider on the read schema).

from datetime import datetime

from beanie import PydanticObjectId
from fastapi_users import schemas


class UserRead(schemas.BaseUser[PydanticObjectId]):
    """Public view of a user (id, email, is_active/superuser/verified) plus our
    profile fields. No password material is ever included."""

    name: str | None = None
    created_at: datetime
    updated_at: datetime
    auth_provider: str
    google_id: str | None = None


class UserCreate(schemas.BaseUserCreate):
    """Signup payload: email + password (from the base) plus an optional name."""

    name: str | None = None


class UserUpdate(schemas.BaseUserUpdate):
    """Self-service profile update (PATCH /users/me): all fields optional."""

    name: str | None = None

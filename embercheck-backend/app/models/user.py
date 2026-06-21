# The User document for consumer accounts (Phase 1).
#
# This is the model the fastapi-users Beanie adapter binds to. By subclassing
# the library's BeanieBaseUser it already carries email, hashed_password,
# is_active, is_superuser and is_verified; Beanie's Document gives it the
# PydanticObjectId `id`. We only add EmberCheck-specific profile fields here.
#
# Step 1 deliberately stopped at the model + the get_user_db dependency. The
# UserManager, auth backends and routers are now wired, including Google OAuth.

from datetime import datetime, timezone

from beanie import Document
from fastapi_users_db_beanie import BeanieBaseUser, BeanieUserDatabase
from pydantic import Field


class User(BeanieBaseUser, Document):
    """A consumer account. Email/password is the first auth provider; Google
    (auth_provider="google", google_id set) comes later."""

    name: str | None = None
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    auth_provider: str = "local"  # "local" (email/password) or "google"
    google_id: str | None = None

    class Settings(BeanieBaseUser.Settings):
        # Keep BeanieBaseUser.Settings' case-insensitive unique email index;
        # just pin the collection name.
        name = "users"


async def get_user_db():
    """fastapi-users database dependency, consumed by the UserManager in
    app/auth/manager.py."""
    yield BeanieUserDatabase(User)


# The UserManager lives in app/auth/manager.py, the JWT access backend in
# app/auth/backend.py, and auth routes in app/auth/routes.py.

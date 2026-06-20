# The fastapi-users UserManager (Phase 1, Step 2).
#
# Owns the user lifecycle: password validation, hashing (via the base manager's
# password_helper), and post-register hooks. Secrets come from settings; nothing
# is hardcoded. The reset-password / verification flows aren't exposed as routes
# yet, but their token secrets are wired so they're ready when we add them.

import logging
from datetime import datetime, timezone
from typing import Optional

from beanie import PydanticObjectId
from fastapi import Depends, Request
from fastapi_users import BaseUserManager
from fastapi_users.exceptions import InvalidPasswordException
from fastapi_users_db_beanie import ObjectIDIDMixin

from app.core.config import settings
from app.models.user import User, get_user_db

logger = logging.getLogger("embercheck.auth")


class UserManager(ObjectIDIDMixin, BaseUserManager[User, PydanticObjectId]):
    """Email/password user manager. ObjectIDIDMixin parses the Mongo ObjectId
    ids; BaseUserManager provides create/authenticate/password helpers."""

    reset_password_token_secret = settings.AUTH_SECRET
    verification_token_secret = settings.AUTH_SECRET

    async def validate_password(
        self, password: str, user
    ) -> None:
        if len(password) < 8:
            raise InvalidPasswordException(
                reason="Password must be at least 8 characters long."
            )

    async def on_after_register(
        self, user: User, request: Optional[Request] = None
    ) -> None:
        # The User model defaults already set these, but enforce them here so an
        # account is never persisted without them.
        changed = False
        if not user.auth_provider:
            user.auth_provider = "local"
            changed = True
        if user.created_at is None:
            user.created_at = datetime.now(timezone.utc)
            changed = True
        if changed:
            await user.save()
        logger.info("New user registered: %s (id=%s)", user.email, user.id)


async def get_user_manager(user_db=Depends(get_user_db)):
    """fastapi-users dependency: yields a UserManager bound to the Beanie
    user database from Step 1."""
    yield UserManager(user_db)

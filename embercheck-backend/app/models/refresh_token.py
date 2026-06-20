# The RefreshToken document (Phase 1, Step 2).
#
# Refresh tokens are long-lived, DB-backed and revocable - the complement to the
# stateless JWT access token. We store ONLY the sha256 hash of the raw token;
# the raw value is returned to the client once and never persisted, so a DB read
# can't be replayed as a credential. Rotation on /auth/refresh revokes the old
# row and issues a new one.

from datetime import datetime, timezone

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel


class RefreshToken(Document):
    user_id: PydanticObjectId  # the owning user (indexed)
    token_hash: str  # sha256(raw_token) hex digest - never the raw token
    expires_at: datetime
    revoked: bool = False
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "refresh_tokens"
        indexes = [
            IndexModel("user_id"),
            IndexModel("token_hash", unique=True),
        ]

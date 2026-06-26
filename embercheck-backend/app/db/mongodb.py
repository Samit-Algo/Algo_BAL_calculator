# MongoDB connection + Beanie initialisation (Phase 1).
#
# Beanie 2.x uses PyMongo's native async client (`AsyncMongoClient`); the older
# `motor` driver is no longer compatible with init_beanie. The client is created
# lazily inside init_db() (called from the app's lifespan startup) rather than
# at import time, so importing this module never tries to connect - the
# assessment pipeline and its tests import cleanly with no MONGODB_URI set.

from pymongo import AsyncMongoClient
from pymongo.asynchronous.database import AsyncDatabase

from beanie import init_beanie

from app.core.config import settings
from app.models.admin_audit import AdminAuditEvent
from app.models.assessor_profile import AssessorProfile
from app.models.audit import CaseAuditEvent
from app.models.case import Case
from app.models.refresh_token import RefreshToken
from app.models.user import User

# Set by init_db(); used by get_client()/get_db() and torn down by close_db().
_client: AsyncMongoClient | None = None
_db: AsyncDatabase | None = None


def get_client() -> AsyncMongoClient:
    """The live MongoDB client. Raises if the DB hasn't been initialised yet."""
    if _client is None:
        raise RuntimeError("MongoDB client not initialised; call init_db() first.")
    return _client


def get_db() -> AsyncDatabase:
    """The selected database. Raises if the DB hasn't been initialised yet."""
    if _db is None:
        raise RuntimeError("MongoDB database not initialised; call init_db() first.")
    return _db


async def init_db() -> None:
    """Connect to MongoDB and initialise Beanie with the document models.

    Sets the module-level client/db before init_beanie so that even if index
    setup fails, get_client() can still serve the /db/ping health check.
    """
    global _client, _db
    _client = AsyncMongoClient(settings.MONGODB_URI)
    _db = _client[settings.MONGODB_DB_NAME]
    await init_beanie(
        database=_db,
        document_models=[User, Case, RefreshToken, CaseAuditEvent, AssessorProfile, AdminAuditEvent],
    )


async def close_db() -> None:
    """Close the MongoDB client on shutdown."""
    global _client, _db
    if _client is not None:
        await _client.close()
    _client = None
    _db = None

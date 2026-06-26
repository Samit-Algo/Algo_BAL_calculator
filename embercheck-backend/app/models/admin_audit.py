# Persistent, append-only ADMIN audit log (Phase 3).
#
# Every admin action on an assessor application (approve / reject / request-info /
# suspend / deactivate / reactivate) writes ONE immutable row here. Rows are only
# ever inserted - never updated or deleted - so the approval history of an
# assessor can never be lost or rewritten.
#
# This is a SIBLING of CaseAuditEvent, not an extension: CaseAuditEvent is tightly
# coupled to a case_id (required, indexed, read by case). Admin actions are scoped
# to an assessor PROFILE / USER, so they get their own collection. The AuditChange
# sub-model is reused as-is (it is domain-agnostic).

from datetime import datetime, timezone

from beanie import Document, PydanticObjectId
from pydantic import Field
from pymongo import IndexModel

from app.models.audit import AuditChange  # reused verbatim


class AdminAuditEvent(Document):
    """One immutable admin action on one assessor profile."""

    profile_id: PydanticObjectId  # references AssessorProfile.id (indexed)
    target_user_id: PydanticObjectId  # the assessor the action is about
    target_email: str  # the assessor's email (denormalised for the trail)
    # The acting admin.
    admin_id: PydanticObjectId
    admin_email: str
    action: str  # "approve" | "reject" | "request_info" | "suspend" | "deactivate" | "reactivate"
    changes: list[AuditChange] = Field(default_factory=list)
    reason: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "admin_audit"
        indexes = [IndexModel("profile_id")]

# Persistent, append-only assessor audit log (CONSOLE-B3).
#
# Every Confirm and Override an assessor performs writes one immutable row here.
# Rows are only ever inserted - never updated or deleted - so the determination's
# history can never be lost or rewritten. The Console's read endpoint merges
# these with the system-derived audit events for display.

from datetime import datetime, timezone

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel


class AuditChange(BaseModel):
    """One field that changed in an override (recorded individually)."""

    field: str  # "vegetation_class" | "distance_m" | "effective_slope_degrees" | ...
    previous: str | None = None  # stringified prior value ("—" when none)
    new: str | None = None  # stringified new value


class CaseAuditEvent(Document):
    """One immutable assessor action on one compass side of one case."""

    case_id: PydanticObjectId  # references Case.id (indexed)
    # The acting assessor. None for system/consumer-driven events (e.g. the
    # automatic NEEDS_MORE_PHOTOS → UNDER_REVIEW resume when the consumer uploads
    # requested evidence), which aren't performed by an assessor.
    assessor_id: PydanticObjectId | None = None
    assessor_email: str  # the actor label shown in the trail (assessor / "System")
    # The side an action targets. None for case-level actions (e.g. a status
    # change), which aren't scoped to one elevation.
    compass_side: str | None = None
    kind: str  # "confirm" | "override" | "revert" | "status" | "auto_resume"
    changes: list[AuditChange] = Field(default_factory=list)
    reason: str | None = None
    timestamp: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "case_audit"
        indexes = [IndexModel("case_id")]

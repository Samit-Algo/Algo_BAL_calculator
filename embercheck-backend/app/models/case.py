# The Case document (Phase 1).
#
# A Case is one user's saved assessment for one property: the property context,
# the FULL /assess response stored as-is, a couple of denormalised fields for
# fast dashboard listing, any capture photos, and a workflow status. Capture
# wiring and the assessor hand-off are later steps - this just defines the shape.

from datetime import datetime, timezone
from enum import Enum

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel


class CaseStatus(str, Enum):
    """Where a case sits in the consumer -> assessor workflow."""

    DRAFT = "DRAFT"
    ANALYSIS_COMPLETE = "ANALYSIS_COMPLETE"
    SUBMITTED_TO_ASSESSOR = "SUBMITTED_TO_ASSESSOR"
    UNDER_REVIEW = "UNDER_REVIEW"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
    SITE_VISIT_REQUIRED = "SITE_VISIT_REQUIRED"
    REFERRED_SPECIALIST = "REFERRED_SPECIALIST"
    APPROVED = "APPROVED"
    COMPLETE = "COMPLETE"


class PropertyInfo(BaseModel):
    """The property a case is about. Mirrors the address/coords/LGA the
    assessment pipeline resolves, plus an optional drawn boundary."""

    address: str
    matched_address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    lga: str | None = None
    boundary_polygon: list = Field(default_factory=list)


class CasePhoto(BaseModel):
    """One captured photo attached to a case. Shape only for now - the capture
    upload + VLM wiring lands in a later step."""

    direction: str
    file_path: str | None = None
    captured_at: datetime | None = None
    vlm_result: dict | None = None
    metadata: dict | None = None


class Case(Document):
    """A saved assessment owned by a user."""

    user_id: PydanticObjectId  # references User.id (indexed)
    property: PropertyInfo

    # The FULL /assess response dict, stored verbatim - do NOT re-derive
    # sub-fields from it. The two fields below are denormalised copies kept only
    # for fast dashboard listing without unpacking the whole assessment.
    assessment: dict | None = None
    bal_rating: str | None = None
    governing_direction: str | None = None

    photos: list[CasePhoto] = Field(default_factory=list)
    status: CaseStatus = CaseStatus.DRAFT

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Set when the case is submitted for accredited assessment (Step 5b-i).
    submitted_at: datetime | None = None

    class Settings:
        name = "cases"
        indexes = [
            IndexModel("user_id"),
            IndexModel("status"),
        ]

# The Case document (Phase 1).
#
# A Case is one user's saved assessment for one property: the property context,
# the FULL /assess response stored as-is, a couple of denormalised fields for
# fast dashboard listing, any capture photos, and a workflow status. Capture
# wiring and the assessor hand-off are later steps - this just defines the shape.

import uuid
from datetime import datetime, timezone
from enum import Enum

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field, model_validator
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


class AiVegetationProposal(BaseModel):
    """AI-proposed vegetation classification for one boundary photo."""

    vegetation_class: str
    exclusion: bool
    confidence: float
    model_version: str
    # The VLM's own one-sentence explanation for this read (canopy/structure it
    # saw and why it fits the class). None for photos that errored before the
    # VLM responded (e.g. no API key, bad image).
    reasoning: str | None = None


class SectorPhoto(BaseModel):
    """One photo captured for a compass side of the site boundary."""

    photo_id: str = Field(default_factory=lambda: uuid.uuid4().hex)
    file_path: str
    captured_at: datetime
    ai_proposal: AiVegetationProposal | None = None
    metadata: dict = Field(default_factory=dict)

    @model_validator(mode="before")
    @classmethod
    def _backfill_photo_id(cls, data):
        if isinstance(data, dict) and not data.get("photo_id"):
            data["photo_id"] = uuid.uuid4().hex
        return data


class SectorOverrides(BaseModel):
    """Per-side overrides: vegetation class, distance, and slope. No FDI -
    that stays site-level. slope_direction ("downslope"|"upslope"|"flat") is
    kept alongside effective_slope_degrees for display/audit - AS 3959 only
    the downslope angle is non-zero; upslope/flat both band as 0 degrees."""

    vegetation_class: str | None = None
    distance_m: float | None = None
    effective_slope_degrees: float | None = None
    slope_direction: str | None = None
    override_by: str | None = None
    override_at: datetime | None = None


class SectorEvidence(BaseModel):
    """Per-compass-side evidence layer for the boundary redesign. Preserves
    each classification layer separately: GIS draft, photo-combined, assessor
    override, and the resulting BAL."""

    compass_side: str
    gis_draft_classification: str | None = None
    photos: list[SectorPhoto] = Field(default_factory=list)
    combined_classification: str | None = None
    combined_confidence: float | None = None
    # The governing photo's VLM reasoning - whichever proposal's classification
    # drove combined_classification, so the UI can show why the AI read the
    # side the way it did, not just the resulting class.
    combined_reasoning: str | None = None
    overrides: SectorOverrides | None = None
    review_flags: list[str] = Field(default_factory=list)
    final_bal: str | None = None
    analysis_status: str | None = None


class Case(Document):
    """A saved assessment owned by a user."""

    user_id: PydanticObjectId  # references User.id (indexed)
    property: PropertyInfo

    # The FULL /assess response dict, stored verbatim - do NOT re-derive
    # sub-fields from it. This is the DEFAULT (centre-point) read, optionally
    # sharpened in place by the photo step. The two denormalised fields below are
    # the WORST read across assessment + boundary_assessment (safety: the
    # headline must never sit below any stored read), kept for fast listing.
    assessment: dict | None = None
    # The boundary (site-edge) read, stored separately so it coexists with the
    # point/photo read on ONE case instead of overwriting it. Set/updated by the
    # boundary endpoints; left None for a point-only case.
    boundary_assessment: dict | None = None
    bal_rating: str | None = None
    governing_direction: str | None = None

    # Per-compass-side evidence: photos, AI proposals, assessor overrides, and
    # the final BAL per side. None until the boundary redesign populates it.
    sector_evidence: list[SectorEvidence] | None = None

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

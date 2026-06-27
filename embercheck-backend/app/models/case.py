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
    # The assessor review lifecycle (CONSOLE-B3.2). NEEDS_MORE_PHOTOS supersedes
    # the legacy CHANGES_REQUESTED; READY_TO_SIGN supersedes APPROVED. Both legacy
    # values are kept below for back-compat with any already-stored cases.
    NEEDS_MORE_PHOTOS = "NEEDS_MORE_PHOTOS"
    SITE_VISIT_REQUIRED = "SITE_VISIT_REQUIRED"
    REFERRED_SPECIALIST = "REFERRED_SPECIALIST"
    READY_TO_SIGN = "READY_TO_SIGN"
    CHANGES_REQUESTED = "CHANGES_REQUESTED"
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
    # Per-side FDI override (assessor/console surface only). FDI is site-level by
    # AS 3959, so this is the deliberate console exception — used only to recompute
    # THIS side's BAL band. None = use the site/LGA FDI.
    fire_danger_index: int | None = None
    # The typed justification the assessor must supply for any override (console
    # surface). Mandatory whenever an override exists; part of the audit record.
    reason: str | None = None
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
    # Assessor review state (console). reviewed=True once an assessor has confirmed
    # or overridden this side; reviewed_by/at record who/when.
    reviewed: bool = False
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None

    def invalidate_review(self) -> bool:
        """Drop any prior assessor review of this side and report whether one was
        cleared.

        An assessor's review (confirm/override) attests to a SPECIFIC state of the
        side's evidence. The moment that evidence changes underneath them — new or
        deleted photos, a consumer override, a re-assessed boundary draft — the
        attestation is stale and the side MUST be re-reviewed before sign-off.

        This is the single source of that rule: every consumer-side mutation of a
        side's evidence calls it, so the Console's Confirm action re-enables and the
        derived review_progress / checklist / sign-off blockers reflect reality
        instead of a confirmation that no longer matches what's on the case.
        """
        if not (self.reviewed or self.reviewed_by or self.reviewed_at):
            return False
        self.reviewed = False
        self.reviewed_by = None
        self.reviewed_at = None
        return True


class Signoff(BaseModel):
    """The frozen record of an assessor signing a case (P0 sign-off).

    Once a case is signed it becomes a legal artifact: the determination is
    SNAPSHOTTED here so the issued certificate can never drift if the live case
    is somehow edited afterwards. The case is also locked to edits while COMPLETE
    (see the console write routes), so in practice the snapshot and the live case
    stay in agreement — the snapshot is the belt-and-braces guarantee.
    """

    report_number: str  # e.g. EC-<caseid8>-<YYYYMMDD>-<seq>
    signed_by_assessor_id: PydanticObjectId
    assessor_name: str | None = None
    accreditation_number: str | None = None
    accreditation_level: str | None = None
    jurisdiction: str | None = None
    signed_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    # Frozen headline + per-side rows at the moment of signing.
    bal_rating: str | None = None
    governing_direction: str | None = None
    determination: list[dict] = Field(default_factory=list)

    # The exact attestation text the assessor agreed to (audit-grade).
    attestation: str | None = None
    # Relative path (under PHOTO_STORAGE_DIR) to the rendered PDF on disk.
    report_path: str


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

    # Assessor review workflow (CONSOLE-B3.2). The CURRENT review reason the
    # consumer sees (e.g. why more photos / a site visit are needed). The full,
    # immutable history of every reason lives in CaseAuditEvent — this is only the
    # latest, so the consumer-facing case read has something to display. Cleared
    # when the assessor resumes review (back to UNDER_REVIEW) or marks ready to sign.
    review_reason: str | None = None
    # The compass sides the assessor asked the consumer to re-photograph (only
    # meaningful while status == NEEDS_MORE_PHOTOS). Empty = "any/all sides".
    photo_request_sides: list[str] = Field(default_factory=list)

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    # Set when the case is submitted for accredited assessment (Step 5b-i).
    submitted_at: datetime | None = None

    # Assignment (Phase 5). The assessor (User.id) the consumer chose to review
    # this case, set on submit. None = unassigned: legacy/global behaviour where
    # any in-jurisdiction assessor could see it (dual-read, so pre-assignment
    # cases keep working). assigned_at records when the choice was made.
    assigned_assessor_id: PydanticObjectId | None = None
    assigned_at: datetime | None = None

    # The frozen sign-off record once an assessor signs the case (status COMPLETE).
    # None until signed. The rendered PDF lives on disk at signoff.report_path.
    signoff: Signoff | None = None

    class Settings:
        name = "cases"
        indexes = [
            IndexModel("user_id"),
            IndexModel("status"),
            IndexModel("assigned_assessor_id"),
        ]

# The AssessorProfile document (Phase 1, Step 2).
#
# One profile per assessor user (1:1 with User, enforced by the unique user_id
# index). This is the durable record of an assessor's identity, accreditation,
# insurance, service area and capacity - everything beyond the two bare fields
# (role, jurisdiction) that currently live on User.
#
# Additive only: nothing reads this collection yet. A backfilled profile carries
# just user_id + status (+ maybe a jurisdiction-derived state later), so EVERY
# field except user_id and status is optional/defaulted and a minimal profile is
# valid. Routes, the registration flow, admin queue and proximity search land in
# later phases.

from datetime import datetime, timezone
from enum import Enum

from beanie import Document, PydanticObjectId
from pydantic import BaseModel, Field
from pymongo import IndexModel


class AssessorStatus(str, Enum):
    """Where an assessor sits in the approval lifecycle. Mirrors the CaseStatus
    str-Enum house style. Defaults to PENDING (the conservative state) so a
    freshly created profile is never treated as approved by accident."""

    PENDING = "PENDING"
    APPROVED = "APPROVED"
    REJECTED = "REJECTED"
    SUSPENDED = "SUSPENDED"
    INACTIVE = "INACTIVE"


class AssessorDocument(BaseModel):
    """One uploaded supporting document (accreditation certificate, insurance
    certificate, identity, profile photo). Mirrors SectorPhoto: the bytes live on
    disk under PHOTO_STORAGE_DIR and only the RELATIVE path is stored here, never
    the file contents."""

    file_path: str  # relative path under PHOTO_STORAGE_DIR
    doc_type: str  # "accreditation" | "insurance" | "identity" | "profile_photo"
    uploaded_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class GeoPoint(BaseModel):
    """A location in canonical GeoJSON Point form. Coordinates are stored in
    [longitude, latitude] order - the order MongoDB's geospatial queries require.
    The 2dsphere index over base_location is deferred to Phase 4 (the $geoNear
    proximity search that exercises it lands there too); for now this is just the
    stored shape."""

    type: str = "Point"
    coordinates: list[float]  # [lng, lat]


class AssessorProfile(Document):
    """An assessor's full profile (1:1 with User). Only user_id and status are
    required; every other field is optional/defaulted so a minimal backfilled
    profile (status + maybe jurisdiction-derived data) is valid."""

    user_id: PydanticObjectId  # references User.id (unique 1:1)
    status: AssessorStatus = AssessorStatus.PENDING

    # Personal identity.
    legal_first_name: str | None = None
    legal_last_name: str | None = None
    date_of_birth: datetime | None = None

    # Contact (email lives on User).
    phone: str | None = None

    # Business.
    business_name: str | None = None
    trading_name: str | None = None
    abn: str | None = None

    # Accreditation.
    accreditation_number: str | None = None
    accreditation_level: str | None = None
    accreditation_expiry: datetime | None = None
    qualification: str | None = None

    # Geographic service area. base_location is stored as GeoJSON now; its
    # 2dsphere index + $geoNear search are deferred to Phase 4.
    operating_states: list[str] = Field(default_factory=list)
    operating_lgas: list[str] = Field(default_factory=list)
    # The business/base address the assessor types in. Geocoded to base_location
    # in Phase 4; until then base_location stays None.
    base_address: str | None = None
    base_location: GeoPoint | None = None
    service_radius_km: float | None = None

    # Insurance.
    insurer: str | None = None
    insurance_policy_number: str | None = None
    insurance_expiry: datetime | None = None

    # Capacity. 20 is a starting value to tune; capacity is only enforced in
    # Phase 6, so nothing reads max_active_jobs yet.
    max_active_jobs: int = 20
    accepting_new_work: bool = True

    # Supporting documents (relative file_path refs only - see AssessorDocument).
    documents: list[AssessorDocument] = Field(default_factory=list)

    # Reason captured on reject/suspend/needs-info; surfaced by the admin queue
    # in a later phase.
    review_reason: str | None = None

    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))

    class Settings:
        name = "assessor_profiles"
        indexes = [
            IndexModel("user_id", unique=True),  # enforce 1:1 with User
            IndexModel("status"),  # cheap, used by the admin queue later
            IndexModel("operating_lgas"),  # multikey, used by search later (NOT geospatial)
        ]

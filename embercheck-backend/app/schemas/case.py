# API schemas for the Case endpoints (Phase 1, Step 3a + 5b-i).
#
# CaseCreateRequest mirrors the public /assess inputs (the server re-runs the
# SAME pipeline). CaseRead is the stored case as returned to its owner;
# CaseSummary is the light shape used by the dashboard list.

from datetime import datetime

from pydantic import BaseModel

from app.cases.service import governing_vegetation
from app.models.case import CasePhoto, CaseStatus, PropertyInfo


class CaseCreateRequest(BaseModel):
    """Create a case by running an assessment server-side. Mirrors the public
    AssessmentRequest inputs so the result is identical to /assess."""

    address: str

    # Optional GeoJSON site boundary (Polygon or Feature), mirroring
    # AssessmentRequest.site_polygon. When given, distances are measured from the
    # boundary edge exactly as the public boundary mode does.
    boundary_polygon: dict | None = None

    # Same optional overrides /assess accepts.
    fire_danger_override: int | None = None
    slope_override: float | None = None


class CaseRead(BaseModel):
    """A case as returned to its owner."""

    id: str
    status: CaseStatus
    property: PropertyInfo
    assessment: dict | None = None
    bal_rating: str | None = None
    governing_direction: str | None = None
    # Derived on read from the governing side's per_direction entry (e.g.
    # "Woodland"), so the detail view doesn't show the top-level "Not classified".
    governing_vegetation: str | None = None
    photos: list[CasePhoto] = []
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None = None

    @classmethod
    def from_case(cls, case) -> "CaseRead":
        return cls(
            id=str(case.id),
            status=case.status,
            property=case.property,
            assessment=case.assessment,
            bal_rating=case.bal_rating,
            governing_direction=case.governing_direction,
            governing_vegetation=governing_vegetation(case),
            photos=case.photos,
            created_at=case.created_at,
            updated_at=case.updated_at,
            submitted_at=case.submitted_at,
        )


class CaseSummary(BaseModel):
    """Light list item for the dashboard — no full assessment dict."""

    id: str
    address: str
    bal_rating: str | None = None
    governing_direction: str | None = None
    governing_vegetation: str | None = None
    status: CaseStatus
    created_at: datetime
    updated_at: datetime
    submitted_at: datetime | None = None

    @classmethod
    def from_case(cls, case) -> "CaseSummary":
        prop = case.property
        return cls(
            id=str(case.id),
            address=prop.matched_address or prop.address,
            bal_rating=case.bal_rating,
            governing_direction=case.governing_direction,
            governing_vegetation=governing_vegetation(case),
            status=case.status,
            created_at=case.created_at,
            updated_at=case.updated_at,
            submitted_at=case.submitted_at,
        )

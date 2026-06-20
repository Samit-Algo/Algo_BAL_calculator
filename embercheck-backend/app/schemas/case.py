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
    # AssessmentRequest.site_polygon. When given, the case is created with a
    # BOUNDARY read only (stored in boundary_assessment) and no separate point
    # run, to avoid double-running the pipeline on a boundary save.
    boundary_polygon: dict | None = None

    # Only meaningful alongside boundary_polygon: also run point mode and store it
    # in `assessment`. Default False — a boundary save skips the extra point run
    # (the live screen already has the public point read).
    include_point: bool = False

    # Same optional overrides /assess accepts.
    fire_danger_override: int | None = None
    slope_override: float | None = None


class BoundaryUpdateRequest(BaseModel):
    """Run/replace the BOUNDARY read on an existing case in place. Used by
    PUT /cases/{id}/boundary so an edited polygon updates the same case instead
    of inserting a duplicate. The point/photo read (`assessment`) is untouched."""

    # GeoJSON site boundary (Polygon or Feature). Required - this endpoint exists
    # to (re)assess from the edge.
    boundary_polygon: dict

    fire_danger_override: int | None = None
    slope_override: float | None = None


class CaseRead(BaseModel):
    """A case as returned to its owner."""

    id: str
    status: CaseStatus
    property: PropertyInfo
    assessment: dict | None = None
    # The boundary (site-edge) read, returned alongside the point/photo read so
    # the client can render both on one property page. None for a point-only case.
    boundary_assessment: dict | None = None
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
            boundary_assessment=case.boundary_assessment,
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
    # Whether this case carries a saved boundary read, so the dashboard card can
    # badge it without shipping the full assessment dict.
    has_boundary: bool = False
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
            has_boundary=bool(case.boundary_assessment),
            status=case.status,
            created_at=case.created_at,
            updated_at=case.updated_at,
            submitted_at=case.submitted_at,
        )

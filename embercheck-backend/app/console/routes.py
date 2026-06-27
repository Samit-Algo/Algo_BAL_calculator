# Assessor Console routes (CONSOLE-B1) - mounted under /console, EVERY route
# guarded by current_assessor (401 no token / 403 non-assessor / 200 assessor).
#
# Two endpoints:
#   GET /console/me        -> a cheap gate check (who am I, am I an assessor)
#   GET /console/worklist  -> the assessor's inbox: submitted-and-later cases,
#                             scoped to the assessor's jurisdiction, every row
#                             field DERIVED ON READ (nothing denormalised/stored).
#
# This module only READS Case + User documents the consumer flow already wrote;
# it never runs the assessment pipeline or mutates a case.

from datetime import datetime, timedelta, timezone
from pathlib import Path

from beanie import PydanticObjectId
from beanie.operators import In
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth.backend import current_assessor
from app.cases.service import COMPASS_SIDES, _transect_worse_than
from app.config import settings as media_settings
from app.models.assessor_profile import AssessorProfile
from app.models.audit import AuditChange, CaseAuditEvent
from app.models.case import Case, CaseStatus, SectorEvidence, SectorOverrides, Signoff
from app.models.user import User
from app.services.assessment_pipeline import BAL_SEVERITY, reconcile_sector_bal
from app.services.report_pdf import DeterminationRow, ReportContext, render_report_pdf

router = APIRouter(prefix="/console", tags=["console"])


# ⚠️ TEMP (testing) — show DRAFT / ANALYSIS_COMPLETE in the Console too.
# Flip this to False (or delete it and the block below) to restore the real
# behaviour: assessors only see SUBMITTED_TO_ASSESSOR and later review states.
# While True, unsubmitted (draft) cases also appear in the worklist AND are
# openable in the workspace/photo-review (the single-case gate reuses this list).
_SHOW_DRAFTS_FOR_TESTING = False

# Statuses that belong in an assessor's inbox: SUBMITTED_TO_ASSESSOR and every
# later review state. DRAFT / ANALYSIS_COMPLETE (still consumer-side, not yet
# submitted) are deliberately excluded — except under the TEMP flag above.
WORKLIST_STATUSES: list[CaseStatus] = [
    CaseStatus.SUBMITTED_TO_ASSESSOR,
    CaseStatus.UNDER_REVIEW,
    CaseStatus.NEEDS_MORE_PHOTOS,
    CaseStatus.SITE_VISIT_REQUIRED,
    CaseStatus.REFERRED_SPECIALIST,
    CaseStatus.READY_TO_SIGN,
    CaseStatus.CHANGES_REQUESTED,  # legacy alias of NEEDS_MORE_PHOTOS
    CaseStatus.APPROVED,  # legacy alias of READY_TO_SIGN
    CaseStatus.COMPLETE,
]
if _SHOW_DRAFTS_FOR_TESTING:  # TEMP
    WORKLIST_STATUSES = [CaseStatus.DRAFT, CaseStatus.ANALYSIS_COMPLETE, *WORKLIST_STATUSES]

# CaseStatus -> a coarse UI state the Console renders/filters by. A simple,
# stable mapping (the ?state= filter matches against these values). Site visit and
# specialist get their own UI states so the worklist can split those tabs.
_UI_STATE_BY_STATUS: dict[CaseStatus, str] = {
    CaseStatus.DRAFT: "draft",  # TEMP (testing) — chip reads "Draft ready"
    CaseStatus.ANALYSIS_COMPLETE: "in-review",  # TEMP (testing)
    CaseStatus.SUBMITTED_TO_ASSESSOR: "in-review",
    CaseStatus.UNDER_REVIEW: "in-review",
    CaseStatus.NEEDS_MORE_PHOTOS: "needs-photos",
    CaseStatus.CHANGES_REQUESTED: "needs-photos",
    CaseStatus.SITE_VISIT_REQUIRED: "site-visit",
    CaseStatus.REFERRED_SPECIALIST: "specialist",
    CaseStatus.READY_TO_SIGN: "ready-to-sign",
    CaseStatus.APPROVED: "ready-to-sign",
    CaseStatus.COMPLETE: "signed",
}

# Fixed placeholder SLA window until a real due-date policy exists.
SLA_BUSINESS_DAYS = 5

PHOTOS_TOTAL = 4


class ConsoleMe(BaseModel):
    """Cheap gate-check identity for the logged-in assessor."""

    id: str
    email: str
    name: str | None = None
    role: str
    jurisdiction: str | None = None


class WorklistRow(BaseModel):
    """One inbox row. Every field is derived on read from the Case (+ owning
    User); nothing here is stored back on the case."""

    id: str
    job_number: str
    client_name: str | None = None
    address: str
    state: str | None = None
    flags: int
    photos_done: int
    photos_total: int = PHOTOS_TOTAL
    bal_rating: str | None = None
    governing_direction: str | None = None
    submitted_at: datetime | None = None
    due: datetime | None = None
    # The UI state this row maps to (also what ?state= filters on), surfaced so
    # the client doesn't have to re-derive the mapping.
    ui_state: str
    # Open case-level requests blocking sign-off (site visit / specialist / awaiting
    # photos) as short labels — the worklist row badges these until cleared (§6).
    outstanding: list[str] = []


def _ui_state(status: CaseStatus) -> str:
    return _UI_STATE_BY_STATUS.get(status, "in-review")


def _job_number(case_id: PydanticObjectId) -> str:
    """Stable, deterministic per case - derived from the ObjectId so it's the
    same across calls without storing anything (e.g. "EC-A1B2C3")."""
    return "EC-" + str(case_id)[-6:].upper()


def _derive_state(case: Case) -> str | None:
    """The case's jurisdiction key. EmberCheck's data sources are all NSW, so a
    case is "NSW" when its address says so (or it resolved an NSW LGA). Kept as a
    derived helper so a future multi-state build has one place to change."""
    text = " ".join(
        part for part in (case.property.matched_address, case.property.address) if part
    ).upper()
    if "NSW" in text:
        return "NSW"
    if case.property.lga:  # every LGA in our reference data is NSW
        return "NSW"
    return None


def _flags_count(case: Case) -> int:
    """Total review_flags across every side's evidence."""
    if not case.sector_evidence:
        return 0
    return sum(len(ev.review_flags or []) for ev in case.sector_evidence)


def _photos_done(case: Case) -> int:
    """How many of the 4 compass sides have at least one photo."""
    if not case.sector_evidence:
        return 0
    return sum(1 for ev in case.sector_evidence if ev.photos)


def _add_business_days(start: datetime, days: int) -> datetime:
    """start + `days` business days (skip Sat/Sun). Used for the placeholder due
    date; weekends don't count toward the SLA window."""
    result = start
    added = 0
    while added < days:
        result += timedelta(days=1)
        if result.weekday() < 5:  # Mon-Fri
            added += 1
    return result


@router.get("/me", response_model=ConsoleMe)
async def console_me(assessor: User = Depends(current_assessor)) -> ConsoleMe:
    """Cheap gate check: returns the assessor's identity. Reaching a 200 here at
    all proves the token is valid AND the user is an assessor."""
    return ConsoleMe(
        id=str(assessor.id),
        email=assessor.email,
        name=assessor.name,
        role=assessor.role,
        jurisdiction=assessor.jurisdiction,
    )


@router.get("/worklist", response_model=list[WorklistRow])
async def console_worklist(
    state: str | None = None,
    assessor: User = Depends(current_assessor),
) -> list[WorklistRow]:
    """The assessor's inbox: submitted-and-later cases, scoped to the assessor's
    jurisdiction, newest-submitted first. Optional ?state= filters by the mapped
    UI state. All row fields are derived on read - nothing is denormalised."""
    cases = await Case.find(In(Case.status, WORKLIST_STATUSES)).to_list()

    # Jurisdiction scope: an assessor with a jurisdiction only sees cases in it;
    # an assessor with none set sees every submitted case (no restriction).
    if assessor.jurisdiction:
        cases = [c for c in cases if _derive_state(c) == assessor.jurisdiction]

    # Assignment scope (Phase 5): an assessor sees cases ASSIGNED to them, plus any
    # UNASSIGNED case (assigned_assessor_id is None) for legacy/global back-compat
    # (dual-read — cases submitted before assignment existed still surface).
    cases = [
        c for c in cases
        if c.assigned_assessor_id is None or c.assigned_assessor_id == assessor.id
    ]

    # client_name: look up the owning users in one batch (by case.user_id).
    user_ids = {c.user_id for c in cases}
    name_by_id: dict[PydanticObjectId, str | None] = {}
    if user_ids:
        owners = await User.find(In(User.id, list(user_ids))).to_list()
        name_by_id = {u.id: u.name for u in owners}

    rows: list[WorklistRow] = []
    for case in cases:
        ui = _ui_state(case.status)
        if state and ui != state:
            continue
        due = (
            _add_business_days(case.submitted_at, SLA_BUSINESS_DAYS)
            if case.submitted_at
            else None
        )
        rows.append(
            WorklistRow(
                id=str(case.id),
                job_number=_job_number(case.id),
                client_name=name_by_id.get(case.user_id),
                address=case.property.matched_address or case.property.address,
                state=_derive_state(case),
                flags=_flags_count(case),
                photos_done=_photos_done(case),
                bal_rating=case.bal_rating,
                governing_direction=case.governing_direction,
                submitted_at=case.submitted_at,
                due=due,
                ui_state=ui,
                outstanding=_outstanding_requests(case),
            )
        )

    # Newest-submitted first; a missing submitted_at sorts last. Keyed on a
    # numeric timestamp so naive (Mongo) and any aware datetimes never get
    # compared against each other (or against None) and raise.
    def _sort_key(r: WorklistRow) -> float:
        return r.submitted_at.timestamp() if r.submitted_at else float("-inf")

    rows.sort(key=_sort_key, reverse=True)
    return rows


# ─────────────────────────────────────────────────────────────────────────────
# CONSOLE-B2: single full case read for the assessor workspace (read-only).
# ─────────────────────────────────────────────────────────────────────────────


def _side_governing_transects(boundary_assessment: dict | None) -> dict[str, dict | None]:
    """For each compass side, the governing (worst) boundary transect — the SAME
    grouping `build_or_merge_sector_evidence` uses (group by `outward_direction`,
    pick the worst via `_transect_worse_than`). Used here only to READ the side's
    GIS/DEM-derived distance & slope (sector_evidence stores the class, not the
    geometry)."""
    per_direction = (boundary_assessment or {}).get("per_direction") or []
    side_gov: dict[str, dict | None] = {side: None for side in COMPASS_SIDES}
    for transect in per_direction:
        side = transect.get("outward_direction") or transect.get("direction")
        if side not in side_gov:
            continue
        best = side_gov[side]
        if best is None or _transect_worse_than(transect, best):
            side_gov[side] = transect
    return side_gov


def _normalize_side(value: str | None) -> str | None:
    """Map any-case compass token to the canonical "North"/"East"/… spelling."""
    if not value:
        return None
    return {s.lower(): s for s in COMPASS_SIDES}.get(value.lower())


def _compass_side_for_direction(read: dict | None, direction: str) -> str | None:
    """Find the per_direction entry whose `direction` matches and return its
    stable compass side (`outward_direction`). The one place the T0x → side
    mapping happens."""
    for transect in (read or {}).get("per_direction") or []:
        if str(transect.get("direction", "")).lower() == direction.lower():
            return transect.get("outward_direction") or transect.get("direction")
    return None


def governing_compass_side(case: Case) -> str | None:
    """Map the case's governing_direction (a transect label like "T02" in
    boundary mode, or already a compass side in point mode) to its STABLE compass
    side (North/East/South/West). The raw governing_direction is left untouched;
    this is the assessor-facing value (fixes the T0x wart). Reusable helper."""
    direction = case.governing_direction
    if not direction:
        return None
    # Point mode already names a compass side.
    canonical = _normalize_side(direction)
    if canonical:
        return canonical
    # Boundary mode: resolve the transect via whichever read carries it.
    for read in (case.boundary_assessment, case.assessment):
        side = _compass_side_for_direction(read, direction)
        if side:
            return _normalize_side(side) or side
    return None


class AssessorAiProposal(BaseModel):
    vegetation_class: str
    exclusion: bool
    confidence: float
    model_version: str
    reasoning: str | None = None


class AssessorSectorPhoto(BaseModel):
    photo_id: str
    captured_at: datetime | None = None
    ai_proposal: AssessorAiProposal | None = None


class ValueSources(BaseModel):
    """Simple provenance labels for the workspace UI."""

    vegetation: str  # "photo" | "gis_draft" | "override"
    distance: str  # "gis" | "override"
    slope: str  # "dem" | "override"


class AssessorSector(BaseModel):
    compass_side: str
    gis_draft_classification: str | None = None
    distance_m: float | None = None
    effective_slope_degrees: float | None = None
    slope_direction: str | None = None
    photos: list[AssessorSectorPhoto] = []
    combined_classification: str | None = None
    combined_confidence: float | None = None
    combined_reasoning: str | None = None
    overrides: SectorOverrides | None = None
    review_flags: list[str] = []
    final_bal: str | None = None
    analysis_status: str | None = None
    value_sources: ValueSources
    # Assessor review state (console write path).
    reviewed: bool = False
    reviewed_by: str | None = None
    reviewed_at: datetime | None = None
    # The resolved class actually driving final_bal: override > combined > draft.
    effective_classification: str | None = None


class AssessorProperty(BaseModel):
    address: str
    matched_address: str | None = None
    latitude: float | None = None
    longitude: float | None = None
    lga: str | None = None
    state: str | None = None


class AuditEvent(BaseModel):
    """One derived audit-trail entry. `kind` drives the icon/colour
    (derive/photo/flag/submit/confirm/override/sign); `actor` the attribution
    (System / Owner capture / the client). Reconstructed on read from stored
    facts — there is no audit-event store yet."""

    timestamp: datetime | None = None
    actor: str
    kind: str
    text: str


class AssessorCaseRead(BaseModel):
    """The full case as the assessor workspace needs it. Everything is derived on
    read from the stored case; nothing is denormalised or mutated."""

    id: str
    job_number: str
    client_name: str | None = None
    property: AssessorProperty
    status: CaseStatus
    ui_state: str
    # The CURRENT review reason (latest status-change reason) + the sides a
    # NEEDS_MORE_PHOTOS request named. History lives in the audit trail.
    review_reason: str | None = None
    photo_request_sides: list[str] = []
    # Whether READY_TO_SIGN is allowed right now, and if not, why — so the
    # workspace can disable/explain without re-deriving the rule (§8, no dup logic).
    can_ready_to_sign: bool = False
    ready_to_sign_blockers: list[str] = []
    # CONSOLE-B3.3 review progress / outstanding checklist — all derived on read,
    # rendered verbatim by the frontend (§1/§2). review_progress is
    # {reviewed, total, percent}; review_checklist is [{key, complete, label}].
    review_progress: dict = {}
    remaining_reviews: list[str] = []
    review_checklist: list[dict] = []
    outstanding_requests: list[str] = []
    bal_rating: str | None = None
    governing_direction: str | None = None
    governing_compass_side: str | None = None
    submitted_at: datetime | None = None
    due: datetime | None = None
    # True when this case carries a boundary read (4 real sectors); False for a
    # point-only case (the 4 sectors come back as empty placeholders).
    has_boundary: bool
    sectors: list[AssessorSector]
    # When the case was first assembled (drives the audit trail's first entry +
    # the report date).
    created_at: datetime
    # A chronological, DERIVED audit trail (see build_case_audit) — read-only.
    audit: list[AuditEvent] = []
    # The map geometry (property_point, vegetation FeatureCollection, rings,
    # distance_line, site_polygon) — the SAME object the consumer map draws from,
    # surfaced verbatim so the Console can render the identical map. Read-only;
    # None for a point-only case with no boundary geometry.
    geometry: dict | None = None
    # The boundary transects (per_direction), passed through so the map can draw
    # per-side BAL chips where boundary sample points are present.
    transects: list | None = None
    # The sign-off summary once the case is signed (status COMPLETE) — drives the
    # Report tab's issued state + download. None until signed.
    signoff: dict | None = None


async def _get_in_scope_case_or_404(case_id: str, assessor: User) -> Case:
    """Load a case the assessor is allowed to see, else 404. A malformed/unknown
    id, a case NOT yet submitted (still DRAFT/ANALYSIS_COMPLETE), and a case
    outside the assessor's jurisdiction all return the SAME 404 — mirroring the
    consumer ownership rule, we never reveal a case exists for someone else."""
    try:
        oid = PydanticObjectId(case_id)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")

    case = await Case.get(oid)
    if case is None or case.status not in WORKLIST_STATUSES:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
    if assessor.jurisdiction and _derive_state(case) != assessor.jurisdiction:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
    # Assignment scope (Phase 5): a case assigned to a DIFFERENT assessor is 404
    # to this one (never reveal it). Unassigned (None) stays visible — dual-read.
    if case.assigned_assessor_id is not None and case.assigned_assessor_id != assessor.id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
    return case


def _build_sector(side: str, ev, governing_transect: dict | None) -> AssessorSector:
    """Assemble one compass side from its sector_evidence (class/photos/overrides)
    + its governing boundary transect (GIS distance & DEM slope). `ev` may be None
    (point-only case) → all evidence fields null/empty."""
    overrides = ev.overrides if ev else None
    gov = governing_transect or {}

    # GIS/DEM geometry comes from the governing transect; distance only counts
    # when that transect actually found vegetation.
    gis_distance = gov.get("distance_m") if gov.get("vegetation_found") else None
    gis_slope = gov.get("effective_slope_degrees")
    gis_slope_dir = gov.get("slope_direction")

    # Effective value = override when set, else the GIS/DEM value. value_sources
    # records which (no overrides exist yet, so today these read gis/dem).
    if overrides and overrides.distance_m is not None:
        distance_m, distance_src = overrides.distance_m, "override"
    else:
        distance_m, distance_src = gis_distance, "gis"

    if overrides and overrides.effective_slope_degrees is not None:
        slope_deg = overrides.effective_slope_degrees
        slope_dir = overrides.slope_direction or gis_slope_dir
        slope_src = "override"
    else:
        slope_deg, slope_dir, slope_src = gis_slope, gis_slope_dir, "dem"

    combined = ev.combined_classification if ev else None
    if overrides and overrides.vegetation_class is not None:
        veg_src = "override"
    elif combined:
        veg_src = "photo"
    else:
        veg_src = "gis_draft"

    photos = [
        AssessorSectorPhoto(
            photo_id=p.photo_id,
            captured_at=p.captured_at,
            ai_proposal=(
                AssessorAiProposal(**p.ai_proposal.model_dump()) if p.ai_proposal else None
            ),
        )
        for p in (ev.photos if ev else [])
    ]

    return AssessorSector(
        compass_side=side,
        gis_draft_classification=ev.gis_draft_classification if ev else None,
        distance_m=distance_m,
        effective_slope_degrees=slope_deg,
        slope_direction=slope_dir,
        photos=photos,
        combined_classification=combined,
        combined_confidence=ev.combined_confidence if ev else None,
        combined_reasoning=ev.combined_reasoning if ev else None,
        overrides=overrides,
        review_flags=(ev.review_flags if ev else []) or [],
        final_bal=ev.final_bal if ev else None,
        analysis_status=ev.analysis_status if ev else None,
        value_sources=ValueSources(
            vegetation=veg_src, distance=distance_src, slope=slope_src
        ),
        reviewed=bool(ev.reviewed) if ev else False,
        reviewed_by=ev.reviewed_by if ev else None,
        reviewed_at=ev.reviewed_at if ev else None,
        effective_classification=(
            (overrides.vegetation_class if overrides else None) or combined or (ev.gis_draft_classification if ev else None)
        ),
    )


def _conf_band(confidence: float | None) -> str:
    """0–1 confidence → the same discrete band the UI shows. 0.7 is the safety
    threshold (below it the conservative value stands)."""
    if confidence is None:
        return "low"
    if confidence >= 0.7:
        return "high"
    if confidence >= 0.4:
        return "medium"
    return "low"


# Human label for each review status (audit text + report preview).
STATUS_LABELS: dict[str, str] = {
    "SUBMITTED_TO_ASSESSOR": "Submitted to assessor",
    "UNDER_REVIEW": "Under review",
    "NEEDS_MORE_PHOTOS": "Needs more photos",
    "SITE_VISIT_REQUIRED": "Site visit required",
    "REFERRED_SPECIALIST": "Referred to specialist",
    "READY_TO_SIGN": "Ready to sign",
    "CHANGES_REQUESTED": "Needs more photos",
    "APPROVED": "Ready to sign",
    "COMPLETE": "Signed · issued",
    "DRAFT": "Draft",
    "ANALYSIS_COMPLETE": "Analysis complete",
}


def _status_event_text(a: CaseAuditEvent) -> str:
    """Audit line for a case-level status change (kind="status")."""
    new = next((c.new for c in a.changes if c.field == "status"), None)
    sides = next((c.new for c in a.changes if c.field == "photo_request_sides"), None)
    if new == "NEEDS_MORE_PHOTOS":
        base = "Requested additional photos"
        base += f" ({sides})" if sides else ""
    elif new == "SITE_VISIT_REQUIRED":
        base = "Site visit requested"
    elif new == "REFERRED_SPECIALIST":
        base = "Referred to specialist"
    elif new == "READY_TO_SIGN":
        base = "Marked ready to sign"
    else:
        base = f"Case moved to {STATUS_LABELS.get(new, new or '—')}"
    base += "."
    return f"{base} Reason: {a.reason}" if a.reason else base


def _audit_event_text(a: CaseAuditEvent) -> str:
    """One-line description of a persisted assessor action for the trail."""
    if a.kind == "status":
        return _status_event_text(a)
    if a.kind == "auto_status":
        new = next((c.new for c in a.changes if c.field == "status"), None)
        return f"Status advanced automatically to {STATUS_LABELS.get(new, new or '—')}."
    if a.kind == "auto_resume":
        return "Consumer uploaded requested evidence. Case automatically returned to Under review."
    if a.kind == "confirm":
        return f"{a.compass_side} elevation confirmed by the assessor."
    if a.kind == "sign":
        report_no = next((c.new for c in a.changes if c.field == "report_number"), None)
        return (
            f"Determination signed and issued by the assessor"
            + (f" — report {report_no}." if report_no else ".")
        )
    if a.kind == "revert":
        parts = "; ".join(f"{c.field}: {c.previous or '—'} → {c.new or '—'}" for c in a.changes)
        base = (
            f"{a.compass_side} assessor override removed — reverted to the calculated value"
            + (f" ({parts})" if parts else "")
            + "."
        )
        return f"{base} Reason: {a.reason}" if a.reason else base
    parts = "; ".join(f"{c.field}: {c.previous or '—'} → {c.new or '—'}" for c in a.changes)
    base = f"{a.compass_side} overridden by the assessor — {parts}." if parts else f"{a.compass_side} overridden by the assessor."
    return f"{base} Reason: {a.reason}" if a.reason else base


def build_case_audit(
    case: Case,
    client_name: str | None,
    assessor_events: list[CaseAuditEvent] | None = None,
) -> list[AuditEvent]:
    """A chronological audit trail: the system-derived events reconstructed from
    the case's stored facts, MERGED with the persisted, append-only assessor
    actions (confirm/override). Ordered by timestamp; ties keep insertion order."""
    events: list[AuditEvent] = []

    events.append(AuditEvent(
        timestamp=case.created_at,
        actor="System",
        kind="derive",
        text="Draft assembled from public data — NSW SVTM vegetation, LiDAR DEM terrain, cadastre.",
    ))
    if case.boundary_assessment:
        events.append(AuditEvent(
            timestamp=case.created_at,
            actor="System",
            kind="derive",
            text="Boundary read computed — per-side BAL measured from the drawn site boundary.",
        ))

    for ev in case.sector_evidence or []:
        side = ev.compass_side
        # When the side's analysis ran isn't stored; anchor system events to the
        # side's latest photo capture (the analysis follows capture), else updated_at.
        capture_times = [p.captured_at for p in (ev.photos or []) if p.captured_at]
        side_time = max(capture_times) if capture_times else case.updated_at

        for p in ev.photos or []:
            events.append(AuditEvent(
                timestamp=p.captured_at or side_time,
                actor="Owner capture",
                kind="photo",
                text=f"Site photo received — {side} elevation.",
            ))
        if ev.analysis_status == "complete" and ev.combined_classification:
            events.append(AuditEvent(
                timestamp=side_time,
                actor="System",
                kind="derive",
                text=(
                    f"Vision read proposed — {side}: {ev.combined_classification} "
                    f"({_conf_band(ev.combined_confidence)} confidence)."
                ),
            ))
        for flag in ev.review_flags or []:
            events.append(AuditEvent(
                timestamp=side_time,
                actor="System",
                kind="flag",
                text=f"Flagged {side} for review: {flag}.",
            ))

    if case.submitted_at:
        events.append(AuditEvent(
            timestamp=case.submitted_at,
            actor=client_name or "Client",
            kind="submit",
            text="Submitted to accredited assessor for review.",
        ))

    # Merge the persisted, append-only assessor actions (confirm/override).
    for a in assessor_events or []:
        events.append(AuditEvent(
            timestamp=a.timestamp,
            actor=a.assessor_email,
            kind=a.kind,
            text=_audit_event_text(a),
        ))

    # Chronological; None timestamps (shouldn't happen) sort last. Stable sort
    # preserves insertion order for equal timestamps.
    events.sort(key=lambda e: (e.timestamp is None, e.timestamp or datetime.min))
    return events


@router.get("/cases/{case_id}", response_model=AssessorCaseRead)
async def console_get_case(
    case_id: str,
    assessor: User = Depends(current_assessor),
) -> AssessorCaseRead:
    """Read ONE full case (all four sides) for the assessor workspace. Read-only:
    no writes, no status change, no pipeline run. Out-of-scope / unknown / not-yet
    -submitted → 404 (existence never revealed). Sectors always come back as
    exactly four sides ordered North, East, South, West — empty placeholders for a
    point-only case so the workspace can still open it."""
    case = await _get_in_scope_case_or_404(case_id, assessor)

    owner = await User.get(case.user_id)
    client_name = owner.name if owner else None
    assessor_events = await CaseAuditEvent.find(CaseAuditEvent.case_id == case.id).to_list()

    side_gov = _side_governing_transects(case.boundary_assessment)
    ev_by_side = {ev.compass_side: ev for ev in (case.sector_evidence or [])}
    sectors = [
        _build_sector(side, ev_by_side.get(side), side_gov.get(side))
        for side in COMPASS_SIDES
    ]

    due = (
        _add_business_days(case.submitted_at, SLA_BUSINESS_DAYS)
        if case.submitted_at
        else None
    )

    return AssessorCaseRead(
        id=str(case.id),
        job_number=_job_number(case.id),
        client_name=client_name,
        property=AssessorProperty(
            address=case.property.address,
            matched_address=case.property.matched_address,
            latitude=case.property.latitude,
            longitude=case.property.longitude,
            lga=case.property.lga,
            state=_derive_state(case),
        ),
        status=case.status,
        ui_state=_ui_state(case.status),
        review_reason=case.review_reason,
        photo_request_sides=case.photo_request_sides or [],
        **_review_summary(case),
        bal_rating=case.bal_rating,
        governing_direction=case.governing_direction,
        governing_compass_side=governing_compass_side(case),
        submitted_at=case.submitted_at,
        due=due,
        has_boundary=bool(case.boundary_assessment),
        sectors=sectors,
        created_at=case.created_at,
        audit=build_case_audit(case, client_name, assessor_events),
        geometry=(case.boundary_assessment or {}).get("geometry"),
        transects=(case.boundary_assessment or {}).get("per_direction"),
        signoff=_signoff_summary(case),
    )


@router.get("/cases/{case_id}/sectors/{compass_side}/photos/{photo_id}")
async def console_get_sector_photo(
    case_id: str,
    compass_side: str,
    photo_id: str,
    assessor: User = Depends(current_assessor),
):
    """Stream one sector photo (JPEG/PNG) for the assessor's photo-review screen.
    Read-only. Scope is the SAME as the case read: a case outside the assessor's
    jurisdiction, not-yet-submitted, or unknown → 404. The consumer photo route is
    locked to the uploading owner, so the assessor needs this jurisdiction-scoped
    path to view the image. Path-traversal-guarded; a missing photo/file → 404."""
    case = await _get_in_scope_case_or_404(case_id, assessor)

    side_ev = next(
        (ev for ev in (case.sector_evidence or []) if ev.compass_side == compass_side),
        None,
    )
    photo = (
        next((p for p in side_ev.photos if p.photo_id == photo_id), None)
        if side_ev
        else None
    )
    if photo is None or not photo.file_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")

    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / photo.file_path).resolve()
    # Guard against path traversal: the resolved file must live under the store.
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")

    media_type = "image/png" if photo.file_path.endswith(".png") else "image/jpeg"
    return FileResponse(full, media_type=media_type)


# ─────────────────────────────────────────────────────────────────────────────
# CONSOLE-B3: assessor write path — confirm + override (surface="console").
# ─────────────────────────────────────────────────────────────────────────────

# Vegetation classes the override surface accepts (same set as the consumer
# override), plus a per-side FDI exception (SectorOverrides.fire_danger_index).
ALLOWED_OVERRIDE_CLASSES = {
    "Forest", "Woodland", "Shrubland", "Scrub", "Mallee/Heath",
    "Rainforest", "Grassland", "low_risk", "Excluded",
}
ALLOWED_SLOPE_DIRECTIONS = {"downslope", "upslope", "flat"}
ALLOWED_FDI = {50, 80, 100}
# Override-derived flags reconcile_sector_bal sets — stripped before each
# reconcile so they re-derive fresh (photo/system flags are preserved).
_OVERRIDE_FLAGS = {
    "geometry_overridden",
    "override_lower_than_draft_review",
    "override_vegetation_no_distance_review",
}

# Fallback "no hazard" transect for a side with no governing transect (mirrors
# reconcile_all_sectors so the reconcile resolves to BAL-LOW there).
_EMPTY_TRANSECT = {
    "vegetation_found": False, "distance_m": None, "effective_slope_degrees": 0.0,
    "vegetation_class": None, "pbp_formation": None, "bal_rating": "BAL-LOW",
    "candidate_distance_m": None,
}


class ConsoleOverrideRequest(BaseModel):
    """Assessor per-side override. Every field except `reason` is optional; an
    omitted field keeps the calculated value. `reason` is mandatory whenever any
    override is present (enforced in the handler so the error is a clean 400)."""

    vegetation_class: str | None = None
    distance_m: float | None = None
    effective_slope_degrees: float | None = None
    slope_direction: str | None = None
    fire_danger_index: int | None = None
    reason: str | None = None


def _bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=detail)


def _conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=status.HTTP_409_CONFLICT, detail=detail)


def _reject_if_signed(case: Case) -> None:
    """A signed (COMPLETE) case is a frozen legal artifact — every assessor write
    (confirm/override/revert/status) is refused with 409 so the certificate and
    the live case can never diverge."""
    if case.status == CaseStatus.COMPLETE:
        raise _conflict("This case is signed and can no longer be edited.")


def _require_boundary_side(case: Case, compass_side: str) -> SectorEvidence:
    """The SectorEvidence for a boundary side, or 400 when the case has no
    boundary read / no evidence for that side."""
    if not case.boundary_assessment or not case.sector_evidence:
        raise _bad_request("This case has no boundary assessment to review.")
    side_ev = next((ev for ev in case.sector_evidence if ev.compass_side == compass_side), None)
    if side_ev is None:
        raise _bad_request(f"No evidence for the {compass_side} side of this case.")
    return side_ev


def _effective_before(case: Case, side_ev: SectorEvidence) -> dict:
    """The values effective on this side BEFORE the incoming override (override
    layer, else calculated) — recorded as the audit's previous values."""
    ov = side_ev.overrides
    gov = _side_governing_transects(case.boundary_assessment).get(side_ev.compass_side) or {}
    base_fdi = (case.boundary_assessment or {}).get("fire_danger_index", 100)
    return {
        "vegetation_class": (ov.vegetation_class if ov else None) or side_ev.combined_classification or side_ev.gis_draft_classification,
        "distance_m": (ov.distance_m if ov and ov.distance_m is not None else gov.get("distance_m")),
        "effective_slope_degrees": (ov.effective_slope_degrees if ov and ov.effective_slope_degrees is not None else gov.get("effective_slope_degrees")),
        "slope_direction": (ov.slope_direction if ov and ov.slope_direction else gov.get("slope_direction")),
        "fire_danger_index": (ov.fire_danger_index if ov and ov.fire_danger_index else base_fdi),
    }


def _console_reconcile(case: Case) -> None:
    """Re-reconcile EVERY side on the console surface (raise OR lower allowed) and
    recompute the headline from scratch. Reuses reconcile_sector_bal — no BAL maths
    duplicated. Per-side effective FDI = the side's FDI override, else the site
    FDI. Mutates the case in place."""
    if not (case.boundary_assessment and case.sector_evidence):
        return
    side_gov = _side_governing_transects(case.boundary_assessment)
    base_fdi = (case.boundary_assessment or {}).get("fire_danger_index", 100)

    for ev in case.sector_evidence:
        ev.review_flags = [f for f in (ev.review_flags or []) if f not in _OVERRIDE_FLAGS]
        gov = side_gov.get(ev.compass_side) or dict(_EMPTY_TRANSECT)
        eff_fdi = ev.overrides.fire_danger_index if (ev.overrides and ev.overrides.fire_danger_index) else base_fdi
        reconcile_sector_bal(sector_ev=ev, side_transect=gov, fdi=eff_fdi, surface="console")

    worst = max(case.sector_evidence, key=lambda e: BAL_SEVERITY.get(e.final_bal, -1), default=None)
    candidates: list[tuple[str, str | None]] = []
    if worst and worst.final_bal:
        candidates.append((worst.final_bal, worst.compass_side))
    if case.assessment and case.assessment.get("bal_rating"):
        candidates.append((case.assessment["bal_rating"], case.assessment.get("governing_direction")))
    if candidates:
        bal, gdir = max(candidates, key=lambda c: BAL_SEVERITY.get(c[0], -1))
        case.bal_rating = bal
        case.governing_direction = gdir


def _sector_write_response(case: Case, compass_side: str) -> dict:
    """The refreshed sector after a confirm/override + the recomputed headline, so
    the frontend can update without re-reading the whole case (§6)."""
    side_ev = next((ev for ev in case.sector_evidence if ev.compass_side == compass_side), None)
    gov = _side_governing_transects(case.boundary_assessment).get(compass_side)
    return {
        "compass_side": compass_side,
        "sector": _build_sector(compass_side, side_ev, gov),
        "bal_rating": case.bal_rating,
        "governing_direction": case.governing_direction,
        "governing_compass_side": governing_compass_side(case),
        # Refreshed review progress / checklist so confirm/override/remove update
        # the progress bar + outstanding tasks live (§8) with no re-derivation.
        **_review_summary(case),
    }


@router.put("/cases/{case_id}/sectors/{compass_side}/confirm")
async def console_confirm_sector(
    case_id: str,
    compass_side: str,
    assessor: User = Depends(current_assessor),
) -> dict:
    """Confirm a side's calculated assessment: mark it reviewed, record assessor +
    timestamp, append an immutable audit event. No values change. Idempotent —
    confirming an already-reviewed side is a no-op (no duplicate audit row)."""
    if compass_side not in COMPASS_SIDES:
        raise _bad_request(f"compass_side must be one of {', '.join(COMPASS_SIDES)}.")
    case = await _get_in_scope_case_or_404(case_id, assessor)
    _reject_if_signed(case)
    side_ev = _require_boundary_side(case, compass_side)

    if not side_ev.reviewed:
        now = datetime.now(timezone.utc)
        side_ev.reviewed = True
        side_ev.reviewed_by = assessor.email
        side_ev.reviewed_at = now
        case.updated_at = now
        prev = case.status
        advanced = _auto_advance_status(case)
        await case.save()
        await CaseAuditEvent(
            case_id=case.id, assessor_id=assessor.id, assessor_email=assessor.email,
            compass_side=compass_side, kind="confirm", changes=[], reason=None,
        ).insert()
        if advanced:
            await _audit_auto_status(case, assessor, prev.value, advanced.value)

    return _sector_write_response(case, compass_side)


@router.put("/cases/{case_id}/sectors/{compass_side}/override")
async def console_override_sector(
    case_id: str,
    compass_side: str,
    body: ConsoleOverrideRequest = Body(...),
    assessor: User = Depends(current_assessor),
) -> dict:
    """Override one or more of a side's inputs (vegetation, distance, slope, slope
    direction, FDI). The assessor surface may RAISE OR LOWER the BAL. Every change
    needs a typed `reason` and is recorded immutably. Reconciles on
    surface="console" and recomputes the headline."""
    if compass_side not in COMPASS_SIDES:
        raise _bad_request(f"compass_side must be one of {', '.join(COMPASS_SIDES)}.")

    field_values = {
        "vegetation_class": body.vegetation_class,
        "distance_m": body.distance_m,
        "effective_slope_degrees": body.effective_slope_degrees,
        "slope_direction": body.slope_direction,
        "fire_danger_index": body.fire_danger_index,
    }
    provided = {k: v for k, v in field_values.items() if v is not None}
    if not provided:
        raise _bad_request("Provide at least one field to override.")
    if not (body.reason and body.reason.strip()):
        raise _bad_request("A reason is required for every override.")

    if body.vegetation_class is not None and body.vegetation_class not in ALLOWED_OVERRIDE_CLASSES:
        raise _bad_request(f"vegetation_class must be one of {', '.join(sorted(ALLOWED_OVERRIDE_CLASSES))}.")
    if body.fire_danger_index is not None and body.fire_danger_index not in ALLOWED_FDI:
        raise _bad_request("fire_danger_index must be one of 50, 80, 100.")
    if body.distance_m is not None and body.distance_m < 0:
        raise _bad_request("distance_m must be 0 or greater.")
    if body.effective_slope_degrees is not None and not (0 <= body.effective_slope_degrees <= 90):
        raise _bad_request("effective_slope_degrees must be between 0 and 90.")
    if body.slope_direction is not None and body.slope_direction not in ALLOWED_SLOPE_DIRECTIONS:
        raise _bad_request(f"slope_direction must be one of {', '.join(sorted(ALLOWED_SLOPE_DIRECTIONS))}.")

    case = await _get_in_scope_case_or_404(case_id, assessor)
    _reject_if_signed(case)
    side_ev = _require_boundary_side(case, compass_side)

    before = _effective_before(case, side_ev)

    now = datetime.now(timezone.utc)
    existing = side_ev.overrides or SectorOverrides()
    veg = body.vegetation_class
    veg = ("Excluded" if veg == "low_risk" else veg) if veg is not None else existing.vegetation_class
    side_ev.overrides = SectorOverrides(
        vegetation_class=veg,
        distance_m=body.distance_m if body.distance_m is not None else existing.distance_m,
        effective_slope_degrees=body.effective_slope_degrees if body.effective_slope_degrees is not None else existing.effective_slope_degrees,
        slope_direction=body.slope_direction if body.slope_direction is not None else existing.slope_direction,
        fire_danger_index=body.fire_danger_index if body.fire_danger_index is not None else existing.fire_danger_index,
        reason=body.reason.strip(),
        override_by=assessor.email,
        override_at=now,
    )
    side_ev.reviewed = True
    side_ev.reviewed_by = assessor.email
    side_ev.reviewed_at = now

    _console_reconcile(case)
    case.updated_at = now
    prev = case.status
    advanced = _auto_advance_status(case)
    await case.save()

    applied = {
        "vegetation_class": veg,
        "distance_m": body.distance_m,
        "effective_slope_degrees": body.effective_slope_degrees,
        "slope_direction": body.slope_direction,
        "fire_danger_index": body.fire_danger_index,
    }
    changes = [
        AuditChange(
            field=f,
            previous=(None if before.get(f) is None else str(before.get(f))),
            new=str(applied[f]),
        )
        for f in provided
    ]
    await CaseAuditEvent(
        case_id=case.id, assessor_id=assessor.id, assessor_email=assessor.email,
        compass_side=compass_side, kind="override", changes=changes, reason=body.reason.strip(),
    ).insert()
    if advanced:
        await _audit_auto_status(case, assessor, prev.value, advanced.value)

    return _sector_write_response(case, compass_side)


@router.delete("/cases/{case_id}/sectors/{compass_side}/override")
async def console_remove_override_sector(
    case_id: str,
    compass_side: str,
    assessor: User = Depends(current_assessor),
) -> dict:
    """Remove ONLY the assessor override from a side, restoring the previously
    calculated effective value (GIS draft / photo-combined). The AI proposal,
    photos, review history and every prior audit event are preserved — this
    drops the override layer and nothing else. Reconciles on surface="console"
    and recomputes the headline, then records an immutable 'revert' audit event.
    A side with no override is a 400 (nothing to revert)."""
    if compass_side not in COMPASS_SIDES:
        raise _bad_request(f"compass_side must be one of {', '.join(COMPASS_SIDES)}.")
    case = await _get_in_scope_case_or_404(case_id, assessor)
    _reject_if_signed(case)
    side_ev = _require_boundary_side(case, compass_side)

    if side_ev.overrides is None:
        raise _bad_request("This side has no assessor override to remove.")

    # Effective values BEFORE (override layer) and AFTER (calculated) the revert —
    # the audit records exactly what changed back.
    before = _effective_before(case, side_ev)
    side_ev.overrides = None
    after = _effective_before(case, side_ev)

    now = datetime.now(timezone.utc)
    # The revert is itself a review action — the side stays reviewed, re-attributed
    # to the assessor who reverted it.
    side_ev.reviewed = True
    side_ev.reviewed_by = assessor.email
    side_ev.reviewed_at = now

    _console_reconcile(case)
    case.updated_at = now
    prev = case.status
    advanced = _auto_advance_status(case)
    await case.save()

    changes = [
        AuditChange(
            field=f,
            previous=(None if before.get(f) is None else str(before.get(f))),
            new=(None if after.get(f) is None else str(after.get(f))),
        )
        for f in before
        if before.get(f) != after.get(f)
    ]
    await CaseAuditEvent(
        case_id=case.id, assessor_id=assessor.id, assessor_email=assessor.email,
        compass_side=compass_side, kind="revert", changes=changes, reason=None,
    ).insert()
    if advanced:
        await _audit_auto_status(case, assessor, prev.value, advanced.value)

    return _sector_write_response(case, compass_side)


# ─────────────────────────────────────────────────────────────────────────────
# CONSOLE-B3.2: case-level review status workflow (assessor-only).
# ─────────────────────────────────────────────────────────────────────────────

# The statuses the assessor may set via the status endpoint. The lifecycle's
# entry (SUBMITTED_TO_ASSESSOR) and terminal (COMPLETE/signed) states are NOT
# settable here — submission is consumer-side, signing is a later step.
SETTABLE_STATUSES: dict[str, CaseStatus] = {
    "UNDER_REVIEW": CaseStatus.UNDER_REVIEW,
    "NEEDS_MORE_PHOTOS": CaseStatus.NEEDS_MORE_PHOTOS,
    "SITE_VISIT_REQUIRED": CaseStatus.SITE_VISIT_REQUIRED,
    "REFERRED_SPECIALIST": CaseStatus.REFERRED_SPECIALIST,
    "READY_TO_SIGN": CaseStatus.READY_TO_SIGN,
}
# Transitions that demand a typed reason (the consumer is shown why).
_REASON_REQUIRED = {
    CaseStatus.NEEDS_MORE_PHOTOS,
    CaseStatus.SITE_VISIT_REQUIRED,
    CaseStatus.REFERRED_SPECIALIST,
}
def _ready_to_sign_blockers(case: Case) -> list[str]:
    """Why the case CANNOT yet be marked READY_TO_SIGN — the single source of the
    §8 completion rule (no duplication on the frontend). Empty list = allowed."""
    blockers: list[str] = []
    if case.sector_evidence:
        unreviewed = [ev.compass_side for ev in case.sector_evidence if not ev.reviewed]
        if unreviewed:
            blockers.append(
                f"These elevations are not yet reviewed: {', '.join(unreviewed)}."
            )
    if case.photo_request_sides:
        blockers.append(
            f"An additional-photo request is still open ({', '.join(case.photo_request_sides)})."
        )
    elif case.status in (CaseStatus.NEEDS_MORE_PHOTOS, CaseStatus.CHANGES_REQUESTED):
        blockers.append("An additional-photo request is still open.")
    if case.status == CaseStatus.SITE_VISIT_REQUIRED:
        blockers.append("A site visit is outstanding — complete it and return to Under review first.")
    if case.status == CaseStatus.REFERRED_SPECIALIST:
        blockers.append("A specialist referral is outstanding — close it and return to Under review first.")
    return blockers


# ── automatic status transitions ────────────────────────────────────────────
# The assessor used to drive every status change by hand. These move the case
# through the *inferrable* states automatically as review happens — the backend
# is the single source of truth, so the manual dropdown stays as an override and
# for the states a machine can't infer (the request states need a typed reason;
# COMPLETE is the explicit signing act).

# Statuses the machine is allowed to move BETWEEN. It never touches the request
# states (NEEDS_MORE_PHOTOS / SITE_VISIT_REQUIRED / REFERRED_SPECIALIST — those
# carry a human reason) or COMPLETE (signed/locked).
_AUTO_FROM = {
    CaseStatus.SUBMITTED_TO_ASSESSOR,
    CaseStatus.UNDER_REVIEW,
    CaseStatus.READY_TO_SIGN,
    CaseStatus.APPROVED,  # legacy alias of READY_TO_SIGN
}


def _auto_advance_status(case: Case) -> CaseStatus | None:
    """Advance a case's status from the current evidence state. Returns the new
    status if it changed (and mutates `case.status`), else None.

    Rules:
      • all sides reviewed + no blockers  → READY_TO_SIGN
      • READY_TO_SIGN but blockers reappear → UNDER_REVIEW (a review went stale)
      • first review action on a submitted case → UNDER_REVIEW
    """
    if case.status not in _AUTO_FROM:
        return None

    blockers = _ready_to_sign_blockers(case)
    has_sides = bool(case.sector_evidence)
    all_reviewed = has_sides and all(ev.reviewed for ev in case.sector_evidence)

    if has_sides and all_reviewed and not blockers:
        target = CaseStatus.READY_TO_SIGN
    elif case.status in (CaseStatus.READY_TO_SIGN, CaseStatus.APPROVED) and blockers:
        target = CaseStatus.UNDER_REVIEW
    elif case.status == CaseStatus.SUBMITTED_TO_ASSESSOR:
        target = CaseStatus.UNDER_REVIEW
    else:
        return None

    if target == case.status:
        return None
    case.status = target
    return target


async def _audit_auto_status(case: Case, assessor: User, previous: str, new: str) -> None:
    """Record an automatic status transition (kind='auto_status') so the trail
    explains the jump and who triggered it (whichever review action did)."""
    await CaseAuditEvent(
        case_id=case.id, assessor_id=assessor.id, assessor_email=assessor.email,
        compass_side=None, kind="auto_status",
        changes=[AuditChange(field="status", previous=previous, new=new)],
        reason=None,
    ).insert()


# ── CONSOLE-B3.3 / F3.3: review progress, outstanding checklist ──────────────
# Everything below is DERIVED on read from the stored case — never denormalised.
# The frontend renders these verbatim (no React-side calculation, §1/§2/§8).


def _review_progress(case: Case) -> dict:
    """Elevation-review progress — the §1 {reviewed, total, percent} the header's
    progress bar draws from. `total` is the boundary sides carrying evidence."""
    sides = case.sector_evidence or []
    total = len(sides)
    reviewed = sum(1 for ev in sides if ev.reviewed)
    percent = round(reviewed / total * 100) if total else 0
    return {"reviewed": reviewed, "total": total, "percent": percent}


def _outstanding_requests(case: Case) -> list[str]:
    """The case-level open requests blocking sign-off, as short labels — reused by
    the worklist row, the report preview and the consumer dashboard (§6)."""
    out: list[str] = []
    if case.status in (CaseStatus.NEEDS_MORE_PHOTOS, CaseStatus.CHANGES_REQUESTED):
        sides = case.photo_request_sides
        out.append(
            f"Awaiting requested photos ({', '.join(sides)})" if sides else "Awaiting requested photos"
        )
    if case.status == CaseStatus.SITE_VISIT_REQUIRED:
        out.append("Site visit outstanding")
    if case.status == CaseStatus.REFERRED_SPECIALIST:
        out.append("Specialist review outstanding")
    return out


def _remaining_reviews(case: Case) -> list[str]:
    """The §1 `remaining_reviews` — every still-outstanding task as a human line
    (unreviewed elevations first, then open case-level requests)."""
    out = [
        f"{ev.compass_side} elevation not reviewed"
        for ev in (case.sector_evidence or [])
        if not ev.reviewed
    ]
    out.extend(_outstanding_requests(case))
    return out


def _review_checklist(case: Case) -> list[dict]:
    """The §2 `review_checklist` — one {key, complete, label} per task the
    frontend renders directly. Per-elevation reviews, then any open request."""
    items: list[dict] = [
        {
            "key": f"{ev.compass_side.lower()}_review",
            "complete": bool(ev.reviewed),
            "label": f"{ev.compass_side} elevation reviewed",
        }
        for ev in (case.sector_evidence or [])
    ]
    if case.status in (CaseStatus.NEEDS_MORE_PHOTOS, CaseStatus.CHANGES_REQUESTED):
        items.append({"key": "photo_request", "complete": False, "label": "Requested photos received"})
    if case.status == CaseStatus.SITE_VISIT_REQUIRED:
        items.append({"key": "site_visit", "complete": False, "label": "Site visit completed"})
    if case.status == CaseStatus.REFERRED_SPECIALIST:
        items.append({"key": "specialist", "complete": False, "label": "Specialist review completed"})
    return items


def _review_summary(case: Case) -> dict:
    """The full §1/§2/§8 review-state bundle, derived on read. Spread into every
    case read and write response so the frontend stays in lock-step with the
    backend without re-deriving anything (§8 live synchronisation)."""
    blockers = _ready_to_sign_blockers(case)
    return {
        "review_progress": _review_progress(case),
        "remaining_reviews": _remaining_reviews(case),
        "review_checklist": _review_checklist(case),
        "outstanding_requests": _outstanding_requests(case),
        "can_ready_to_sign": not blockers,
        "ready_to_sign_blockers": blockers,
    }


class ConsoleStatusRequest(BaseModel):
    """Assessor case-level status change. `reason` is mandatory for the request
    states (validated in the handler). `photo_request_sides` is only meaningful
    for NEEDS_MORE_PHOTOS — a subset of the four compass sides, or empty for
    "any side"."""

    status: str
    reason: str | None = None
    photo_request_sides: list[str] | None = None


def _case_status_response(case: Case, audit: list[AuditEvent]) -> dict:
    """The refreshed case-level review fields after a status change, so the
    frontend updates without re-reading the whole case."""
    return {
        "id": str(case.id),
        "status": case.status,
        "ui_state": _ui_state(case.status),
        "review_reason": case.review_reason,
        "photo_request_sides": case.photo_request_sides or [],
        **_review_summary(case),
        "audit": audit,
    }


@router.put("/cases/{case_id}/status")
async def console_set_status(
    case_id: str,
    body: ConsoleStatusRequest = Body(...),
    assessor: User = Depends(current_assessor),
) -> dict:
    """Move a case through the assessor review lifecycle (UNDER_REVIEW,
    NEEDS_MORE_PHOTOS, SITE_VISIT_REQUIRED, REFERRED_SPECIALIST, READY_TO_SIGN).
    Unknown status → 400; non-assessor → 403 (dependency); out-of-scope → 404.
    The request states require a reason; READY_TO_SIGN is gated by the §8
    completion rule. Every change appends an immutable audit event."""
    target = SETTABLE_STATUSES.get(body.status)
    if target is None:
        raise _bad_request(
            f"status must be one of {', '.join(SETTABLE_STATUSES)}."
        )

    reason = (body.reason or "").strip() or None
    if target in _REASON_REQUIRED and not reason:
        raise _bad_request(f"A reason is required to set {STATUS_LABELS[target.value]}.")

    sides: list[str] = []
    if target == CaseStatus.NEEDS_MORE_PHOTOS and body.photo_request_sides:
        # "All" is sent as the four sides (or empty); normalise + validate.
        for s in body.photo_request_sides:
            canonical = _normalize_side(s)
            if canonical is None:
                raise _bad_request(f"photo_request_sides must be compass sides; got '{s}'.")
            if canonical not in sides:
                sides.append(canonical)

    case = await _get_in_scope_case_or_404(case_id, assessor)
    _reject_if_signed(case)

    if target == CaseStatus.READY_TO_SIGN:
        blockers = _ready_to_sign_blockers(case)
        if blockers:
            raise _bad_request(" ".join(blockers))

    previous = case.status
    now = datetime.now(timezone.utc)
    case.status = target
    case.review_reason = reason
    # Photo-side request only persists while NEEDS_MORE_PHOTOS; any other
    # transition clears an open request.
    case.photo_request_sides = sides if target == CaseStatus.NEEDS_MORE_PHOTOS else []
    case.updated_at = now
    await case.save()

    changes = [AuditChange(field="status", previous=previous.value, new=target.value)]
    if target == CaseStatus.NEEDS_MORE_PHOTOS:
        changes.append(AuditChange(
            field="photo_request_sides", previous=None,
            new=", ".join(sides) if sides else "any side",
        ))
    await CaseAuditEvent(
        case_id=case.id, assessor_id=assessor.id, assessor_email=assessor.email,
        compass_side=None, kind="status", changes=changes, reason=reason,
    ).insert()

    owner = await User.get(case.user_id)
    client_name = owner.name if owner else None
    assessor_events = await CaseAuditEvent.find(CaseAuditEvent.case_id == case.id).to_list()
    audit = build_case_audit(case, client_name, assessor_events)
    return _case_status_response(case, audit)


# ─────────────────────────────────────────────────────────────────────────────
# P0: sign-off → issued PDF determination.
# ─────────────────────────────────────────────────────────────────────────────

# The exact text the assessor attests to (stored verbatim on the Signoff record).
ATTESTATION_TEXT = (
    "I have reviewed the evidence and each elevation's classification. This "
    "determination is mine, made under my accreditation."
)

# Statuses from which a case may be signed (READY_TO_SIGN + its legacy alias).
_SIGNABLE_STATUSES = {CaseStatus.READY_TO_SIGN, CaseStatus.APPROVED}


class SignRequest(BaseModel):
    """The sign-off attestation — the assessor must tick the box (true) to sign."""

    attestation: bool = False


def _determination_rows(case: Case) -> list[DeterminationRow]:
    """The four frozen per-side rows for the certificate — built from the SAME
    `_build_sector` projection the Console workspace reads, so the issued document
    and the on-screen review never disagree."""
    side_gov = _side_governing_transects(case.boundary_assessment)
    ev_by_side = {ev.compass_side: ev for ev in (case.sector_evidence or [])}
    rows: list[DeterminationRow] = []
    for side in COMPASS_SIDES:
        s = _build_sector(side, ev_by_side.get(side), side_gov.get(side))
        if s.overrides is not None:
            basis = "overridden by assessor"
        elif s.reviewed:
            basis = "confirmed by assessor"
        else:
            basis = "suggested — unreviewed"
        slope = (
            f"{s.effective_slope_degrees}°"
            + (f" {s.slope_direction}" if s.slope_direction else "")
            if s.effective_slope_degrees is not None
            else "—"
        )
        rows.append(DeterminationRow(
            side=side[0],
            vegetation=s.effective_classification or "—",
            slope=slope,
            distance=f"{s.distance_m} m" if s.distance_m is not None else "—",
            bal=s.final_bal or "BAL-LOW",
            basis=basis,
        ))
    return rows


def _signoff_summary(case: Case) -> dict | None:
    """The small signoff descriptor the frontend flips to the issued state with."""
    so = case.signoff
    if so is None:
        return None
    return {
        "report_number": so.report_number,
        "signed_at": so.signed_at,
        "assessor_name": so.assessor_name,
        "accreditation_number": so.accreditation_number,
        "bal_rating": so.bal_rating,
        "governing_direction": so.governing_direction,
    }


@router.post("/cases/{case_id}/sign")
async def console_sign_case(
    case_id: str,
    body: SignRequest = Body(...),
    assessor: User = Depends(current_assessor),
) -> dict:
    """Sign and ISSUE the determination. Freezes the per-side determination,
    renders the PDF certificate, marks the case COMPLETE, and records an immutable
    'sign' audit event. Gated by the same §8 completion rule the worklist uses.

    422 if not attested · 400 (+ blockers) if not sign-ready · 409 if already
    signed · 404 if out of scope. The signed case is then locked to edits (the
    other write routes return 409)."""
    if not body.attestation:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="You must attest to the determination before signing.",
        )

    case = await _get_in_scope_case_or_404(case_id, assessor)
    if case.status == CaseStatus.COMPLETE:
        raise _conflict("This case is already signed.")
    if case.status not in _SIGNABLE_STATUSES:
        raise _bad_request("The case must be marked Ready to sign before it can be signed.")
    blockers = _ready_to_sign_blockers(case)
    if blockers:
        raise _bad_request(" ".join(blockers))

    # Assessor identity for the certificate — profile first, User as fallback.
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == assessor.id)
    name = None
    if profile:
        name = " ".join(
            p for p in (profile.legal_first_name, profile.legal_last_name) if p
        ).strip() or None
    name = name or assessor.name or assessor.email
    accreditation_number = profile.accreditation_number if profile else None
    accreditation_level = profile.accreditation_level if profile else None
    jurisdiction = assessor.jurisdiction or (
        (profile.operating_states[0] if profile and profile.operating_states else None)
    ) or "NSW"

    now = datetime.now(timezone.utc)
    report_number = f"EC-{str(case.id)[-8:]}-{now.strftime('%Y%m%d')}-01"
    rows = _determination_rows(case)

    # Render + persist the PDF on disk under PHOTO_STORAGE_DIR/<case>/report/.
    locality = " · ".join(
        p for p in (
            f"{case.property.lga} LGA" if case.property.lga else None,
            _derive_state(case) or "NSW",
        ) if p
    )
    pdf_bytes = render_report_pdf(ReportContext(
        report_number=report_number,
        signed_at=now,
        address=case.property.matched_address or case.property.address,
        locality=locality,
        assessor_name=name,
        accreditation_number=accreditation_number or "",
        accreditation_level=accreditation_level or "",
        jurisdiction=jurisdiction,
        overall_bal=case.bal_rating or "—",
        governing_side=case.governing_direction or "",
        rows=rows,
    ))
    rel_path = f"{case.id}/report/{report_number}.pdf"
    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / rel_path).resolve()
    full.parent.mkdir(parents=True, exist_ok=True)
    full.write_bytes(pdf_bytes)

    # Freeze the signoff record + flip the case to COMPLETE.
    case.signoff = Signoff(
        report_number=report_number,
        signed_by_assessor_id=assessor.id,
        assessor_name=name,
        accreditation_number=accreditation_number,
        accreditation_level=accreditation_level,
        jurisdiction=jurisdiction,
        signed_at=now,
        bal_rating=case.bal_rating,
        governing_direction=case.governing_direction,
        determination=[r.__dict__ for r in rows],
        attestation=ATTESTATION_TEXT,
        report_path=rel_path,
    )
    previous = case.status
    case.status = CaseStatus.COMPLETE
    case.review_reason = None
    case.photo_request_sides = []
    case.updated_at = now
    await case.save()

    await CaseAuditEvent(
        case_id=case.id, assessor_id=assessor.id, assessor_email=assessor.email,
        compass_side=None, kind="sign",
        changes=[
            AuditChange(field="status", previous=previous.value, new=CaseStatus.COMPLETE.value),
            AuditChange(field="report_number", previous=None, new=report_number),
        ],
        reason=None,
    ).insert()

    owner = await User.get(case.user_id)
    client_name = owner.name if owner else None
    assessor_events = await CaseAuditEvent.find(CaseAuditEvent.case_id == case.id).to_list()
    audit = build_case_audit(case, client_name, assessor_events)
    return {**_case_status_response(case, audit), "signoff": _signoff_summary(case)}


@router.get("/cases/{case_id}/report")
async def console_get_report(
    case_id: str,
    assessor: User = Depends(current_assessor),
):
    """Stream the signed PDF certificate for the assessor. Same scope as the case
    read; an unsigned/out-of-scope case → 404. Path-traversal-guarded."""
    case = await _get_in_scope_case_or_404(case_id, assessor)
    return _stream_report_or_404(case)


def _stream_report_or_404(case: Case) -> FileResponse:
    """Shared PDF streamer for both the console and consumer report endpoints."""
    if case.signoff is None or not case.signoff.report_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / case.signoff.report_path).resolve()
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    return FileResponse(
        full,
        media_type="application/pdf",
        filename=f"{case.signoff.report_number}.pdf",
    )

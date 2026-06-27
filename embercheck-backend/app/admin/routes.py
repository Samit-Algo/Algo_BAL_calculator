# Admin app routes (Phase 3).
#
# An admin reviews assessor applications and is the ONLY actor who can grant
# assessor access. Approval is the single action that flips a user to assessor:
# it sets BOTH profile.status=APPROVED AND user.role="assessor", keeping the two
# in lockstep so a newly approved applicant actually passes current_assessor.
# Reject/suspend/deactivate revert the role away from "assessor" so the gate
# closes again. Every action writes an immutable AdminAuditEvent row.
#
# Every route is admin-only (current_admin: 401 no token / 403 non-admin).

from datetime import datetime, timedelta, timezone
from pathlib import Path

from beanie import PydanticObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Body, Depends, HTTPException, status
from fastapi.responses import FileResponse
from pydantic import BaseModel

from app.auth.backend import current_admin, get_jwt_strategy
from app.auth.manager import UserManager, get_user_manager
from app.auth.routes import TokenResponse, _issue_refresh_token
from app.config import settings as media_settings
from app.models.admin_audit import AdminAuditEvent
from app.models.assessor_profile import AssessorProfile, AssessorStatus
from app.models.audit import AuditChange
from app.models.case import Case, CaseStatus
from app.models.user import User
from app.schemas.admin import (
    ActivityItem,
    AdminActionRequest,
    AdminApplicationDetail,
    AdminApplicationSummary,
    AdminKpis,
    AdminMe,
    AdminOverview,
    CountBucket,
    MapPoint,
    TimelinePoint,
)
from app.schemas.user import UserCreate

router = APIRouter(prefix="/admin", tags=["admin"])

# Media types the document streamer serves, by stored file extension.
_MEDIA_BY_EXT = {"pdf": "application/pdf", "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg"}

# ⚠️ TEMP (demo) — a hardcoded admin login so the demo can skip the
# register + set_admin bootstrap. Logging in with admin/admin ensures a single
# bootstrap admin user exists and issues normal tokens for it. REMOVE before any
# real deployment: it's a backdoor. The real path stays scripts/set_admin.py.
_DEMO_ADMIN_USERNAME = "admin"
_DEMO_ADMIN_PASSWORD = "admin"
_DEMO_ADMIN_EMAIL = "admin@embercheck.app"


class AdminLoginRequest(BaseModel):
    username: str
    password: str


@router.post("/login", response_model=TokenResponse)
async def admin_login(
    body: AdminLoginRequest,
    user_manager: UserManager = Depends(get_user_manager),
):
    """TEMP demo admin login (admin/admin). Ensures the bootstrap admin user
    exists (role=admin) and returns a JWT access token + DB-backed refresh token,
    exactly like /auth/login. The admin app gate (/admin/me) then admits it."""
    if body.username != _DEMO_ADMIN_USERNAME or body.password != _DEMO_ADMIN_PASSWORD:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid admin credentials.")

    user = await User.find_one(User.email == _DEMO_ADMIN_EMAIL)
    if user is None:
        # Create via the real user manager (hashes the password, runs hooks). The
        # stored password is irrelevant — this endpoint never checks it — but must
        # satisfy the >=8 rule, so it's not the literal "admin".
        user = await user_manager.create(
            UserCreate(email=_DEMO_ADMIN_EMAIL, password="adminadmin", name="Admin"),
            safe=True,
        )
    if user.role != "admin":
        user.role = "admin"
        await user.save()

    access_token = await get_jwt_strategy().write_token(user)
    refresh_token = await _issue_refresh_token(user.id)
    return TokenResponse(access_token=access_token, refresh_token=refresh_token)


async def _get_profile_or_404(profile_id: str) -> AssessorProfile:
    """Load an assessor profile by id, or 404 on a missing/malformed id."""
    try:
        oid = PydanticObjectId(profile_id)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found.")
    profile = await AssessorProfile.get(oid)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Application not found.")
    return profile


async def _owner(profile: AssessorProfile) -> User | None:
    return await User.get(profile.user_id)


async def _apply_transition(
    profile: AssessorProfile,
    admin: User,
    action: str,
    new_status: AssessorStatus,
    grant_access: bool | None,
    reason: str | None,
) -> AssessorProfile:
    """Flip the profile status, keep User.role in lockstep, and append one
    immutable audit row. grant_access: True -> role="assessor"; False -> revert
    to "consumer"; None -> leave role untouched (e.g. request-info)."""
    owner = await _owner(profile)
    now = datetime.now(timezone.utc)
    changes: list[AuditChange] = []

    if new_status is not None and profile.status != new_status:
        changes.append(AuditChange(field="status", previous=profile.status.value, new=new_status.value))
        profile.status = new_status

    if grant_access is not None and owner is not None:
        target_role = "assessor" if grant_access else "consumer"
        if owner.role != target_role:
            changes.append(AuditChange(field="role", previous=owner.role, new=target_role))
            owner.role = target_role
            owner.updated_at = now
            await owner.save()

    if reason is not None:
        profile.review_reason = reason
    profile.updated_at = now
    await profile.save()

    await AdminAuditEvent(
        profile_id=profile.id,
        target_user_id=profile.user_id,
        target_email=owner.email if owner else "(unknown)",
        admin_id=admin.id,
        admin_email=admin.email,
        action=action,
        changes=changes,
        reason=reason,
    ).insert()
    return profile


async def _detail(profile: AssessorProfile) -> AdminApplicationDetail:
    owner = await _owner(profile)
    return AdminApplicationDetail.from_profile(
        profile, owner.email if owner else None, owner.name if owner else None
    )


def _require_reason(body: AdminActionRequest, action: str) -> str:
    reason = (body.reason or "").strip()
    if not reason:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"A reason is required to {action}.",
        )
    return reason


@router.get("/me", response_model=AdminMe)
async def admin_me(admin: User = Depends(current_admin)) -> AdminMe:
    """Cheap gate check the admin app calls on load to decide who gets in."""
    return AdminMe(id=str(admin.id), email=admin.email, name=admin.name, role=admin.role)


# ── overview dashboard ────────────────────────────────────────────────────────
# One admin-gated aggregation endpoint powering the Overview screen. Everything is
# computed in Mongo (counts + daily buckets) so the dashboard is a single fetch.

# Case statuses that count as "in active assessor review" for the KPI tile.
_IN_REVIEW_STATUSES = [
    CaseStatus.SUBMITTED_TO_ASSESSOR,
    CaseStatus.UNDER_REVIEW,
    CaseStatus.NEEDS_MORE_PHOTOS,
    CaseStatus.SITE_VISIT_REQUIRED,
    CaseStatus.REFERRED_SPECIALIST,
    CaseStatus.READY_TO_SIGN,
    CaseStatus.CHANGES_REQUESTED,
    CaseStatus.APPROVED,
]


async def _daily_counts(document_cls, date_field: str, since: datetime) -> dict[str, int]:
    """Group a collection into {YYYY-MM-DD: count} buckets for rows whose
    `date_field` is on/after `since`. Used to build the timeline series."""
    rows = await document_cls.aggregate(
        [
            {"$match": {date_field: {"$gte": since, "$ne": None}}},
            {
                "$group": {
                    "_id": {"$dateToString": {"format": "%Y-%m-%d", "date": f"${date_field}"}},
                    "count": {"$sum": 1},
                }
            },
        ]
    ).to_list()
    return {r["_id"]: r["count"] for r in rows if r.get("_id")}


async def _grouped_counts(document_cls, field: str) -> list[tuple[str, int]]:
    """Group a collection by `field` → list of (value, count), commonest first.
    A missing/null value buckets under an empty string for the caller to label."""
    rows = await document_cls.aggregate(
        [{"$group": {"_id": f"${field}", "count": {"$sum": 1}}}, {"$sort": {"count": -1}}]
    ).to_list()
    return [(r["_id"], r["count"]) for r in rows]


@router.get("/overview", response_model=AdminOverview)
async def overview(days: int = 30, admin: User = Depends(current_admin)) -> AdminOverview:
    """Platform analytics for the admin Overview dashboard: KPI counters, a daily
    activity timeline, BAL + status distributions, mapped property points, assessor
    breakdowns and a recent-admin-activity feed. `days` sizes the timeline window."""
    days = max(1, min(days, 365))
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days - 1)
    window_start = since.replace(hour=0, minute=0, second=0, microsecond=0)

    # KPI counters.
    total_cases = await Case.find().count()
    signed_cases = await Case.find(Case.status == CaseStatus.COMPLETE).count()
    cases_in_review = await Case.find({"status": {"$in": [s.value for s in _IN_REVIEW_STATUSES]}}).count()
    total_users = await User.find().count()
    assessors_active = await AssessorProfile.find(AssessorProfile.status == AssessorStatus.APPROVED).count()
    applications_pending = await AssessorProfile.find(AssessorProfile.status == AssessorStatus.PENDING).count()

    kpis = AdminKpis(
        total_cases=total_cases,
        signed_cases=signed_cases,
        cases_in_review=cases_in_review,
        total_users=total_users,
        assessors_active=assessors_active,
        applications_pending=applications_pending,
    )

    # Cases by status (bar) and BAL distribution (pie).
    cases_by_status = [
        CountBucket(label=value or "Unknown", count=count)
        for value, count in await _grouped_counts(Case, "status")
    ]
    bal_distribution = [
        CountBucket(label=value or "Unrated", count=count)
        for value, count in await _grouped_counts(Case, "bal_rating")
    ]

    # Timeline: cases / signoffs / signups per day, zero-filled across the window.
    case_days = await _daily_counts(Case, "created_at", window_start)
    signoff_days = await _daily_counts(Case, "signoff.signed_at", window_start)
    signup_days = await _daily_counts(User, "created_at", window_start)
    timeline: list[TimelinePoint] = []
    for i in range(days):
        key = (window_start + timedelta(days=i)).strftime("%Y-%m-%d")
        timeline.append(
            TimelinePoint(
                date=key,
                cases=case_days.get(key, 0),
                signoffs=signoff_days.get(key, 0),
                signups=signup_days.get(key, 0),
            )
        )

    # Map points: assessed properties with coordinates (newest 500).
    point_rows = await Case.aggregate(
        [
            {"$match": {"property.latitude": {"$ne": None}, "property.longitude": {"$ne": None}}},
            {"$sort": {"created_at": -1}},
            {"$limit": 500},
            {
                "$project": {
                    "_id": 0,
                    "lat": "$property.latitude",
                    "lng": "$property.longitude",
                    "rating": "$bal_rating",
                    "address": "$property.address",
                    "status": "$status",
                }
            },
        ]
    ).to_list()
    map_points = [MapPoint(**r) for r in point_rows]

    # Assessor breakdowns: by status, and by operating state (multikey unwind).
    assessor_status = [
        CountBucket(label=value or "Unknown", count=count)
        for value, count in await _grouped_counts(AssessorProfile, "status")
    ]
    state_rows = await AssessorProfile.aggregate(
        [
            {"$unwind": "$operating_states"},
            {"$group": {"_id": "$operating_states", "count": {"$sum": 1}}},
            {"$sort": {"count": -1}},
        ]
    ).to_list()
    assessor_states = [CountBucket(label=r["_id"] or "—", count=r["count"]) for r in state_rows]

    # Recent admin activity feed (newest 12).
    events = await AdminAuditEvent.find().sort(-AdminAuditEvent.timestamp).limit(12).to_list()
    recent_activity = [
        ActivityItem(
            action=e.action,
            admin_email=e.admin_email,
            target_email=e.target_email,
            reason=e.reason,
            timestamp=e.timestamp,
        )
        for e in events
    ]

    return AdminOverview(
        kpis=kpis,
        cases_by_status=cases_by_status,
        bal_distribution=bal_distribution,
        timeline=timeline,
        map_points=map_points,
        assessor_status=assessor_status,
        assessor_states=assessor_states,
        recent_activity=recent_activity,
    )


@router.get("/applications", response_model=list[AdminApplicationSummary])
async def list_applications(
    status_filter: str | None = None,
    admin: User = Depends(current_admin),
):
    """The application queue. `?status_filter=PENDING` (etc.) narrows it; omitted
    returns all, newest-updated first. Pending is the default review surface, but
    the admin can see every state."""
    query = AssessorProfile.find()
    if status_filter:
        try:
            wanted = AssessorStatus(status_filter)
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"status_filter must be one of {', '.join(s.value for s in AssessorStatus)}.",
            )
        query = AssessorProfile.find(AssessorProfile.status == wanted)

    profiles = await query.sort(-AssessorProfile.updated_at).to_list()

    # Resolve owner emails in one pass.
    rows: list[AdminApplicationSummary] = []
    for p in profiles:
        owner = await User.get(p.user_id)
        rows.append(AdminApplicationSummary(
            id=str(p.id),
            status=p.status,
            user_email=owner.email if owner else None,
            user_name=owner.name if owner else None,
            legal_first_name=p.legal_first_name,
            legal_last_name=p.legal_last_name,
            business_name=p.business_name,
            accreditation_number=p.accreditation_number,
            operating_states=p.operating_states,
            document_count=len(p.documents),
            created_at=p.created_at,
            updated_at=p.updated_at,
        ))
    return rows


@router.get("/applications/{profile_id}", response_model=AdminApplicationDetail)
async def get_application(profile_id: str, admin: User = Depends(current_admin)):
    """The full application for the detail/review screen."""
    profile = await _get_profile_or_404(profile_id)
    return await _detail(profile)


@router.get("/applications/{profile_id}/documents/{index}")
async def get_application_document(
    profile_id: str,
    index: int,
    admin: User = Depends(current_admin),
):
    """Stream one of the applicant's uploaded documents (PDF/JPEG/PNG) for the
    admin's document viewer. Path-traversal-guarded; a missing doc/file → 404.
    The image bytes are NOT in MongoDB — only the relative path is stored."""
    profile = await _get_profile_or_404(profile_id)
    if index < 0 or index >= len(profile.documents):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    doc = profile.documents[index]

    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / doc.file_path).resolve()
    # Guard against path traversal: the resolved file must live under the store.
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    ext = full.suffix.lstrip(".").lower()
    return FileResponse(full, media_type=_MEDIA_BY_EXT.get(ext, "application/octet-stream"))


# ── actions ──────────────────────────────────────────────────────────────────
# approve / reactivate GRANT access (role -> assessor); reject / suspend /
# deactivate REVOKE it (role -> consumer); request-info changes neither.


@router.post("/applications/{profile_id}/approve", response_model=AdminApplicationDetail)
async def approve_application(profile_id: str, body: AdminActionRequest = Body(default=AdminActionRequest()), admin: User = Depends(current_admin)):
    """Approve — the ONLY action that grants assessor access. Sets status=APPROVED
    and the user's role=assessor (lockstep), so the applicant now passes the
    Console gate. Reason optional."""
    profile = await _get_profile_or_404(profile_id)
    await _apply_transition(profile, admin, "approve", AssessorStatus.APPROVED, grant_access=True, reason=(body.reason or "").strip() or None)
    return await _detail(profile)


@router.post("/applications/{profile_id}/reactivate", response_model=AdminApplicationDetail)
async def reactivate_application(profile_id: str, body: AdminActionRequest = Body(default=AdminActionRequest()), admin: User = Depends(current_admin)):
    """Reactivate a suspended/deactivated assessor back to APPROVED + assessor role."""
    profile = await _get_profile_or_404(profile_id)
    await _apply_transition(profile, admin, "reactivate", AssessorStatus.APPROVED, grant_access=True, reason=(body.reason or "").strip() or None)
    return await _detail(profile)


@router.post("/applications/{profile_id}/reject", response_model=AdminApplicationDetail)
async def reject_application(profile_id: str, body: AdminActionRequest = Body(...), admin: User = Depends(current_admin)):
    """Reject — status=REJECTED, role reverted to consumer. Reason required."""
    profile = await _get_profile_or_404(profile_id)
    reason = _require_reason(body, "reject")
    await _apply_transition(profile, admin, "reject", AssessorStatus.REJECTED, grant_access=False, reason=reason)
    return await _detail(profile)


@router.post("/applications/{profile_id}/suspend", response_model=AdminApplicationDetail)
async def suspend_application(profile_id: str, body: AdminActionRequest = Body(...), admin: User = Depends(current_admin)):
    """Suspend an approved assessor — status=SUSPENDED, role reverted to consumer
    so the gate closes immediately. Reason required."""
    profile = await _get_profile_or_404(profile_id)
    reason = _require_reason(body, "suspend")
    await _apply_transition(profile, admin, "suspend", AssessorStatus.SUSPENDED, grant_access=False, reason=reason)
    return await _detail(profile)


@router.post("/applications/{profile_id}/deactivate", response_model=AdminApplicationDetail)
async def deactivate_application(profile_id: str, body: AdminActionRequest = Body(default=AdminActionRequest()), admin: User = Depends(current_admin)):
    """Deactivate — status=INACTIVE, role reverted to consumer. Reason optional."""
    profile = await _get_profile_or_404(profile_id)
    await _apply_transition(profile, admin, "deactivate", AssessorStatus.INACTIVE, grant_access=False, reason=(body.reason or "").strip() or None)
    return await _detail(profile)


@router.post("/applications/{profile_id}/request-info", response_model=AdminApplicationDetail)
async def request_info(profile_id: str, body: AdminActionRequest = Body(...), admin: User = Depends(current_admin)):
    """Ask the applicant for more information. Status stays PENDING and the role
    is untouched; the typed reason is stored on the profile and audited so the
    applicant can see what's needed. Reason required."""
    profile = await _get_profile_or_404(profile_id)
    reason = _require_reason(body, "request more information")
    await _apply_transition(profile, admin, "request_info", AssessorStatus.PENDING, grant_access=None, reason=reason)
    return await _detail(profile)

# API schemas for the admin app (Phase 3).
#
# The admin reviews assessor applications and acts on them. These are the
# request/response shapes for the /admin/* router. The admin sees MORE than the
# applicant's own AssessorProfileRead (it includes the owning user's email/name
# and every stored field), but still NEVER the raw on-disk document paths - only
# a {doc_type, uploaded_at} summary plus a stable index to stream each file by.

from datetime import datetime

from pydantic import BaseModel

from app.models.assessor_profile import AssessorProfile, AssessorStatus


class AdminMe(BaseModel):
    """Cheap identity check for the logged-in admin (drives the admin app gate)."""

    id: str
    email: str
    name: str | None = None
    role: str


class AdminDocumentSummary(BaseModel):
    """One uploaded document as the admin sees it in the list: its type, when it
    was uploaded, and the index used to stream the file. Never the raw path."""

    index: int
    doc_type: str
    uploaded_at: datetime


class AdminApplicationSummary(BaseModel):
    """One row in the admin queue. Light - no full field dump."""

    id: str
    status: AssessorStatus
    user_email: str | None = None
    user_name: str | None = None
    legal_first_name: str | None = None
    legal_last_name: str | None = None
    business_name: str | None = None
    accreditation_number: str | None = None
    operating_states: list[str] = []
    document_count: int = 0
    created_at: datetime
    updated_at: datetime


class AdminApplicationDetail(BaseModel):
    """The full application as the admin reviews it: every profile field, the
    owning user's email/name, and a document summary list (with stream indexes)."""

    id: str
    status: AssessorStatus
    user_id: str
    user_email: str | None = None
    user_name: str | None = None

    legal_first_name: str | None = None
    legal_last_name: str | None = None
    date_of_birth: datetime | None = None
    phone: str | None = None
    business_name: str | None = None
    trading_name: str | None = None
    abn: str | None = None
    accreditation_number: str | None = None
    accreditation_level: str | None = None
    accreditation_expiry: datetime | None = None
    qualification: str | None = None
    operating_states: list[str] = []
    operating_lgas: list[str] = []
    base_address: str | None = None
    service_radius_km: float | None = None
    insurer: str | None = None
    insurance_policy_number: str | None = None
    insurance_expiry: datetime | None = None
    max_active_jobs: int
    accepting_new_work: bool
    documents: list[AdminDocumentSummary] = []
    review_reason: str | None = None
    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_profile(
        cls, profile: AssessorProfile, user_email: str | None, user_name: str | None
    ) -> "AdminApplicationDetail":
        return cls(
            id=str(profile.id),
            status=profile.status,
            user_id=str(profile.user_id),
            user_email=user_email,
            user_name=user_name,
            legal_first_name=profile.legal_first_name,
            legal_last_name=profile.legal_last_name,
            date_of_birth=profile.date_of_birth,
            phone=profile.phone,
            business_name=profile.business_name,
            trading_name=profile.trading_name,
            abn=profile.abn,
            accreditation_number=profile.accreditation_number,
            accreditation_level=profile.accreditation_level,
            accreditation_expiry=profile.accreditation_expiry,
            qualification=profile.qualification,
            operating_states=profile.operating_states,
            operating_lgas=profile.operating_lgas,
            base_address=profile.base_address,
            service_radius_km=profile.service_radius_km,
            insurer=profile.insurer,
            insurance_policy_number=profile.insurance_policy_number,
            insurance_expiry=profile.insurance_expiry,
            max_active_jobs=profile.max_active_jobs,
            accepting_new_work=profile.accepting_new_work,
            documents=[
                AdminDocumentSummary(index=i, doc_type=d.doc_type, uploaded_at=d.uploaded_at)
                for i, d in enumerate(profile.documents)
            ],
            review_reason=profile.review_reason,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )


class AdminActionRequest(BaseModel):
    """Body for an admin action. `reason` is mandatory for reject / request-info /
    suspend (enforced in the handler); optional for approve / reactivate /
    deactivate."""

    reason: str | None = None


# ── Overview dashboard ────────────────────────────────────────────────────────
# Shapes for GET /admin/overview — the platform analytics cockpit. Each block
# below maps to one widget on the admin Overview screen (KPIs / timeline / pie /
# bar / map / activity feed). All counts are computed server-side via Mongo
# aggregation so the dashboard is a single round-trip.


class AdminKpis(BaseModel):
    """The headline counters across the top of the dashboard."""

    total_cases: int = 0
    signed_cases: int = 0  # COMPLETE / signed-off determinations
    cases_in_review: int = 0  # submitted-to-assessor … ready-to-sign
    total_users: int = 0
    assessors_active: int = 0  # AssessorProfile.status == APPROVED
    applications_pending: int = 0  # AssessorProfile.status == PENDING


class CountBucket(BaseModel):
    """A generic {label, count} pair driving the bar/pie charts."""

    label: str
    count: int


class TimelinePoint(BaseModel):
    """One zero-filled day on the activity timeline."""

    date: str  # YYYY-MM-DD
    cases: int = 0
    signoffs: int = 0
    signups: int = 0


class MapPoint(BaseModel):
    """One assessed property plotted on the map, colored by BAL rating."""

    lat: float
    lng: float
    rating: str | None = None
    address: str | None = None
    status: str | None = None


class ActivityItem(BaseModel):
    """One recent admin action for the activity feed."""

    action: str
    admin_email: str | None = None
    target_email: str | None = None
    reason: str | None = None
    timestamp: datetime


class AdminOverview(BaseModel):
    """The full Overview payload — one block per dashboard widget."""

    kpis: AdminKpis
    cases_by_status: list[CountBucket] = []
    bal_distribution: list[CountBucket] = []
    timeline: list[TimelinePoint] = []
    map_points: list[MapPoint] = []
    assessor_status: list[CountBucket] = []
    assessor_states: list[CountBucket] = []
    recent_activity: list[ActivityItem] = []

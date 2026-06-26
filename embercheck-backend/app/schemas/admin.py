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

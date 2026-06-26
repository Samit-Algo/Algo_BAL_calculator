# API schemas for assessor registration (Phase 2, Step 2).
#
# AssessorRegistrationRequest is the ONLY shape a client may submit. It is a
# deliberately narrow allow-list: it carries no status, user_id, documents,
# base_location, review_reason or timestamps, so a client can never set who they
# are, grant themselves approval, or forge a profile's server-controlled fields.
# The route hardcodes status=PENDING and stamps user_id from the token.
#
# AssessorProfileRead is the owner-facing view returned by register / GET me /
# document upload. It exposes a documents SUMMARY (doc_type + uploaded_at), never
# the raw on-disk file paths.

from datetime import datetime

from pydantic import BaseModel

from app.models.assessor_profile import AssessorProfile, AssessorStatus


class AssessorRegistrationRequest(BaseModel):
    """The fields a consumer supplies to apply to become an assessor. Required
    where a real accredited assessor must provide it (identity, contact,
    business, accreditation, operating area); optional elsewhere. No
    server-controlled field (status/user_id/documents/base_location/timestamps)
    is accepted here."""

    # Personal identity.
    legal_first_name: str
    legal_last_name: str
    date_of_birth: datetime | None = None

    # Contact (email lives on User).
    phone: str

    # Business.
    business_name: str
    trading_name: str | None = None
    abn: str | None = None

    # Accreditation.
    accreditation_number: str
    accreditation_level: str
    accreditation_expiry: datetime
    qualification: str | None = None

    # Operating area.
    operating_states: list[str]
    operating_lgas: list[str]
    base_address: str
    service_radius_km: float | None = None

    # Insurance.
    insurer: str | None = None
    insurance_policy_number: str | None = None
    insurance_expiry: datetime | None = None

    # Capacity preference. None -> the model default (20) applies.
    max_active_jobs: int | None = None


class AssessorSearchResult(BaseModel):
    """One assessor a consumer may choose for their case (Phase 4 — read-only,
    state-level match). Carries only the launch fields needed to choose; private
    contact details (email/phone/abn) are NOT exposed until assignment. The
    `assessor_id` is the assessor's User id — the key a later phase assigns by."""

    assessor_id: str
    business_name: str | None = None
    legal_name: str | None = None
    accreditation_level: str | None = None
    accreditation_number: str | None = None
    operating_states: list[str] = []
    accepting_new_work: bool = True


class AssessorDocumentSummary(BaseModel):
    """One uploaded document as shown back to its owner: the type and when it
    was uploaded, never the raw storage path."""

    doc_type: str
    uploaded_at: datetime


class AssessorProfileRead(BaseModel):
    """An assessor profile as returned to its owner."""

    id: str
    status: AssessorStatus

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

    documents: list[AssessorDocumentSummary] = []
    review_reason: str | None = None

    created_at: datetime
    updated_at: datetime

    @classmethod
    def from_profile(cls, profile: AssessorProfile) -> "AssessorProfileRead":
        return cls(
            id=str(profile.id),
            status=profile.status,
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
                AssessorDocumentSummary(doc_type=d.doc_type, uploaded_at=d.uploaded_at)
                for d in profile.documents
            ],
            review_reason=profile.review_reason,
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )

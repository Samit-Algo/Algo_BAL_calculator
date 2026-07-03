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
    # Presence flag so the picker can show a photo badge (served via
    # GET /assessor/{id}/photo). Never the raw disk path.
    has_photo: bool = False


class AssessorPublicProfile(BaseModel):
    """An APPROVED assessor's public profile, safe for any logged-in consumer to
    view when choosing who certifies their case (a richer read than the picker's
    AssessorSearchResult). Like that model, this is a deliberate allow-list — it
    carries ONLY non-sensitive, professional-credential fields. It NEVER exposes
    private/contact data: no phone, date_of_birth, abn, insurer, insurance policy
    number/expiry, base street address, raw document paths, review_reason, internal
    ids or timestamps. Insurance is surfaced as a presence flag only
    (`insurance_on_file`) — never the insurer, number, or dates. No rating field
    exists (ratings aren't built yet). Only ever built from an APPROVED profile;
    the route 404s otherwise, so pending/rejected/suspended are never viewable."""

    business_name: str | None = None
    trading_name: str | None = None
    legal_name: str | None = None
    accreditation_level: str | None = None
    accreditation_number: str | None = None
    accreditation_expiry: datetime | None = None
    qualification: str | None = None
    operating_states: list[str] = []
    operating_lgas: list[str] = []
    service_radius_km: float | None = None
    accepting_new_work: bool = True
    status: AssessorStatus
    # Presence only — true if any insurance detail is on file. Never exposes the
    # insurer name, policy number, or expiry.
    insurance_on_file: bool = False

    # Photo + banner are safe to surface to a consumer viewing the public profile.
    # Presence flags + a colour/gradient-id only; raw disk paths are NEVER exposed.
    # The images are served via GET /assessor/{id}/photo and /assessor/{id}/banner.
    has_photo: bool = False
    banner_type: str | None = None
    banner_value: str | None = None
    has_banner_image: bool = False

    @classmethod
    def from_profile(cls, profile: AssessorProfile) -> "AssessorPublicProfile":
        return cls(
            business_name=profile.business_name,
            trading_name=profile.trading_name,
            legal_name=" ".join(
                part for part in (profile.legal_first_name, profile.legal_last_name) if part
            )
            or None,
            accreditation_level=profile.accreditation_level,
            accreditation_number=profile.accreditation_number,
            accreditation_expiry=profile.accreditation_expiry,
            qualification=profile.qualification,
            operating_states=profile.operating_states,
            operating_lgas=profile.operating_lgas,
            service_radius_km=profile.service_radius_km,
            accepting_new_work=profile.accepting_new_work,
            status=profile.status,
            insurance_on_file=bool(
                profile.insurer
                or profile.insurance_policy_number
                or profile.insurance_expiry
            ),
            has_photo=bool(profile.profile_photo_path),
            banner_type=profile.banner_type,
            banner_value=profile.banner_value,
            has_banner_image=bool(profile.banner_image_path),
        )


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

    # Presence flag only — true when a profile photo is on file. The raw disk path
    # (profile_photo_path) is NEVER exposed; the image is served via
    # GET /assessor/me/photo.
    has_photo: bool = False

    # Banner customization. banner_type/banner_value are safe to expose (a hex
    # colour or a gradient preset id). has_banner_image is a presence flag only —
    # the raw path is NEVER exposed; the image is served via GET /assessor/me/banner.
    banner_type: str | None = None
    banner_value: str | None = None
    has_banner_image: bool = False

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
            has_photo=bool(profile.profile_photo_path),
            banner_type=profile.banner_type,
            banner_value=profile.banner_value,
            has_banner_image=bool(profile.banner_image_path),
            created_at=profile.created_at,
            updated_at=profile.updated_at,
        )


class AssessorProfileUpdate(BaseModel):
    """The ONLY shape an assessor may submit to edit their OWN profile
    (PATCH /assessor/me). Like AssessorRegistrationRequest and
    AssessorPublicProfile, this is a deliberate allow-list — but a NARROWER one:
    it carries ONLY the 'basic info' fields an assessor may change themselves.

    It intentionally OMITS every trust/legal/server-controlled field — status,
    accreditation_number/level/expiry, abn, insurer/policy/expiry, review_reason,
    documents, user_id, id, timestamps — so a self-edit can never touch approval
    state, verified credentials, insurance evidence, or identity keys. Those are
    admin-only. AssessorRegistrationRequest is NOT reused here precisely because it
    accepts accreditation/insurance fields, and the model is never bound directly.

    Every field is optional: PATCH semantics mean 'update only what's provided'.
    Fields set to None are ignored by the route (via exclude_unset), so a client
    can't blank a value by omitting it."""

    legal_first_name: str | None = None
    legal_last_name: str | None = None
    phone: str | None = None
    business_name: str | None = None
    trading_name: str | None = None
    base_address: str | None = None
    operating_states: list[str] | None = None
    operating_lgas: list[str] | None = None
    service_radius_km: float | None = None
    accepting_new_work: bool | None = None
    max_active_jobs: int | None = None
    qualification: str | None = None

    # Banner: banner_type is "color" | "gradient" | "image" | None (reset). The
    # route validates the pair (hex for color, known preset id for gradient, an
    # existing uploaded image for "image"); the image itself is set by
    # POST /assessor/me/banner, never here.
    banner_type: str | None = None
    banner_value: str | None = None

    model_config = {"extra": "forbid"}

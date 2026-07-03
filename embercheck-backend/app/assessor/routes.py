# Assessor registration routes (Phase 2, Step 2).
#
# A logged-in CONSUMER applies to become an assessor. Registering creates an
# AssessorProfile(status=PENDING) and NOTHING else: the applicant's role is never
# touched, so they remain a consumer to every gate in the system. Access is
# granted only by admin approval in a later phase - never here.
#
# Three endpoints, all login-only (current_active_user):
#   POST /assessor/register   - create the PENDING profile (1 per user)
#   POST /assessor/documents  - attach supporting files to an existing profile
#   GET  /assessor/me         - read your own application (drives the frontend)

import re
import uuid
from datetime import datetime, timezone
from pathlib import Path

from beanie import PydanticObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.auth.backend import current_active_user
from app.config import settings as media_settings
from app.models.assessor_profile import AssessorDocument, AssessorProfile, AssessorStatus
from app.models.user import User
from app.schemas.assessor import (
    AssessorProfileRead,
    AssessorProfileUpdate,
    AssessorPublicProfile,
    AssessorRegistrationRequest,
)

_MEDIA_BY_EXT = {"jpg": "image/jpeg", "jpeg": "image/jpeg", "png": "image/png", "pdf": "application/pdf"}

# Banner customization. Images only for a banner upload. The gradient preset ids
# are a FIXED server-side set — the client maps each id to CSS, so no raw CSS is
# ever accepted or stored (only a validated id). Keep this set in sync with the
# console's GRADIENTS map.
BANNER_IMAGE_TYPES = {"image/jpeg", "image/png"}
ALLOWED_BANNER_TYPES = {"color", "gradient", "image"}
ALLOWED_GRADIENT_IDS = {"ember", "forest", "dusk", "clay", "slate"}
_HEX_RE = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$")


def _serve_media_or_404(rel_path: str | None) -> FileResponse:
    """Serve a stored media file (photo/banner) with the standard path-traversal
    guard: 404 if no path is set, the resolved file escapes the store, or it's
    missing. Mirrors admin/routes.py:394-403."""
    if not rel_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / rel_path).resolve()
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found.")
    ext = full.suffix.lstrip(".").lower()
    return FileResponse(full, media_type=_MEDIA_BY_EXT.get(ext, "application/octet-stream"))


async def _approved_profile_or_404(assessor_id: str) -> AssessorProfile:
    """Resolve an APPROVED assessor's profile by their User id, or 404. Shared by
    the public profile + public photo/banner routes so a non-approved assessor is
    never discoverable through any of them (unknown id, malformed id, or a
    pending/rejected/suspended profile all 404)."""
    try:
        oid = PydanticObjectId(assessor_id)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessor not found.")
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == oid)
    if profile is None or profile.status != AssessorStatus.APPROVED:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Assessor not found.")
    return profile

router = APIRouter(prefix="/assessor", tags=["assessor"])

# Registration accepts identity/insurance/accreditation docs, which are often
# PDFs - so this is DELIBERATELY broader than the consumer photo allow-list
# (cases/routes.py ALLOWED_IMAGE_TYPES). Defined locally and on purpose: widening
# the cases constant would let consumer photo uploads accept PDFs too.
ALLOWED_DOC_TYPES = {"image/jpeg", "image/png", "application/pdf"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB, mirrors the cases upload cap
_EXT_BY_TYPE = {"image/jpeg": "jpg", "image/png": "png", "application/pdf": "pdf"}


def _validate_abn(abn: str | None) -> None:
    """Shape-only check: an Australian ABN is 11 digits. We do NOT verify it
    against any registry - that's the admin's job in a later phase. Empty/None
    passes (the field is optional)."""
    if abn is None:
        return
    digits = abn.replace(" ", "")
    if digits and (len(digits) != 11 or not digits.isdigit()):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="abn must be 11 digits.",
        )


def _validate_banner(updates: dict, profile: AssessorProfile) -> None:
    """Validate the banner_type/banner_value pair in a PATCH before it is applied.
    banner_type absent -> nothing to check (they're editing other fields).
    banner_type None    -> reset to default (banner_value ignored).
    'color'   -> banner_value must be a hex colour.
    'gradient'-> banner_value must be a known preset id.
    'image'   -> a banner image must already be uploaded (set via POST /me/banner).
    A stray banner_value without banner_type is meaningless and rejected."""
    if "banner_type" not in updates:
        if updates.get("banner_value") is not None:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="banner_value requires banner_type.",
            )
        return

    bt = updates["banner_type"]
    bv = updates.get("banner_value")
    if bt is None:
        return
    if bt not in ALLOWED_BANNER_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"banner_type must be one of {sorted(ALLOWED_BANNER_TYPES)}.",
        )
    if bt == "color" and not (bv and _HEX_RE.match(bv)):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="banner_value must be a hex colour (e.g. #3c4733) when banner_type is 'color'.",
        )
    if bt == "gradient" and bv not in ALLOWED_GRADIENT_IDS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"banner_value must be one of {sorted(ALLOWED_GRADIENT_IDS)} when banner_type is 'gradient'.",
        )
    if bt == "image" and not profile.banner_image_path:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Upload a banner image first (POST /assessor/me/banner).",
        )


@router.post("/register", response_model=AssessorProfileRead, status_code=status.HTTP_201_CREATED)
async def register_assessor(
    body: AssessorRegistrationRequest,
    user: User = Depends(current_active_user),
):
    """Apply to become an assessor. Creates a PENDING profile owned by the caller
    and grants NO access (role is untouched). One application per user: a second
    attempt returns 409 with the current status. status and user_id are
    server-controlled - never read from the body."""
    existing = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if existing is not None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"You already have an assessor application (status: {existing.status.value}).",
        )

    _validate_abn(body.abn)

    # Map ONLY the client-supplied fields. status is hardcoded PENDING and
    # user_id comes from the token - neither is ever taken from the body.
    fields = body.model_dump(exclude_none=True)
    profile = AssessorProfile(
        user_id=user.id,
        status=AssessorStatus.PENDING,
        **fields,
    )
    await profile.insert()
    return AssessorProfileRead.from_profile(profile)


@router.post("/documents", response_model=AssessorProfileRead)
async def upload_assessor_documents(
    files: list[UploadFile],
    doc_types: list[str] | None = Form(None),
    user: User = Depends(current_active_user),
):
    """Attach supporting documents to your existing application. Each file is
    tagged by a parallel `doc_types` form field (one entry per file, same order;
    e.g. doc_types=accreditation&doc_types=insurance). If doc_types is omitted or
    shorter than files, the remaining files are tagged "unspecified". Files are
    written under PHOTO_STORAGE_DIR and only the relative path is stored."""
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Register before uploading documents.",
        )
    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one file is required.",
        )

    types = doc_types or []
    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()

    for i, upload in enumerate(files):
        if upload.content_type not in ALLOWED_DOC_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Only JPEG, PNG and PDF files are accepted (got {upload.content_type}).",
            )
        data = await upload.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Each file must be under 10 MB.",
            )

        doc_type = types[i] if i < len(types) else "unspecified"
        ext = _EXT_BY_TYPE[upload.content_type]
        filename = f"{uuid.uuid4().hex}.{ext}"
        rel_path = f"assessor_documents/{user.id}/{filename}"

        # Same write + path-traversal guard the cases upload uses: the resolved
        # destination must live under the store.
        dest = (base / rel_path).resolve()
        if base != dest and base not in dest.parents:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Invalid file path.",
            )
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

        profile.documents.append(AssessorDocument(file_path=rel_path, doc_type=doc_type))

        # A profile_photo upload also becomes the CURRENT avatar. If several are
        # sent in one request the last one wins, matching "latest photo".
        if doc_type == "profile_photo":
            profile.profile_photo_path = rel_path

    profile.updated_at = datetime.now(timezone.utc)
    await profile.save()
    return AssessorProfileRead.from_profile(profile)


@router.get("/me", response_model=AssessorProfileRead)
async def get_my_assessor_profile(user: User = Depends(current_active_user)):
    """Return the caller's own assessor application, or 404 if they haven't
    applied. The frontend uses this to choose between the form and the
    pending-approval state."""
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assessor application found.",
        )
    return AssessorProfileRead.from_profile(profile)


@router.patch("/me", response_model=AssessorProfileRead)
async def update_my_assessor_profile(
    body: AssessorProfileUpdate,
    user: User = Depends(current_active_user),
):
    """Edit your OWN basic profile details. The request body is
    AssessorProfileUpdate — a narrow allow-list that accepts ONLY basic-info
    fields (name, phone, business/trading name, base address, operating area,
    availability, qualification). It can NEVER change trust/legal/server fields:
    status, accreditation_*, abn, insurance_*, review_reason, documents, user_id,
    id or timestamps are absent from the schema (and `extra: forbid` rejects any
    stray field with 422), so a self-edit can't grant approval or forge
    credentials. Only fields the client actually sent are applied (exclude_unset),
    so omitting a field leaves it untouched rather than blanking it."""
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No assessor application found.",
        )

    # exclude_unset: apply ONLY the keys present in the request. Every key here is
    # an AssessorProfileUpdate field, so this can only ever touch safe fields.
    updates = body.model_dump(exclude_unset=True)
    _validate_banner(updates, profile)
    for field, value in updates.items():
        setattr(profile, field, value)

    profile.updated_at = datetime.now(timezone.utc)
    await profile.save()
    return AssessorProfileRead.from_profile(profile)


@router.get("/me/photo")
async def get_my_assessor_photo(user: User = Depends(current_active_user)):
    """Stream the caller's OWN current profile photo. Owner-only: it resolves the
    photo off the caller's profile (looked up by their token's user id), so one
    assessor can never fetch another's. 404 if no photo is on file or the file is
    missing. Same path-traversal guard as admin/routes.py:394-403 — the resolved
    file must live under PHOTO_STORAGE_DIR."""
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None or not profile.profile_photo_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile photo on file.")

    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / profile.profile_photo_path).resolve()
    # Guard against path traversal: the resolved file must live under the store.
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile photo on file.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No profile photo on file.")

    ext = full.suffix.lstrip(".").lower()
    return FileResponse(full, media_type=_MEDIA_BY_EXT.get(ext, "application/octet-stream"))


@router.post("/me/banner", response_model=AssessorProfileRead)
async def upload_my_assessor_banner(
    file: UploadFile,
    user: User = Depends(current_active_user),
):
    """Upload a banner image for your OWN profile and switch the banner to it.
    Images only (JPEG/PNG), 10 MB cap — same write + path-traversal guard as the
    document/photo uploads. Sets banner_image_path and flips banner_type to
    'image'. Returns the refreshed profile (has_banner_image becomes true)."""
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No assessor application found.")
    if file.content_type not in BANNER_IMAGE_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Only JPEG and PNG images are accepted (got {file.content_type}).",
        )
    data = await file.read()
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="The image must be under 10 MB.")

    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    ext = _EXT_BY_TYPE[file.content_type]
    rel_path = f"assessor_banners/{user.id}/{uuid.uuid4().hex}.{ext}"
    dest = (base / rel_path).resolve()
    if base != dest and base not in dest.parents:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid file path.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_bytes(data)

    profile.banner_image_path = rel_path
    profile.banner_type = "image"
    profile.updated_at = datetime.now(timezone.utc)
    await profile.save()
    return AssessorProfileRead.from_profile(profile)


@router.get("/me/banner")
async def get_my_assessor_banner(user: User = Depends(current_active_user)):
    """Stream the caller's OWN banner image. Owner-only (resolved off the caller's
    token), 404 if none/missing. Same path-traversal guard as GET /me/photo."""
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == user.id)
    if profile is None or not profile.banner_image_path:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No banner image on file.")

    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / profile.banner_image_path).resolve()
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No banner image on file.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No banner image on file.")

    ext = full.suffix.lstrip(".").lower()
    return FileResponse(full, media_type=_MEDIA_BY_EXT.get(ext, "application/octet-stream"))


@router.get("/{assessor_id}/public", response_model=AssessorPublicProfile)
async def get_public_assessor_profile(
    assessor_id: str,
    user: User = Depends(current_active_user),
):
    """A logged-in consumer's read of ANOTHER assessor's public profile — the
    richer view behind the case picker (GET /cases/{id}/assessors). Login-gated
    (current_active_user), same as the picker: not anonymous.

    `assessor_id` is the assessor's User id (the key the picker hands out). Only
    an APPROVED profile is ever returned; anything else — no such id, a malformed
    id, or a pending/rejected/suspended/inactive profile — is a flat 404 so
    non-approved assessors are never publicly discoverable. Mirrors the APPROVED
    filter used at cases/routes.py:213.

    The response is AssessorPublicProfile, a deliberate allow-list — it never
    carries phone, DOB, ABN, insurer/policy/expiry, street address, document
    paths, review_reason, ids, or timestamps. AssessorProfileRead (the private
    owner view) is intentionally NOT reused here."""
    profile = await _approved_profile_or_404(assessor_id)
    return AssessorPublicProfile.from_profile(profile)


@router.get("/{assessor_id}/photo")
async def get_assessor_public_photo(
    assessor_id: str,
    user: User = Depends(current_active_user),
):
    """Public profile photo of an APPROVED assessor — for a logged-in consumer
    viewing the profile/picker. Login-gated (not anonymous), APPROVED-only (404
    otherwise, same visibility rule as the public profile). Only the image bytes
    are returned; the raw path is never exposed."""
    profile = await _approved_profile_or_404(assessor_id)
    return _serve_media_or_404(profile.profile_photo_path)


@router.get("/{assessor_id}/banner")
async def get_assessor_public_banner(
    assessor_id: str,
    user: User = Depends(current_active_user),
):
    """Public banner image of an APPROVED assessor (only when they chose an image
    banner). Same login-gate + APPROVED-only visibility as the public photo."""
    profile = await _approved_profile_or_404(assessor_id)
    return _serve_media_or_404(profile.banner_image_path)

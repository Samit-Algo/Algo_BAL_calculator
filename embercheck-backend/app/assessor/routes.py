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

import uuid
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, status

from app.auth.backend import current_active_user
from app.config import settings as media_settings
from app.models.assessor_profile import AssessorDocument, AssessorProfile, AssessorStatus
from app.models.user import User
from app.schemas.assessor import AssessorProfileRead, AssessorRegistrationRequest

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

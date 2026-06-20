# Case routes (Phase 1, Step 3a + 5b-i): create a case (server-side assessment),
# list the caller's cases, read one back, and submit a completed case for
# accredited assessment. All require a logged-in user; a case can only be
# touched by its owner. Deep analysis (photos) is gated separately on
# /assess/photos.

from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.responses import FileResponse

from app.auth.backend import current_active_user
from app.cases.service import get_owned_case_or_404, polygon_coordinates
from app.config import settings as media_settings
from app.models.assessment import AssessmentRequest
from app.models.case import Case, CaseStatus, PropertyInfo
from app.models.user import User
from app.schemas.case import CaseCreateRequest, CaseRead, CaseSummary
from app.services.assessment_pipeline import run_assessment

router = APIRouter(prefix="/cases", tags=["cases"])


@router.post("", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
async def create_case(
    body: CaseCreateRequest,
    user: User = Depends(current_active_user),
):
    """Run the assessment server-side via the EXISTING pipeline (identical to
    /assess) and save it as a DRAFT case owned by the caller."""
    # Reuse the exact public /assess path (boundary mode included via site_polygon).
    request = AssessmentRequest(
        address=body.address,
        fire_danger_override=body.fire_danger_override,
        slope_override=body.slope_override,
        site_polygon=body.boundary_polygon,
    )
    result = None
    async for kind, payload in run_assessment(request):
        if kind == "error":
            raise HTTPException(
                status_code=payload["status_code"], detail=payload["detail"]
            )
        if kind == "result":
            result = payload

    if result is None:  # pragma: no cover - pipeline always yields a result/error
        raise HTTPException(status_code=500, detail="Assessment did not complete.")

    case = Case(
        user_id=user.id,
        property=PropertyInfo(
            address=body.address,
            matched_address=result.get("matched_address"),
            latitude=result.get("latitude"),
            longitude=result.get("longitude"),
            lga=result.get("lga"),
            boundary_polygon=polygon_coordinates(body.boundary_polygon),
        ),
        assessment=result,
        bal_rating=result.get("bal_rating"),
        governing_direction=result.get("governing_direction"),
        status=CaseStatus.DRAFT,
    )
    await case.insert()
    return CaseRead.from_case(case)


@router.get("", response_model=list[CaseSummary])
async def list_cases(user: User = Depends(current_active_user)):
    """The caller's cases, newest first (updated_at desc). Light summaries only -
    no full assessment dict."""
    cases = await Case.find(Case.user_id == user.id).sort(-Case.updated_at).to_list()
    return [CaseSummary.from_case(case) for case in cases]


@router.get("/{case_id}", response_model=CaseRead)
async def get_case(
    case_id: str,
    user: User = Depends(current_active_user),
):
    """Return one of the caller's cases. Unknown id, malformed id, or a case
    owned by someone else all return 404."""
    case = await get_owned_case_or_404(case_id, user.id)
    return CaseRead.from_case(case)


@router.get("/{case_id}/photos/{direction}")
async def get_case_photo(
    case_id: str,
    direction: str,
    user: User = Depends(current_active_user),
):
    """Serve one of the caller's stored capture photos (JPEG) for a case, so the
    dashboard/resume view can show the thumbnails. Ownership-checked; reads the
    file the photo_store wrote under PHOTO_STORAGE_DIR via its stored file_path.
    The image bytes are NOT in MongoDB — only the path reference is."""
    case = await get_owned_case_or_404(case_id, user.id)

    photo = next(
        (p for p in case.photos if (p.direction or "").lower() == direction.lower()),
        None,
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

    return FileResponse(full, media_type="image/jpeg")


@router.post("/{case_id}/submit", response_model=CaseRead)
async def submit_case(
    case_id: str,
    user: User = Depends(current_active_user),
):
    """Submit a completed case for accredited assessment (status transition
    only). Allowed from ANALYSIS_COMPLETE; idempotent if already submitted; a
    still-DRAFT case (analysis not done) is rejected with 409."""
    case = await get_owned_case_or_404(case_id, user.id)

    # Already submitted -> return current state (idempotent).
    if case.status == CaseStatus.SUBMITTED_TO_ASSESSOR:
        return CaseRead.from_case(case)

    # Only a completed analysis can be submitted.
    if case.status != CaseStatus.ANALYSIS_COMPLETE:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Complete the photo analysis before submitting.",
        )

    now = datetime.now(timezone.utc)
    case.status = CaseStatus.SUBMITTED_TO_ASSESSOR
    case.submitted_at = now
    case.updated_at = now
    await case.save()
    return CaseRead.from_case(case)

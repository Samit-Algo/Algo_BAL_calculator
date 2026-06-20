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
from app.cases.service import get_owned_case_or_404, polygon_coordinates, worst_read
from app.config import settings as media_settings
from app.models.assessment import AssessmentRequest
from app.models.case import Case, CaseStatus, PropertyInfo
from app.models.user import User
from app.schemas.case import (
    BoundaryUpdateRequest,
    CaseCreateRequest,
    CaseRead,
    CaseSummary,
)
from app.services.assessment_pipeline import run_assessment

router = APIRouter(prefix="/cases", tags=["cases"])


async def _assess(request: AssessmentRequest) -> dict:
    """Drive the shared pipeline (identical to /assess) and return the final
    result dict, surfacing a pipeline error as the matching HTTP status."""
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
    return result


@router.post("", response_model=CaseRead, status_code=status.HTTP_201_CREATED)
async def create_case(
    body: CaseCreateRequest,
    user: User = Depends(current_active_user),
):
    """Run the assessment server-side via the EXISTING pipeline (identical to
    /assess) and save it as a DRAFT case owned by the caller.

    A `boundary_polygon` creates a BOUNDARY-only case (the read is stored in
    `boundary_assessment`); the point read is skipped unless `include_point` is
    set, so a boundary save doesn't double-run the pipeline. Without a polygon it
    creates a point case. The denormalised headline is the WORST of both reads."""
    point_result = None
    boundary_result = None

    if body.boundary_polygon:
        boundary_result = await _assess(
            AssessmentRequest(
                address=body.address,
                fire_danger_override=body.fire_danger_override,
                slope_override=body.slope_override,
                site_polygon=body.boundary_polygon,
            )
        )
        if body.include_point:
            point_result = await _assess(
                AssessmentRequest(
                    address=body.address,
                    fire_danger_override=body.fire_danger_override,
                    slope_override=body.slope_override,
                )
            )
    else:
        point_result = await _assess(
            AssessmentRequest(
                address=body.address,
                fire_danger_override=body.fire_danger_override,
                slope_override=body.slope_override,
            )
        )

    # Property facts come from whichever read we have (both carry the same
    # top-level geocode / LGA fields). The headline is the worst of the two.
    facts = point_result or boundary_result
    worst = worst_read(point_result, boundary_result)

    case = Case(
        user_id=user.id,
        property=PropertyInfo(
            address=body.address,
            matched_address=facts.get("matched_address"),
            latitude=facts.get("latitude"),
            longitude=facts.get("longitude"),
            lga=facts.get("lga"),
            boundary_polygon=polygon_coordinates(body.boundary_polygon),
        ),
        assessment=point_result,
        boundary_assessment=boundary_result,
        bal_rating=worst.get("bal_rating") if worst else None,
        governing_direction=worst.get("governing_direction") if worst else None,
        status=CaseStatus.DRAFT,
    )
    await case.insert()
    return CaseRead.from_case(case)


@router.put("/{case_id}/boundary", response_model=CaseRead)
async def update_case_boundary(
    case_id: str,
    body: BoundaryUpdateRequest,
    user: User = Depends(current_active_user),
):
    """(Re)assess from a drawn boundary and store it on an EXISTING case in
    place, so editing a boundary updates the same record instead of inserting a
    duplicate. The point/photo read (`assessment`) and photos are left intact;
    the denormalised headline is recomputed as the WORST of both reads."""
    case = await get_owned_case_or_404(case_id, user.id)
    address = case.property.address
    if not address:
        raise HTTPException(
            status_code=400, detail="The case has no address to assess."
        )

    boundary_result = await _assess(
        AssessmentRequest(
            address=address,
            fire_danger_override=body.fire_danger_override,
            slope_override=body.slope_override,
            site_polygon=body.boundary_polygon,
        )
    )

    case.boundary_assessment = boundary_result
    case.property.boundary_polygon = polygon_coordinates(body.boundary_polygon)
    worst = worst_read(case.assessment, boundary_result)
    case.bal_rating = worst.get("bal_rating") if worst else None
    case.governing_direction = worst.get("governing_direction") if worst else None
    case.updated_at = datetime.now(timezone.utc)
    await case.save()
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

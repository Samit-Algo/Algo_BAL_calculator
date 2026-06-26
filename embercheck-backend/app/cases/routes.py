# Case routes (Phase 1, Step 3a + 5b-i): create a case (server-side assessment),
# list the caller's cases, read one back, and submit a completed case for
# accredited assessment. All require a logged-in user; a case can only be
# touched by its owner. Deep analysis (photos) is gated separately on
# /assess/photos.

import shutil
import uuid
from datetime import datetime, timezone
from pathlib import Path

import logging

from beanie import PydanticObjectId
from bson.errors import InvalidId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, HTTPException, UploadFile, status
from fastapi.responses import FileResponse

from app.auth.backend import current_active_user
from app.cases.service import (
    COMPASS_SIDES,
    build_or_merge_sector_evidence,
    derive_state,
    get_owned_case_or_404,
    polygon_coordinates,
    recompute_case_headline,
    worst_read,
)
from app.models.assessor_profile import AssessorProfile, AssessorStatus
from app.schemas.assessor import AssessorSearchResult
from app.config import settings as media_settings
from app.models.assessment import AssessmentRequest
from app.models.audit import AuditChange, CaseAuditEvent
from app.models.case import Case, CaseStatus, PropertyInfo, SectorEvidence, SectorOverrides, SectorPhoto
from app.models.user import User

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png"}
MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10 MB
from app.schemas.case import (
    BoundaryUpdateRequest,
    CaseCreateRequest,
    CaseRead,
    CaseSummary,
    SectorOverrideRequest,
    SubmitRequest,
)
from app.services.assessment_pipeline import run_assessment, reconcile_all_sectors
from app.services.sector_classifier import classify_and_combine

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
        sector_evidence=build_or_merge_sector_evidence(None, boundary_result),
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
    case.sector_evidence = build_or_merge_sector_evidence(
        case.sector_evidence, boundary_result,
    )
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


@router.get("/{case_id}/assessors", response_model=list[AssessorSearchResult])
async def list_assessors_for_case(
    case_id: str,
    user: User = Depends(current_active_user),
):
    """Assessors a consumer may choose for THIS case (Phase 4 — read-only).

    State-level match: the case's derived state (NSW today) against the
    assessor's `operating_states`. Returns only APPROVED assessors who are
    accepting new work; suspended/rejected/pending and opted-out assessors are
    excluded. No distance/rating/turnaround yet (no geo, no job history). An
    unresolved state (no NSW signal) returns an empty list rather than every
    assessor. Choosing/assignment lands in Phase 5 — this only lists."""
    case = await get_owned_case_or_404(case_id, user.id)
    state = derive_state(case)
    if not state:
        return []

    profiles = await AssessorProfile.find(
        AssessorProfile.status == AssessorStatus.APPROVED,
        AssessorProfile.accepting_new_work == True,  # noqa: E712 (Beanie query expr)
        AssessorProfile.operating_states == state,  # array-contains in Mongo
    ).to_list()

    results = [
        AssessorSearchResult(
            assessor_id=str(p.user_id),
            business_name=p.business_name,
            legal_name=" ".join(
                part for part in (p.legal_first_name, p.legal_last_name) if part
            ) or None,
            accreditation_level=p.accreditation_level,
            accreditation_number=p.accreditation_number,
            operating_states=p.operating_states,
            accepting_new_work=p.accepting_new_work,
        )
        for p in profiles
    ]
    results.sort(key=lambda r: (r.business_name or r.legal_name or "").lower())
    return results


@router.delete("/{case_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_case(
    case_id: str,
    user: User = Depends(current_active_user),
):
    """Delete one of the caller's OWN cases and its associated photo files.

    Ownership is checked exactly like the sibling routes via
    get_owned_case_or_404: an unknown id, a malformed id, or a case owned by
    someone else all return 404 (we never reveal another user's case). Deleting
    an already-gone case is therefore a 404, never a 500.

    The case's sub-records (sector_evidence, photos) are stored INLINE on the
    Case document, so they're removed when the document is. The only external
    artifacts are the JPEGs on disk: the boundary sector photos (step 1) and the
    point-mode capture photos, both keyed by a relative file_path under
    PHOTO_STORAGE_DIR. Files are deleted BEFORE the document so a successful
    record delete can never orphan them; a missing file is tolerated (logged and
    skipped) so a partially-cleaned case never 500s.
    """
    case = await get_owned_case_or_404(case_id, user.id)

    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()

    # Every file this case owns: boundary sector photos + point-mode photos.
    rel_paths: list[str] = []
    for ev in case.sector_evidence or []:
        for photo in ev.photos or []:
            if photo.file_path:
                rel_paths.append(photo.file_path)
    for photo in case.photos or []:
        if photo.file_path:
            rel_paths.append(photo.file_path)

    for rel in rel_paths:
        try:
            full = (base / rel).resolve()
            # Path-traversal guard: only ever touch files under the store.
            if base != full and base not in full.parents:
                continue
            if full.is_file():
                full.unlink()
        except OSError:
            _analysis_log.warning(
                "delete_case: could not remove file %s (case=%s)", rel, case_id,
            )

    # Best-effort: remove the case's own sector-photo directory tree
    # (PHOTO_STORAGE_DIR/<case_id>), tolerating anything already gone.
    case_dir = (base / case_id).resolve()
    if base in case_dir.parents and case_dir.is_dir():
        shutil.rmtree(case_dir, ignore_errors=True)

    # Files cleaned up -> now remove the record (embedded sub-records go with it).
    await case.delete()
    return None


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


def _build_analysis_logger() -> logging.Logger:
    """A logger for the sector-photo background analysis task, so a silent
    failure (VLM error, reconcile exception, task never scheduled) is never
    invisible. Mirrors vegetation_vision.py's VLM logger setup exactly."""

    logger = logging.getLogger("embercheck.analysis")
    if logger.handlers:  # already configured (avoid duplicate handlers on reload)
        return logger
    logger.setLevel(logging.INFO)
    logger.propagate = False
    try:
        media_settings.ANALYSIS_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(media_settings.ANALYSIS_LOG_PATH, encoding="utf-8")
    except OSError:
        # If the file can't be opened, fall back to console so logging never
        # breaks the request.
        handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger


_analysis_log = _build_analysis_logger()


async def _mark_side_error(case_id: str, compass_side: str) -> None:
    """Best-effort: load a FRESH case and mark one side's analysis as errored.
    Used only as a last resort when we don't already hold a loaded case/side
    (e.g. the case failed to load at all)."""
    try:
        case = await Case.get(case_id)
        if case and case.sector_evidence:
            side_ev = next(
                (ev for ev in case.sector_evidence if ev.compass_side == compass_side),
                None,
            )
            if side_ev:
                side_ev.analysis_status = "error"
                case.updated_at = datetime.now(timezone.utc)
                await case.save()
                _analysis_log.info("MARKED_ERROR case=%s side=%s", case_id, compass_side)
    except Exception:
        _analysis_log.exception("could not mark error case=%s side=%s", case_id, compass_side)


def _find_side(case: Case, compass_side: str) -> "SectorEvidence | None":
    """Re-resolve the SectorEvidence for one side from case.sector_evidence.

    CRITICAL: Beanie's Document.save() replaces case.sector_evidence with a
    NEW list of NEW objects after persisting (confirmed: a reference held
    across a save() call becomes a disconnected orphan - mutating it again
    silently writes nothing). So a side_ev reference must NEVER be held
    across an `await case.save()` boundary; always re-resolve via this
    helper immediately before reading or mutating a side after any save.
    """
    if not case.sector_evidence:
        return None
    return next((ev for ev in case.sector_evidence if ev.compass_side == compass_side), None)


async def _run_sector_analysis(case_id: str, compass_side: str) -> None:
    """Background task: classify photos via VLM, then reconcile BAL.

    Re-loads the case from the DB so there are no stale-object issues with the
    request-scoped document. Split into two save points so a bug in reconcile
    can NEVER discard a successful VLM classification:
      1. classify_and_combine -> save immediately (ai_proposal, combined_*).
      2. reconcile_all_sectors -> save again (final_bal, headline). If this
         step fails, the side is marked "error" but step 1's work survives.
    Every step is logged so a silent failure is never invisible. side_ev is
    re-resolved fresh after every save() - see _find_side's docstring.
    """
    _analysis_log.info("START case=%s side=%s", case_id, compass_side)
    case = await Case.get(case_id)
    if case is None:
        _analysis_log.warning("ABORT case=%s side=%s reason=case-not-found", case_id, compass_side)
        return

    side_ev = _find_side(case, compass_side)
    if side_ev is None:
        _analysis_log.warning("ABORT case=%s side=%s reason=side-not-found", case_id, compass_side)
        return

    # --- Stage 1: VLM classification. Saved immediately on success. ---
    try:
        _analysis_log.info(
            "CLASSIFY case=%s side=%s photo_count=%d", case_id, compass_side, len(side_ev.photos),
        )
        await classify_and_combine(side_ev)
        for i, photo in enumerate(side_ev.photos):
            prop = photo.ai_proposal
            if prop:
                _analysis_log.info(
                    "PHOTO_RESULT case=%s side=%s index=%d class=%s confidence=%.2f",
                    case_id, compass_side, i, prop.vegetation_class, prop.confidence,
                )
            else:
                _analysis_log.warning(
                    "PHOTO_RESULT case=%s side=%s index=%d ai_proposal=None", case_id, compass_side, i,
                )
        _analysis_log.info(
            "COMBINED case=%s side=%s combined_class=%s combined_confidence=%s flags=%s",
            case_id, compass_side, side_ev.combined_classification,
            side_ev.combined_confidence, side_ev.review_flags,
        )
        case.updated_at = datetime.now(timezone.utc)
        await case.save()
    except Exception:
        _analysis_log.exception("CLASSIFY_FAILED case=%s side=%s", case_id, compass_side)
        # Re-resolve: the pre-save `side_ev` is a disconnected orphan now.
        fresh = _find_side(case, compass_side)
        if fresh:
            fresh.analysis_status = "error"
            case.updated_at = datetime.now(timezone.utc)
            await case.save()
            _analysis_log.info("MARKED_ERROR case=%s side=%s", case_id, compass_side)
        return

    # side_ev is stale after the save above - re-resolve before Stage 2.
    side_ev = _find_side(case, compass_side)
    if side_ev is None:
        _analysis_log.warning("ABORT case=%s side=%s reason=side-vanished-after-save", case_id, compass_side)
        return

    # --- Stage 2: reconcile. A failure here marks "error" but the VLM
    # results saved in stage 1 are already persisted and stay that way. ---
    try:
        if case.boundary_assessment and case.sector_evidence:
            reconcile_all_sectors(
                case.sector_evidence, case.boundary_assessment, surface="consumer",
            )
            # Recompute the headline from scratch (raise OR lower) so the current
            # assessment is reflected after analysis completes.
            recompute_case_headline(case)
        # Re-resolve again: reconcile_all_sectors mutates case.sector_evidence
        # in place (no save happened yet), so side_ev is still valid here -
        # but re-resolving is cheap and removes any doubt.
        side_ev = _find_side(case, compass_side)
        _analysis_log.info(
            "RECONCILE case=%s side=%s final_bal=%s headline_bal=%s",
            case_id, compass_side, side_ev.final_bal if side_ev else None, case.bal_rating,
        )

        if side_ev:
            side_ev.analysis_status = "complete"
        case.updated_at = datetime.now(timezone.utc)
        await case.save()
        _analysis_log.info("COMPLETE case=%s side=%s", case_id, compass_side)
    except Exception:
        _analysis_log.exception("RECONCILE_FAILED case=%s side=%s", case_id, compass_side)
        # Re-resolve: anything mutated above (including `side_ev`) may be
        # stale relative to case.sector_evidence at this point.
        fresh = _find_side(case, compass_side)
        if fresh:
            fresh.analysis_status = "error"
            try:
                case.updated_at = datetime.now(timezone.utc)
                await case.save()
                _analysis_log.info("MARKED_ERROR case=%s side=%s", case_id, compass_side)
            except Exception:
                await _mark_side_error(case_id, compass_side)
        else:
            await _mark_side_error(case_id, compass_side)


@router.post("/{case_id}/sectors/{compass_side}/photos")
async def upload_sector_photos(
    case_id: str,
    compass_side: str,
    files: list[UploadFile],
    background_tasks: BackgroundTasks,
    user: User = Depends(current_active_user),
):
    """Upload photos for a compass side. Saves the files and returns 200
    immediately. VLM classification + BAL reconciliation run as a background
    task so the request is never blocked by the Groq API."""
    if compass_side not in COMPASS_SIDES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"compass_side must be one of {', '.join(COMPASS_SIDES)}.",
        )
    if not files:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="At least one file is required.",
        )

    case = await get_owned_case_or_404(case_id, user.id)

    now = datetime.now(timezone.utc)
    new_photos: list[SectorPhoto] = []

    for upload in files:
        if upload.content_type not in ALLOWED_IMAGE_TYPES:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail=f"Only JPEG and PNG images are accepted (got {upload.content_type}).",
            )
        data = await upload.read()
        if len(data) > MAX_UPLOAD_BYTES:
            raise HTTPException(
                status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
                detail="Each image must be under 10 MB.",
            )

        ext = "jpg" if upload.content_type == "image/jpeg" else "png"
        filename = f"{uuid.uuid4().hex}.{ext}"
        rel_path = f"{case_id}/{compass_side.lower()}/{filename}"

        dest = Path(media_settings.PHOTO_STORAGE_DIR).resolve() / rel_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(data)

        new_photos.append(SectorPhoto(
            file_path=rel_path,
            captured_at=now,
        ))

    if case.sector_evidence is None:
        case.sector_evidence = [SectorEvidence(compass_side=s) for s in COMPASS_SIDES]
    side_ev = next((ev for ev in case.sector_evidence if ev.compass_side == compass_side), None)
    if side_ev is None:
        side_ev = SectorEvidence(compass_side=compass_side)
        case.sector_evidence.append(side_ev)
    side_ev.photos.extend(new_photos)
    side_ev.analysis_status = "pending"
    # New evidence invalidates any prior assessor review of THIS side (see
    # SectorEvidence.invalidate_review): the photo the assessor confirmed is no
    # longer the whole story, so the side re-opens for review.
    side_ev.invalidate_review()

    # CONSOLE-B3.3 automatic review resume (§5): if the assessor had asked for more
    # photos and the consumer has now supplied evidence for a requested side (or for
    # ANY side when the request named none), clear the open photo request and send
    # the case straight back to the assessor's In-review worklist. An immutable audit
    # event records the automatic transition. NEEDS_MORE_PHOTOS supersedes the legacy
    # CHANGES_REQUESTED; both resume here.
    requested = case.photo_request_sides or []
    review_resumed = case.status in (CaseStatus.NEEDS_MORE_PHOTOS, CaseStatus.CHANGES_REQUESTED) and (
        not requested or compass_side in requested
    )
    if review_resumed:
        case.status = CaseStatus.UNDER_REVIEW
        case.review_reason = None
        case.photo_request_sides = []

    case.updated_at = now
    await case.save()

    if review_resumed:
        await CaseAuditEvent(
            case_id=case.id,
            assessor_id=None,
            assessor_email="System",
            compass_side=None,
            kind="auto_resume",
            changes=[AuditChange(field="status", previous="NEEDS_MORE_PHOTOS", new="UNDER_REVIEW")],
            reason=None,
        ).insert()

    background_tasks.add_task(_run_sector_analysis, str(case.id), compass_side)
    _analysis_log.info(
        "SCHEDULED case=%s side=%s new_photos=%d resumed=%s",
        case.id, compass_side, len(new_photos), review_resumed,
    )

    return {
        "compass_side": compass_side,
        "photos": [p.model_dump() for p in side_ev.photos],
        "analysis_status": "pending",
        # §5 consumer-facing acknowledgement — shown when the upload auto-returned
        # the case to the assessor. False/empty for an ordinary (non-requested) upload.
        "review_resumed": review_resumed,
        "status": case.status,
        "message": (
            "Additional evidence submitted. Your assessor has been notified."
            if review_resumed
            else None
        ),
    }


def _find_sector_photo(case, compass_side, photo_ref):
    """Find a SectorPhoto by photo_id or integer index. Returns (side_ev, photo)
    or raises 404."""
    if not case.sector_evidence:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    side_ev = next((ev for ev in case.sector_evidence if ev.compass_side == compass_side), None)
    if side_ev is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")

    # Try integer index first (backward compat), then photo_id.
    try:
        idx = int(photo_ref)
        if 0 <= idx < len(side_ev.photos):
            return side_ev, side_ev.photos[idx]
    except (ValueError, TypeError):
        pass

    photo = next((p for p in side_ev.photos if p.photo_id == photo_ref), None)
    if photo is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    return side_ev, photo


def _serve_photo(photo):
    """Resolve and serve a SectorPhoto's file, or 404."""
    base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
    full = (base / photo.file_path).resolve()
    if base != full and base not in full.parents:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    if not full.is_file():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Photo not found.")
    media_type = "image/png" if photo.file_path.endswith(".png") else "image/jpeg"
    return FileResponse(full, media_type=media_type)


@router.get("/{case_id}/sectors/{compass_side}/photos/{photo_ref}")
async def get_sector_photo(
    case_id: str,
    compass_side: str,
    photo_ref: str,
    user: User = Depends(current_active_user),
):
    """Serve a stored sector photo by photo_id or integer index.
    Ownership-checked; image bytes come from PHOTO_STORAGE_DIR."""
    case = await get_owned_case_or_404(case_id, user.id)
    _, photo = _find_sector_photo(case, compass_side, photo_ref)
    return _serve_photo(photo)


@router.delete("/{case_id}/sectors/{compass_side}/photos/{photo_id}")
async def delete_sector_photo(
    case_id: str,
    compass_side: str,
    photo_id: str,
    user: User = Depends(current_active_user),
):
    """Delete one photo from a side. Removes the SectorPhoto, deletes the file
    from disk, recombines the remaining proposals (no new VLM call), re-runs
    reconcile, and saves. If no photos remain the side reverts to GIS draft."""
    case = await get_owned_case_or_404(case_id, user.id)
    side_ev, photo = _find_sector_photo(case, compass_side, photo_id)

    # Remove from the photos list.
    side_ev.photos = [p for p in side_ev.photos if p.photo_id != photo.photo_id]

    # Delete the file from disk (best-effort).
    try:
        base = Path(media_settings.PHOTO_STORAGE_DIR).resolve()
        full = (base / photo.file_path).resolve()
        if base != full and base not in full.parents:
            pass
        elif full.is_file():
            full.unlink()
    except OSError:
        pass

    # Recombine from remaining proposals (no VLM call).
    from app.services.sector_classifier import combine_proposals
    remaining = [p.ai_proposal for p in side_ev.photos if p.ai_proposal is not None]
    combined_class, combined_conf, flags, reasoning = combine_proposals(
        remaining, side_ev.gis_draft_classification,
    )
    side_ev.combined_classification = combined_class
    side_ev.combined_confidence = combined_conf
    side_ev.combined_reasoning = reasoning
    side_ev.review_flags = flags
    side_ev.analysis_status = "complete" if remaining else None
    # The evidence the assessor reviewed has changed — re-open the side.
    side_ev.invalidate_review()

    # Re-run reconcile, then recompute the headline from scratch (raise OR lower).
    if case.boundary_assessment and case.sector_evidence:
        reconcile_all_sectors(
            case.sector_evidence, case.boundary_assessment, surface="consumer",
        )
        recompute_case_headline(case)

    case.updated_at = datetime.now(timezone.utc)
    await case.save()

    return {
        "compass_side": compass_side,
        "photos": [p.model_dump() for p in side_ev.photos],
        "combined_classification": side_ev.combined_classification,
        "combined_confidence": side_ev.combined_confidence,
        "combined_reasoning": side_ev.combined_reasoning,
        "review_flags": side_ev.review_flags,
        "final_bal": side_ev.final_bal,
        "analysis_status": side_ev.analysis_status,
        # Current case headline so the consumer can update without a refetch.
        "bal_rating": case.bal_rating,
        "governing_direction": case.governing_direction,
    }


# The classes a consumer/assessor may pick from. "low_risk" is the VLM/UI
# token for "no real fuel" - normalised to "Excluded" (the internal severity
# table's name for it) before storage, so override severity compares
# correctly against combined_classification/gis_draft_classification.
ALLOWED_OVERRIDE_CLASSES = {
    "Forest", "Woodland", "Shrubland", "Scrub", "Mallee/Heath",
    "Rainforest", "Grassland", "low_risk", "Excluded",
}


def _normalize_override_class(value: str) -> str:
    return "Excluded" if value == "low_risk" else value


def _get_or_create_side(case: Case, compass_side: str) -> SectorEvidence:
    if case.sector_evidence is None:
        case.sector_evidence = [SectorEvidence(compass_side=s) for s in COMPASS_SIDES]
    side_ev = next((ev for ev in case.sector_evidence if ev.compass_side == compass_side), None)
    if side_ev is None:
        side_ev = SectorEvidence(compass_side=compass_side)
        case.sector_evidence.append(side_ev)
    return side_ev


def _side_override_response(compass_side: str, side_ev: SectorEvidence, case: Case) -> dict:
    return {
        "compass_side": compass_side,
        "overrides": side_ev.overrides.model_dump() if side_ev.overrides else None,
        "combined_classification": side_ev.combined_classification,
        "review_flags": side_ev.review_flags,
        "final_bal": side_ev.final_bal,
        # Current case headline (raise OR lower) so the consumer updates its
        # displayed assessment without re-reading the whole case.
        "bal_rating": case.bal_rating,
        "governing_direction": case.governing_direction,
    }


ALLOWED_SLOPE_DIRECTIONS = {"downslope", "upslope", "flat"}


@router.put("/{case_id}/sectors/{compass_side}/override")
async def set_sector_override(
    case_id: str,
    compass_side: str,
    body: SectorOverrideRequest,
    user: User = Depends(current_active_user),
):
    """Set/merge a per-side override (vegetation, distance, slope). Send only
    the fields you're changing - others keep their previous value.

    vegetation_class follows the surface-aware raise-only rule. distance_m /
    effective_slope_degrees / slope_direction are full self-report, no
    guard - same as the point-mode "adjust the inputs" page. Persists
    immediately and recomputes final_bal + headline."""
    if compass_side not in COMPASS_SIDES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"compass_side must be one of {', '.join(COMPASS_SIDES)}.",
        )
    if body.vegetation_class is not None and body.vegetation_class not in ALLOWED_OVERRIDE_CLASSES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"vegetation_class must be one of {', '.join(sorted(ALLOWED_OVERRIDE_CLASSES))}.",
        )
    if body.slope_direction is not None and body.slope_direction not in ALLOWED_SLOPE_DIRECTIONS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"slope_direction must be one of {', '.join(sorted(ALLOWED_SLOPE_DIRECTIONS))}.",
        )
    if body.distance_m is not None and body.distance_m < 0:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="distance_m must be 0 or greater.",
        )

    case = await get_owned_case_or_404(case_id, user.id)
    side_ev = _get_or_create_side(case, compass_side)

    existing = side_ev.overrides or SectorOverrides()
    side_ev.overrides = SectorOverrides(
        vegetation_class=(
            _normalize_override_class(body.vegetation_class)
            if body.vegetation_class is not None else existing.vegetation_class
        ),
        distance_m=body.distance_m if body.distance_m is not None else existing.distance_m,
        effective_slope_degrees=(
            body.effective_slope_degrees if body.effective_slope_degrees is not None
            else existing.effective_slope_degrees
        ),
        slope_direction=body.slope_direction if body.slope_direction is not None else existing.slope_direction,
        override_by=str(user.id),
        override_at=datetime.now(timezone.utc),
    )
    # A consumer override changes this side's inputs — invalidate any assessor review.
    side_ev.invalidate_review()

    if case.boundary_assessment and case.sector_evidence:
        reconcile_all_sectors(
            case.sector_evidence, case.boundary_assessment, surface="consumer",
        )
        # Recompute the headline from scratch (raise OR lower) so it always
        # reflects the current assessment, not only ratcheting up.
        recompute_case_headline(case)

    case.updated_at = datetime.now(timezone.utc)
    await case.save()

    fresh = _get_or_create_side(case, compass_side)
    return _side_override_response(compass_side, fresh, case)


@router.delete("/{case_id}/sectors/{compass_side}/override")
async def clear_sector_override(
    case_id: str,
    compass_side: str,
    user: User = Depends(current_active_user),
):
    """Reset a side's override, reverting it to photo-combined (if photos
    exist) else the GIS draft. Persists immediately and recomputes."""
    if compass_side not in COMPASS_SIDES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"compass_side must be one of {', '.join(COMPASS_SIDES)}.",
        )

    case = await get_owned_case_or_404(case_id, user.id)
    side_ev = _get_or_create_side(case, compass_side)
    side_ev.overrides = None
    # Clearing the override changes this side's inputs — invalidate any assessor review.
    side_ev.invalidate_review()

    if case.boundary_assessment and case.sector_evidence:
        reconcile_all_sectors(
            case.sector_evidence, case.boundary_assessment, surface="consumer",
        )
        # A cleared override may LOWER this side back toward draft; recompute the
        # headline from scratch (raise OR lower) as the worst current read.
        recompute_case_headline(case)

    case.updated_at = datetime.now(timezone.utc)
    await case.save()

    fresh = _get_or_create_side(case, compass_side)
    return _side_override_response(compass_side, fresh, case)


async def _resolve_chosen_assessor(assessor_id: str, state: str | None) -> PydanticObjectId:
    """Validate the consumer's chosen assessor and return their User id. The
    assessor must have an APPROVED profile, be accepting new work, and cover the
    case's state — the same filter GET /cases/{id}/assessors applies, re-checked
    server-side so a stale/forged choice can't assign to an ineligible assessor."""
    try:
        oid = PydanticObjectId(assessor_id)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid assessor selection.")
    profile = await AssessorProfile.find_one(AssessorProfile.user_id == oid)
    if (
        profile is None
        or profile.status != AssessorStatus.APPROVED
        or not profile.accepting_new_work
        or (state is not None and state not in profile.operating_states)
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="That assessor isn't available for this case.",
        )
    return oid


@router.post("/{case_id}/submit", response_model=CaseRead)
async def submit_case(
    case_id: str,
    body: SubmitRequest = Body(default=SubmitRequest()),
    user: User = Depends(current_active_user),
):
    """Submit a case for accredited assessment, assigning it to the chosen
    assessor (Phase 5). `assessor_id` (from GET /cases/{id}/assessors) assigns the
    case to that assessor; omitting it submits unassigned (legacy global). Allowed
    from DRAFT or ANALYSIS_COMPLETE; idempotent if already submitted (re-supplying
    an assessor_id re-assigns). Cases already in the assessor's review lifecycle
    (UNDER_REVIEW etc.) are rejected with 409."""
    case = await get_owned_case_or_404(case_id, user.id)

    submittable = {
        CaseStatus.DRAFT,
        CaseStatus.ANALYSIS_COMPLETE,
        CaseStatus.SUBMITTED_TO_ASSESSOR,  # idempotent / allow (re)assignment
    }
    if case.status not in submittable:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="This case is already with an assessor and can't be re-submitted.",
        )

    now = datetime.now(timezone.utc)

    # Resolve + assign the chosen assessor (validated against the same filter as
    # the search), if one was supplied.
    if body.assessor_id:
        case.assigned_assessor_id = await _resolve_chosen_assessor(
            body.assessor_id, derive_state(case)
        )
        case.assigned_at = now

    if case.status != CaseStatus.SUBMITTED_TO_ASSESSOR:
        case.status = CaseStatus.SUBMITTED_TO_ASSESSOR
        case.submitted_at = now
    case.updated_at = now
    await case.save()
    return CaseRead.from_case(case)

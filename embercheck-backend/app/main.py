# Entry point for the EmberCheck Backend API.

import json
import logging
from contextlib import asynccontextmanager
from datetime import datetime, timezone

from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse

from app.models.assessment import (
    AssessmentRequest,
    PhotoAssessmentRequest,
    RecalcRequest,
)
from app.models.case import CaseStatus
from app.models.user import User
from app.services.address_lookup import get_address_suggestions
from app.services.assessment_pipeline import run_assessment
from app.services.photo_assessment import run_photo_assessment
from app.services.bal_recalculate import recalculate
from app.db.mongodb import init_db, close_db, get_client
from app.auth.backend import current_active_user
from app.auth.routes import router as auth_router
from app.cases.routes import router as cases_router
from app.cases.service import build_case_photos, get_owned_case_or_404

logger = logging.getLogger("embercheck")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Connect to MongoDB + initialise Beanie on startup, close it on shutdown.

    DB init is intentionally non-fatal: a missing/unreachable database must not
    stop the server, so the existing stateless assessment routes keep working
    exactly as before. Connectivity is surfaced by GET /db/ping, not by a crash.
    """
    try:
        await init_db()
        logger.info("MongoDB connected and Beanie initialised.")
    except Exception as exc:  # pragma: no cover - depends on live Atlas
        logger.warning("MongoDB init failed (DB features disabled): %s", exc)
    try:
        yield
    finally:
        await close_db()


app = FastAPI(title="EmberCheck Backend", lifespan=lifespan)

# Allow the frontend (which runs on a different origin) to call the API
# directly from the browser - both the local Vite dev server and the deployed
# production frontends. The regex also covers Cloudflare Pages preview URLs
# (e.g. https://<hash>.embercheck.pages.dev).
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://app.samitweb.xyz",
    ],
    allow_origin_regex=r"https://.*\.pages\.dev",
    allow_methods=["*"],
    allow_headers=["*"],
)

# Consumer-account auth (Phase 1, Step 2): /auth/register, /auth/login,
# /auth/refresh, /auth/logout, and /users/me. Additive only - no existing route
# is modified or gated here.
app.include_router(auth_router)

# Cases (Phase 1, Step 3a): POST /cases (server-side assessment, login-only) and
# GET /cases/{id} (owner-only). Deep analysis is gated on /assess/photos.
app.include_router(cases_router)


@app.get("/health")
def health_check():
    """Simple endpoint to check that the server is running."""
    return {"status": "ok"}


@app.get("/db/ping")
async def db_ping():
    """Verify the MongoDB connection with a lightweight admin ping. Returns
    {"db": "ok"} on success, or a 503 if the database is unreachable. No data
    is read or exposed."""
    try:
        await get_client().admin.command("ping")
        return {"db": "ok"}
    except Exception as exc:
        logger.warning("DB ping failed: %s", exc)
        raise HTTPException(status_code=503, detail="Database unavailable")


@app.get("/suggest")
async def suggest_addresses(q: str = ""):
    """
    Return a list of suggested address strings for autocomplete as the user
    types. Kept deliberately forgiving: short queries and upstream failures
    return an empty list rather than an error, so typing never breaks.
    """
    # Don't call the upstream API for 1-2 character queries - too little to
    # match on, and it wastes requests on every keystroke.
    if len(q.strip()) < 3:
        return []

    try:
        return await get_address_suggestions(q)
    except Exception:
        # Never let an autocomplete hiccup surface as a 500 to the user.
        return []


@app.post("/assess")
async def assess_property(request: AssessmentRequest):
    """
    Run the full BAL assessment for an address and return the result. Drives
    the shared pipeline generator, ignoring progress events and surfacing any
    error as the matching HTTP status.
    """
    async for kind, payload in run_assessment(request):
        if kind == "error":
            raise HTTPException(
                status_code=payload["status_code"], detail=payload["detail"]
            )
        if kind == "result":
            return payload


@app.post("/assess/photos")
async def assess_with_photos(
    request: PhotoAssessmentRequest,
    user: User = Depends(current_active_user),
):
    """
    Sharpen a saved case with the four capture photos (login-only, case-bound).
      1. load the caller's case (404 if missing/not owned)
      2. run the SAME photo-assessment compute as before, on the case's address
      3. persist the sharpened result + photos into the case (status ->
         ANALYSIS_COMPLETE)
      4. return the full sharpened assessment + the raw VLM read per side

    Distance and slope still come from the map; a failed/blocked photo simply
    falls back to that side's map value. The photo_store disk write is unchanged.
    """

    # 1 - the case must exist and belong to the caller; its stored address drives
    # the re-run (coords-only re-runs aren't wired yet).
    case = await get_owned_case_or_404(request.case_id, user.id)
    if not case.property.address:
        raise HTTPException(
            status_code=400,
            detail="The case has no address to sharpen the assessment.",
        )

    photos = [photo.model_dump() for photo in request.photos]

    # 2 - identical compute to the previous endpoint, now from the case address.
    assessment = await run_photo_assessment(
        address=case.property.address,
        latitude=case.property.latitude,
        longitude=case.property.longitude,
        fire_danger_override=request.fire_danger_override,
        slope_override=request.slope_override,
        photos=photos,
    )

    # 3 - persist the sharpened result into the case.
    case.assessment = assessment
    case.bal_rating = assessment.get("bal_rating")
    case.governing_direction = assessment.get("governing_direction")
    case.photos = build_case_photos(photos, assessment)
    case.status = CaseStatus.ANALYSIS_COMPLETE
    case.updated_at = datetime.now(timezone.utc)
    await case.save()

    # 4 - return the existing sharpened response, plus the case id.
    assessment["case_id"] = str(case.id)
    return assessment


@app.post("/assess/recalculate")
def recalculate_bal(request: RecalcRequest):
    """
    Recompute the per-direction BAL from known inputs plus manual overrides
    (distance, slope, vegetation type per side; FDI globally). No map scan, so
    it's instant. Sending no overrides reproduces the original result - that's
    how the UI's "reset to map calculation" works.
    """
    return recalculate(
        base_fdi=request.fire_danger_index,
        fire_danger_override=request.fire_danger_override,
        per_direction=[side.model_dump() for side in request.per_direction],
        overrides={key: value.model_dump() for key, value in request.overrides.items()},
    )


@app.post("/assess/stream")
async def assess_property_stream(request: AssessmentRequest):
    """
    Same assessment, streamed as Server-Sent Events so the UI can show each
    stage (address, LGA, FDI, vegetation, slope, BAL) as it actually happens.
    Each SSE message is a JSON object with a "type" of progress, error or
    result.
    """

    async def event_stream():
        async for kind, payload in run_assessment(request):
            if kind == "progress":
                message = {"type": "progress", **payload}
            elif kind == "error":
                message = {"type": "error", **payload}
            else:  # result
                message = {"type": "result", "data": payload}
            yield f"data: {json.dumps(message)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )

# The photo-assessment compute, extracted verbatim from the /assess/photos
# handler so it can be reused by the gated, case-bound endpoint (Phase 1,
# Step 3a). The COMPUTATION is unchanged - this is the exact same sequence the
# public endpoint already ran (VLM reads -> overrides -> re-run the per-direction
# pipeline -> attach reads -> persist the training-data record). Only its
# location moved; the result dict is byte-identical.

from fastapi import HTTPException

from app.models.assessment import AssessmentRequest
from app.services.assessment_pipeline import run_assessment
from app.services.photo_store import save_assessment_record
from app.services.vegetation_vision import read_photos, build_photo_overrides


async def run_photo_assessment(
    *,
    address: str,
    latitude: float | None,
    longitude: float | None,
    fire_danger_override: int | None,
    slope_override: float | None,
    photos: list[dict],
) -> dict:
    """Sharpen an assessment with the four capture photos and return the full
    sharpened assessment dict (with per-side photo_read, photo_reads, is_sharpened
    and assessment_id). Distance and slope still come from the map; a failed or
    blocked photo simply falls back to that side's map value."""

    # 1 + 2 - VLM reads -> overrides. read_photos never raises; a bad photo
    # becomes a "cant_tell" read that build_photo_overrides drops (keep map).
    reads = await read_photos(photos)
    photo_overrides = build_photo_overrides(reads)

    # 3 - re-run the existing per-direction pipeline with the photo overrides.
    pipeline_request = AssessmentRequest(
        address=address,
        fire_danger_override=fire_danger_override,
        slope_override=slope_override,
        photo_overrides=photo_overrides,
    )
    assessment = None
    async for kind, payload in run_assessment(pipeline_request):
        if kind == "error":
            raise HTTPException(
                status_code=payload["status_code"], detail=payload["detail"]
            )
        if kind == "result":
            assessment = payload

    if assessment is None:  # pragma: no cover - pipeline always yields a result/error
        raise HTTPException(status_code=500, detail="Assessment did not complete.")

    # 4 - attach the raw VLM read to each side (so the UI can show "why"), plus a
    # top-level map of the reads.
    reads_by_direction = {read["direction"]: read for read in reads}
    for side in assessment.get("per_direction", []):
        read = reads_by_direction.get(side["direction"].lower())
        side["photo_read"] = (
            {
                "class": read["class"],
                "confidence": read["confidence"],
                "condition": read["condition"],
                "limits": read["limits"],
            }
            if read
            else None
        )
    assessment["photo_reads"] = {
        read["direction"]: {
            "class": read["class"],
            "confidence": read["confidence"],
            "condition": read["condition"],
            "limits": read["limits"],
        }
        for read in reads
    }
    assessment["is_sharpened"] = True

    # 5 - persist the training-data record (best-effort).
    assessment["assessment_id"] = save_assessment_record(
        request_context={
            "address": address,
            "latitude": latitude,
            "longitude": longitude,
        },
        photos=photos,
        reads=reads,
        assessment=assessment,
    )

    return assessment

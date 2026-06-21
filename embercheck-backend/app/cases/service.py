# Shared case helpers (Phase 1, Step 3a): ownership-checked lookup and the
# photo -> CasePhoto mapping used when a case is sharpened. Kept separate from
# the router so the gated /assess/photos handler can reuse them without a
# circular import.

from datetime import datetime

from beanie import PydanticObjectId
from bson.errors import InvalidId
from fastapi import HTTPException, status

from app.models.case import Case, CasePhoto, SectorEvidence
from app.services.assessment_pipeline import BAL_SEVERITY

COMPASS_SIDES = ("North", "East", "South", "West")


def worst_read(*reads: dict | None) -> dict | None:
    """The worst (highest-BAL) read among those given, ignoring None.

    SAFETY: a case can hold several reads (the point read, the photo-sharpened
    point read, and the boundary edge read). The denormalised headline
    (``bal_rating`` / ``governing_direction``) must never sit below ANY stored
    read, so callers pick the worst with this and copy its ``bal_rating`` +
    ``governing_direction`` onto the case. Returns None only when every read is
    None / lacks a rating."""
    present = [r for r in reads if r and r.get("bal_rating")]
    if not present:
        return None
    return max(present, key=lambda r: BAL_SEVERITY.get(r["bal_rating"], -1))


async def get_owned_case_or_404(case_id: str, user_id: PydanticObjectId) -> Case:
    """Load a case the caller owns, or raise 404. A missing case, a malformed id,
    AND a case owned by someone else all return the SAME 404 - we never reveal
    that a case exists for another user (no 403)."""
    try:
        oid = PydanticObjectId(case_id)
    except (InvalidId, ValueError, TypeError):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")

    case = await Case.get(oid)
    if case is None or case.user_id != user_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Case not found.")
    return case


def governing_vegetation(case) -> str | None:
    """The vegetation class of the GOVERNING side, derived ON READ (e.g.
    "Woodland") so a case shows the side that sets the BAL rather than the
    top-level "Not classified". Searches BOTH stored reads (point + boundary) so
    a boundary-only case still resolves. Read-only: never writes or backfills.
    Falls back to a top-level vegetation_type, then None."""
    reads = [r for r in (case.assessment, case.boundary_assessment) if r]
    direction = case.governing_direction or next(
        (r.get("governing_direction") for r in reads if r.get("governing_direction")),
        None,
    )

    if direction:
        for read in reads:
            for side in read.get("per_direction") or []:
                if str(side.get("direction", "")).lower() == str(direction).lower():
                    veg = side.get("vegetation_class")
                    if veg:
                        return veg

    for read in reads:
        veg = read.get("vegetation_type")
        if veg:
            return veg
    return None


def polygon_coordinates(geojson: dict | None) -> list:
    """Extract the coordinate list from a GeoJSON Polygon or Feature for storage
    in PropertyInfo.boundary_polygon. Returns [] when no boundary was supplied."""
    if not geojson:
        return []
    if geojson.get("type") == "Feature":
        return (geojson.get("geometry") or {}).get("coordinates") or []
    return geojson.get("coordinates") or []


def build_or_merge_sector_evidence(
    existing: list[SectorEvidence] | None,
    boundary_assessment: dict | None,
) -> list[SectorEvidence] | None:
    """Build or refresh the four SectorEvidence entries from a boundary result.

    Returns None when there is no boundary assessment (point-only case). Otherwise
    returns exactly four entries (North/East/South/West) with gis_draft_classification
    set to the governing transect's vegetation class for that side, using the same
    worst-per-side rule the codebase already uses (highest BAL severity, ties broken
    by closest distance).

    MERGE rule: when ``existing`` carries an entry for a side, that entry is returned
    with only gis_draft_classification refreshed — photos, overrides,
    combined_classification, combined_confidence, review_flags, and final_bal are
    PRESERVED. This means re-assessing the boundary never destroys attached evidence.
    """
    if not boundary_assessment:
        return None

    per_direction = boundary_assessment.get("per_direction") or []

    # Group transects by compass side and pick each side's governing transect.
    side_governing: dict[str, dict | None] = {side: None for side in COMPASS_SIDES}
    for transect in per_direction:
        side = transect.get("outward_direction") or transect.get("direction")
        if side not in side_governing:
            continue
        best = side_governing[side]
        if best is None or _transect_worse_than(transect, best):
            side_governing[side] = transect

    # Index existing entries by compass_side for O(1) lookup.
    existing_by_side: dict[str, SectorEvidence] = {}
    if existing:
        for ev in existing:
            existing_by_side[ev.compass_side] = ev

    result: list[SectorEvidence] = []
    for side in COMPASS_SIDES:
        governing = side_governing[side]
        draft_class = (
            governing.get("vegetation_class")
            if governing and governing.get("vegetation_found")
            else None
        )
        prev = existing_by_side.get(side)
        if prev is not None:
            prev.gis_draft_classification = draft_class
            result.append(prev)
        else:
            result.append(SectorEvidence(
                compass_side=side,
                gis_draft_classification=draft_class,
            ))
    return result


def _transect_worse_than(candidate: dict, current: dict) -> bool:
    """True when candidate is worse (more severe) than current, using BAL severity
    then closest distance as tiebreaker — the same rule as buildSideSummaries."""
    cand_sev = BAL_SEVERITY.get(candidate.get("bal_rating", ""), -1)
    curr_sev = BAL_SEVERITY.get(current.get("bal_rating", ""), -1)
    if cand_sev != curr_sev:
        return cand_sev > curr_sev
    cand_dist = candidate.get("distance_m")
    curr_dist = current.get("distance_m")
    if cand_dist is None:
        return False
    if curr_dist is None:
        return True
    return cand_dist < curr_dist


def _parse_captured_at(value) -> datetime | None:
    """Best-effort parse of a captured_at ISO string into a datetime."""
    if not value or not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def build_case_photos(photos: list[dict], assessment: dict) -> list[CasePhoto]:
    """Map the captured photos + their VLM reads into CasePhoto entries. The
    JPEGs themselves are written by photo_store under
    PHOTO_STORAGE_DIR/<assessment_id>/<direction>.jpg; file_path is that relative
    location."""
    record_id = assessment.get("assessment_id")
    photo_reads = assessment.get("photo_reads", {})

    entries: list[CasePhoto] = []
    for photo in photos:
        direction = photo.get("intended_direction") or ""
        direction_key = direction.lower()
        file_path = f"{record_id}/{direction_key}.jpg" if record_id else None
        entries.append(
            CasePhoto(
                direction=direction,
                file_path=file_path,
                captured_at=_parse_captured_at(photo.get("captured_at")),
                vlm_result=photo_reads.get(direction_key),
                metadata={
                    "compass_heading_at_capture": photo.get("compass_heading_at_capture"),
                    "location": photo.get("location"),
                    "direction_source": photo.get("direction_source"),
                    "quality_check_results": photo.get("quality_check_results"),
                },
            )
        )
    return entries

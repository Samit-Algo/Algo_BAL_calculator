# The BAL assessment pipeline as a single async generator, so both the plain
# /assess endpoint and the streaming /assess/stream endpoint run the exact same
# logic. The generator yields events as it works through the stages:
#
#   ("progress", {stage, label, status, detail})   - status is "start" or "done"
#   ("error",    {status_code, detail})            - terminal; nothing follows
#   ("result",   <full response dict>)             - terminal; the final result
#
# This keeps the BAL/slope/FDI/vegetation logic untouched - it's just wrapped
# with progress signals so the UI can show what's actually happening.

from app.config import settings
from app.models.assessment import AssessmentRequest
from app.models.case import SectorEvidence
from app.services.address_lookup import geocode_address, AddressNotFoundError
from app.services.lga_lookup import get_lga_name, LgaNotFoundError
from app.services.fire_danger import get_fire_danger_index
from app.services.vegetation_finder import get_vegetation_at_point
from app.services.vegetation_classifier import classify_vegetation
from app.services.vegetation_scan import find_nearest_vegetation, DIRECTIONS
from app.services.slope_analyzer import calculate_slope, ElevationServiceError
from app.services.bal_calculator import calculate_bal
from app.services.photo_class_mapper import map_photo_class_to_pbp
from app.services.sector_classifier import CLASS_SEVERITY as VEG_SEVERITY


# BAL ratings from least to most severe. Used to pick the worst side, which
# governs the overall house BAL (per AS 3959 per-aspect assessment), and to
# decide whether a photo class raises or lowers a side's rating.
BAL_SEVERITY = {
    "BAL-LOW": 0,
    "BAL-12.5": 1,
    "BAL-19": 2,
    "BAL-29": 3,
    "BAL-40": 4,
    "BAL-FZ": 5,
}

# Minimum photo-class confidence to let the photo drive the BAL. Below this we
# keep the map's (conservative) value. Start point per the spec.
PHOTO_CONFIDENCE_THRESHOLD = 0.7


def resolve_side_bal(
    *,
    fdi,
    map_veg_form,
    map_as3959_class,
    map_class_manual_review,
    effective_slope_degrees,
    distance_m,
    vegetation_found,
    photo_entry,
):
    """
    Resolve one direction's vegetation class + BAL, reconciling the map with an
    optional photo class. Pure (no I/O) so it's directly unit-testable.

    The map gives the conservative baseline BAL. A photo entry is
    {"class": <AS3959 class>, "confidence": 0.0-1.0}. The photo only drives the
    result when it's confident and not "cant_tell"; distance and slope always
    come from the map. The safety direction:
        - photo raises or matches the map BAL  -> use photo (raising is free).
        - photo lowers the map BAL             -> use photo BUT force review
                                                  (a downgrade must be confirmed).

    Returns a dict: {vegetation_class, class_source ("map"|"photo"), bal_rating,
    requires_manual_review, _bal (the full calculate_bal dict that won, used for
    the governing top-level fields)}.
    """

    # Map-only BAL: the conservative baseline every side starts from.
    map_bal = calculate_bal(
        fdi=fdi,
        veg_form=map_veg_form,
        effective_slope_degrees=effective_slope_degrees,
        distance_m=distance_m,
        vegetation_found=vegetation_found,
        as3959_class=map_as3959_class,
    )
    map_review = map_bal["requires_manual_review"] or (
        map_class_manual_review if vegetation_found else False
    )

    # Default: keep the map.
    chosen = {
        "vegetation_class": map_as3959_class,
        "class_source": "map",
        "bal_rating": map_bal["bal_rating"],
        "requires_manual_review": map_review,
        # needs_distance: the photo sees hazardous vegetation the map didn't, so
        # we can't rate it until someone supplies a distance (see below).
        "needs_distance": False,
        "_bal": map_bal,
    }

    if not photo_entry:
        return chosen

    photo_class = photo_entry.get("class")
    confidence = photo_entry.get("confidence", 0.0)
    mapping = map_photo_class_to_pbp(photo_class)

    # Ignore the photo when it can't drive a result: low confidence, "cant_tell",
    # or a missing class. The conservative map value stands, source stays "map".
    if confidence < PHOTO_CONFIDENCE_THRESHOLD or not mapping["override"]:
        return chosen

    if not vegetation_found:
        # The map found no vegetation on this side, so there's no distance to
        # rate against. A low_risk photo just leaves the side at BAL-LOW. But a
        # confident HAZARDOUS photo shouldn't be silently dropped (that's what
        # hid "Woodland" behind "no vegetation"): surface the photo's class,
        # carry its formation so a distance can rate it on the result page, and
        # flag it for review / distance entry. The BAL stays BAL-LOW until a
        # distance is supplied - we never invent one.
        if mapping["pbp_formation"] == "Excluded":
            return chosen
        return {
            "vegetation_class": photo_class,
            "class_source": "photo",
            "bal_rating": map_bal["bal_rating"],  # BAL-LOW until a distance is set
            "requires_manual_review": True,
            "needs_distance": True,
            # Carry the photo's formation (not None) so the recalc step can rate
            # this side the moment a distance is entered.
            "_bal": {**map_bal, "pbp_formation": mapping["pbp_formation"]},
        }

    # Photo-driven BAL: same distance/slope/FDI, but the photo's PBP formation.
    photo_bal = calculate_bal(
        fdi=fdi,
        veg_form=map_veg_form,  # ignored - the override below takes precedence.
        effective_slope_degrees=effective_slope_degrees,
        distance_m=distance_m,
        vegetation_found=vegetation_found,
        as3959_class=map_as3959_class,
        pbp_formation_override=mapping["pbp_formation"],
    )

    photo_review = photo_bal["requires_manual_review"] or mapping["manual_review"]

    # Safety direction: lowering the rating must be human-confirmed; raising
    # (or matching) is always allowed without an extra flag.
    if BAL_SEVERITY[photo_bal["bal_rating"]] < BAL_SEVERITY[map_bal["bal_rating"]]:
        photo_review = True

    return {
        "vegetation_class": photo_class,
        "class_source": "photo",
        "bal_rating": photo_bal["bal_rating"],
        "requires_manual_review": photo_review,
        "needs_distance": False,
        "_bal": photo_bal,
    }


def _band_class_against_side(
    *, veg_class: str, side_transect: dict, fdi: int, slope_deg: float,
    distance_m: float | None, veg_found: bool,
) -> tuple[str, bool]:
    """Band one vegetation class against this side's real distance (if
    vegetation_found) else candidate geometry. Returns (bal_rating_or_
    'review_required_unassessable', used_candidate). Shared by the photo-raise
    path and the override-raise path so both band identically."""
    mapping = map_photo_class_to_pbp(veg_class)
    pbp_override = mapping["pbp_formation"] if mapping["override"] else None

    if veg_found:
        bal = calculate_bal(
            fdi=fdi, veg_form="", effective_slope_degrees=slope_deg,
            distance_m=distance_m, vegetation_found=True,
            as3959_class=veg_class, pbp_formation_override=pbp_override,
        )
        return bal["bal_rating"], False

    # No real hazard on this side - try candidate geometry (never fabricate
    # a distance; never produce a false-low when asserting a hazard exists).
    cand_dist = side_transect.get("candidate_distance_m")
    cand_slope = side_transect.get("candidate_effective_slope_degrees")
    if cand_dist is None:
        return "review_required_unassessable", True

    bal = calculate_bal(
        fdi=fdi, veg_form="", effective_slope_degrees=cand_slope if cand_slope is not None else 0.0,
        distance_m=cand_dist, vegetation_found=True,
        as3959_class=veg_class, pbp_formation_override=pbp_override,
    )
    return bal["bal_rating"], True


def reconcile_sector_bal(
    *,
    sector_ev: SectorEvidence,
    side_transect: dict,
    fdi: int,
    surface: str = "consumer",
) -> None:
    """Reconcile one side's GIS draft + photo combined_classification +
    assessor/consumer override and compute the final_bal. Mutates sector_ev
    in place (final_bal + review_flags). Pure except for the mutation.

    Precedence: effective class = override (if set) else combined-photos
    else GIS draft. surface="consumer": an override may only RAISE relative
    to what the photos/draft would already produce - a less-hazardous
    override is recorded but never lowers final_bal (flagged for review).
    surface="console": full reconciliation, lower-with-flag allowed (same
    rule the photo-vs-draft comparison already uses below).

    Implementation note: the override comparison is a layer ON TOP of the
    existing combined-vs-draft logic, not a rewrite of it - the no-override
    path below is therefore unchanged (anchor-safe by construction).
    """
    draft = sector_ev.gis_draft_classification
    combined = sector_ev.combined_classification
    overrides = sector_ev.overrides
    override = overrides.vegetation_class if overrides else None
    override_distance = overrides.distance_m if overrides else None
    override_slope = overrides.effective_slope_degrees if overrides else None

    flags: list[str] = list(sector_ev.review_flags or [])

    # The class the side would use with NO override - this is what the
    # override gets compared against (per the spec's precedence rule).
    pre_override_class = combined if combined else draft

    # The boundary pipeline's per_direction record uses "distance_m" /
    # "vegetation_class" (NOT "nearest_distance_m" / "nearest_as3959_class" -
    # those are the raw vegetation_scan.py field names, already renamed by the
    # time the record lands in boundary_assessment.per_direction).
    veg_found = side_transect.get("vegetation_found", False)
    distance_m = side_transect.get("distance_m")
    slope_deg = side_transect.get("effective_slope_degrees", 0.0)
    # The "keep unchanged" paths reuse this side's already-computed bal_rating
    # verbatim - provably byte-identical, and skips the vegForm bridge (which
    # needs the raw SVTM form string this record doesn't carry).
    base_bal_rating = side_transect.get("bal_rating")

    # Distance/slope override: full self-report, no guard (point-mode parity).
    # Replaces the GIS-measured geometry outright. Setting a distance asserts
    # vegetation exists at it (you can't have "distance to vegetation"
    # without vegetation), so it also forces veg_found=True. Because this
    # changes the geometry the "keep unchanged" paths verbatim-reuse, the
    # baseline bal_rating must be recomputed against whatever class would
    # otherwise apply (pre_override_class) at the new geometry.
    has_geometry_override = override_distance is not None or override_slope is not None
    if has_geometry_override:
        if override_distance is not None:
            distance_m = override_distance
            veg_found = True
        if override_slope is not None:
            slope_deg = override_slope
        if pre_override_class:
            mapping = map_photo_class_to_pbp(pre_override_class)
            pbp_o = mapping["pbp_formation"] if mapping["override"] else None
            bal = calculate_bal(
                fdi=fdi, veg_form="", effective_slope_degrees=slope_deg,
                distance_m=distance_m, vegetation_found=veg_found,
                as3959_class=pre_override_class, pbp_formation_override=pbp_o,
            )
            base_bal_rating = bal["bal_rating"]
        else:
            base_bal_rating = "BAL-LOW"
        if "geometry_overridden" not in flags:
            flags.append("geometry_overridden")

    pre_final_bal, flags = _reconcile_combined_vs_draft(
        draft=draft, combined=combined, base_bal_rating=base_bal_rating,
        veg_found=veg_found, distance_m=distance_m, slope_deg=slope_deg,
        side_transect=side_transect, fdi=fdi, surface=surface, flags=flags,
    )

    if not override:
        sector_ev.final_bal = pre_final_bal
        sector_ev.review_flags = flags
        return

    pre_sev = VEG_SEVERITY.get(pre_override_class, -1) if pre_override_class else -1
    override_sev = VEG_SEVERITY.get(override, 8)

    if override_sev > pre_sev:
        # Override MORE hazardous than what photos/draft would already give ->
        # RAISE. Same banding rule as the photo-raise path: real distance if
        # this side has hazardous vegetation, else candidate geometry, else
        # unassessable (never fabricate a distance, never a false-low).
        bal_rating, _used_candidate = _band_class_against_side(
            veg_class=override, side_transect=side_transect, fdi=fdi,
            slope_deg=slope_deg, distance_m=distance_m, veg_found=veg_found,
        )
        if bal_rating == "review_required_unassessable":
            if "override_vegetation_no_distance_review" not in flags:
                flags.append("override_vegetation_no_distance_review")
        sector_ev.final_bal = bal_rating
        sector_ev.review_flags = flags
        return

    if override_sev < pre_sev:
        # Override LESS hazardous -> keep the higher of (photos/draft);
        # never lower on the consumer surface. Flag for review either way -
        # an assessor should confirm a downgrade even on console.
        if "override_lower_than_draft_review" not in flags:
            flags.append("override_lower_than_draft_review")
        sector_ev.final_bal = pre_final_bal
        sector_ev.review_flags = flags
        return

    # Equal severity -> no functional change from the override.
    sector_ev.final_bal = pre_final_bal
    sector_ev.review_flags = flags


def _reconcile_combined_vs_draft(
    *, draft, combined, base_bal_rating, veg_found, distance_m, slope_deg,
    side_transect, fdi, surface, flags,
) -> tuple[str, list[str]]:
    """The pre-override combined-vs-draft reconciliation (unchanged from
    before overrides existed). Returns (final_bal, review_flags) instead of
    mutating, so reconcile_sector_bal can layer an override on top."""
    flags = list(flags)

    if not combined:
        # No photos / no combined -> use GIS draft unchanged (verbatim).
        return base_bal_rating, flags

    draft_sev = VEG_SEVERITY.get(draft, -1) if draft else -1
    combined_sev = VEG_SEVERITY.get(combined, 8)

    # Draft is None (GIS saw no hazard) but photos show vegetation.
    if draft is None or draft_sev < 0:
        if combined_sev <= 0:
            # Photos say Excluded too — no change.
            return base_bal_rating, flags

        # A distance/slope override forces veg_found=True with a real
        # distance - band directly against it, skipping candidate geometry
        # (the override already supplies what candidate geometry exists for).
        if veg_found:
            mapping = map_photo_class_to_pbp(combined)
            pbp_override = mapping["pbp_formation"] if mapping["override"] else None
            bal = calculate_bal(
                fdi=fdi, veg_form="", effective_slope_degrees=slope_deg,
                distance_m=distance_m, vegetation_found=True,
                as3959_class=combined, pbp_formation_override=pbp_override,
            )
            return bal["bal_rating"], flags

        # Photos show vegetation the map didn't — reclassify using candidate
        # geometry if available.
        cand_dist = side_transect.get("candidate_distance_m")
        cand_slope = side_transect.get("candidate_effective_slope_degrees")

        if cand_dist is None:
            # No candidate geometry — can't measure distance. Unassessable.
            if "photo_vegetation_no_distance_review" not in flags:
                flags.append("photo_vegetation_no_distance_review")
            return "review_required_unassessable", flags

        # Band from the candidate geometry + the photo's vegetation class.
        mapping = map_photo_class_to_pbp(combined)
        pbp_override = mapping["pbp_formation"] if mapping["override"] else None
        bal = calculate_bal(
            fdi=fdi,
            veg_form="",  # ignored - pbp_formation_override drives this.
            effective_slope_degrees=cand_slope if cand_slope is not None else 0.0,
            distance_m=cand_dist,
            vegetation_found=True,
            as3959_class=combined,
            pbp_formation_override=pbp_override,
        )
        if "photo_found_unmapped_vegetation" not in flags:
            flags.append("photo_found_unmapped_vegetation")
        return bal["bal_rating"], flags

    # Both draft and combined exist — compare severity.
    if combined_sev > draft_sev:
        # Combined MORE hazardous -> RAISE. Both surfaces.
        mapping = map_photo_class_to_pbp(combined)
        pbp_override = mapping["pbp_formation"] if mapping["override"] else None
        bal = calculate_bal(
            fdi=fdi, veg_form="", effective_slope_degrees=slope_deg,
            distance_m=distance_m, vegetation_found=veg_found,
            as3959_class=combined,
            pbp_formation_override=pbp_override,
        )
        return bal["bal_rating"], flags

    if combined_sev == draft_sev:
        # Same severity -> keep draft BAL (verbatim - no recompute needed).
        return base_bal_rating, flags

    # Combined LESS hazardous than draft.
    if surface == "consumer":
        # Consumer: keep draft, never lower. Flag for review.
        if "photo_lower_than_draft_review" not in flags:
            flags.append("photo_lower_than_draft_review")
        return base_bal_rating, flags

    # Console: use combined (lower), flag.
    mapping = map_photo_class_to_pbp(combined)
    pbp_override = mapping["pbp_formation"] if mapping["override"] else None
    bal = calculate_bal(
        fdi=fdi, veg_form="", effective_slope_degrees=slope_deg,
        distance_m=distance_m, vegetation_found=veg_found,
        as3959_class=combined,
        pbp_formation_override=pbp_override,
    )
    if "lowered_requires_review" not in flags:
        flags.append("lowered_requires_review")
    return bal["bal_rating"], flags


def reconcile_all_sectors(
    sector_evidence: list[SectorEvidence],
    boundary_assessment: dict,
    surface: str = "consumer",
) -> str | None:
    """Reconcile all sides and return the headline BAL (worst final_bal across
    sides). When a side has no photos, final_bal == its existing GIS BAL, so the
    headline is unchanged from the pre-photo state.

    Returns the headline BAL rating string, or None if no sector evidence.
    """
    if not sector_evidence or not boundary_assessment:
        return None

    per_direction = boundary_assessment.get("per_direction") or []
    fdi = boundary_assessment.get("fire_danger_index", 100)

    # Build a lookup: for each compass side, find the governing transect.
    from app.cases.service import COMPASS_SIDES
    side_governing: dict[str, dict | None] = {s: None for s in COMPASS_SIDES}
    for transect in per_direction:
        side = transect.get("outward_direction") or transect.get("direction")
        if side not in side_governing:
            continue
        best = side_governing[side]
        if best is None or _transect_severity(transect) > _transect_severity(best):
            side_governing[side] = transect

    for ev in sector_evidence:
        governing_transect = side_governing.get(ev.compass_side)
        if governing_transect is None:
            # No transect at all for this side - matches calculate_bal's Rule A
            # (no hazardous vegetation -> BAL-LOW), so the "keep unchanged"
            # paths that reuse bal_rating verbatim still resolve correctly.
            governing_transect = {
                "vegetation_found": False,
                "distance_m": None,
                "effective_slope_degrees": 0.0,
                "vegetation_class": None,
                "pbp_formation": None,
                "bal_rating": "BAL-LOW",
                "candidate_distance_m": None,
            }
        reconcile_sector_bal(
            sector_ev=ev,
            side_transect=governing_transect,
            fdi=fdi,
            surface=surface,
        )

    # Headline: worst final_bal across sides. Sides with
    # "review_required_unassessable" are NOT treated as a numeric BAL —
    # they need review, so they don't contribute to headline lowering.
    rated = [
        ev for ev in sector_evidence
        if ev.final_bal and ev.final_bal in BAL_SEVERITY
    ]
    if not rated:
        return None
    return max(rated, key=lambda ev: BAL_SEVERITY[ev.final_bal]).final_bal


def _transect_severity(transect: dict) -> int:
    return BAL_SEVERITY.get(transect.get("bal_rating", ""), -1)


def _start(stage, label):
    return ("progress", {"stage": stage, "label": label, "status": "start", "detail": None})


def _done(stage, label, detail):
    return ("progress", {"stage": stage, "label": label, "status": "done", "detail": detail})


def _error(status_code, detail):
    return ("error", {"status_code": status_code, "detail": detail})


async def run_assessment(request: AssessmentRequest):
    """Run the full BAL pipeline, yielding progress/error/result events."""

    # Step 1 - address -> coordinates.
    yield _start("address", "Finding the address")
    try:
        location = await geocode_address(request.address)
    except AddressNotFoundError:
        yield _error(404, "We couldn't find that address. Please check it and try again.")
        return
    yield _done("address", "Finding the address", location["matched_address"])

    # Step 2 - coordinates -> LGA.
    yield _start("lga", "Locating the council area")
    try:
        lga_name = await get_lga_name(location["latitude"], location["longitude"])
    except LgaNotFoundError:
        yield _error(400, "This address appears to be outside NSW.")
        return
    yield _done("lga", "Locating the council area", lga_name)

    # Step 3 - LGA -> Fire Danger Index.
    yield _start("fdi", "Reading the fire danger index")
    try:
        fire_danger_index = get_fire_danger_index(
            lga_name=lga_name,
            manual_override=request.fire_danger_override,
        )
    except ValueError as error:
        yield _error(400, str(error))
        return
    yield _done("fdi", "Reading the fire danger index", f"FDI {fire_danger_index}")

    # Step 4 - vegetation at the point + nearest hazardous vegetation scan.
    yield _start("vegetation", "Scanning nearby vegetation")
    vegetation = await get_vegetation_at_point(
        location["latitude"], location["longitude"]
    )
    nearest_vegetation = await find_nearest_vegetation(
        location["latitude"],
        location["longitude"],
        settings.VEGETATION_SEARCH_RADIUS_METRES,
        # When the user drew a site boundary, measure distances from its nearest
        # edge instead of the geocoded point. Absent -> point mode (unchanged).
        site_polygon=request.site_polygon,
    )
    classification = classify_vegetation(nearest_vegetation["nearest_svtm_class"])
    if nearest_vegetation["vegetation_found"]:
        veg_detail = (
            f"{nearest_vegetation['nearest_as3959_class']} at "
            f"{nearest_vegetation['nearest_distance_m']} m"
        )
    else:
        veg_detail = "None within 150 m"
    yield _done("vegetation", "Scanning nearby vegetation", veg_detail)

    # Steps 5 & 6 - slope + BAL, run once PER compass direction (N/E/S/W) so each
    # side of the house is rated separately. The worst side governs the overall
    # house BAL, matching how an AS 3959 assessor works per-aspect.
    yield _start("slope", "Measuring the slope")
    photo_overrides = request.photo_overrides or {}
    per_direction_results = []

    # The "sides" we rate separately, worst governs. In point mode these are the
    # four compass sectors (unchanged). When the user drew a site boundary, they
    # are the perimeter transects (T1..Tn) instead - same per-side logic applies.
    if nearest_vegetation.get("transects") is not None:
        sides = nearest_vegetation["transects"]
    else:
        sides = [nearest_vegetation["per_direction"][d] for d in DIRECTIONS]

    for side_veg in sides:
        direction = side_veg["direction"]

        # Slope ALWAYS comes from the map's nearest point on this side. Sides
        # with no hazardous vegetation are flat (effective slope 0 -> BAL-LOW).
        if side_veg["vegetation_found"]:
            try:
                side_slope = await calculate_slope(
                    # Anchor at the transect's boundary point when present (a
                    # drawn site), else the geocoded property point (point mode).
                    house_lat=side_veg.get("transect_point_lat", location["latitude"]),
                    house_lon=side_veg.get("transect_point_lon", location["longitude"]),
                    veg_lat=side_veg["nearest_point_lat"],
                    veg_lon=side_veg["nearest_point_lon"],
                    horizontal_distance_m=side_veg["nearest_distance_m"],
                )
            except ElevationServiceError:
                yield _error(
                    503,
                    "The elevation service is temporarily unavailable. "
                    "Please try again in a moment.",
                )
                return
            # A manual override lets a real assessor correct the effective slope.
            if request.slope_override is not None:
                side_slope["effective_slope_degrees"] = request.slope_override
                side_slope["slope_note"] = "manual override"
        else:
            side_slope = {
                "slope_degrees": 0.0,
                "slope_direction": "flat",
                "effective_slope_degrees": 0.0,
                "slope_note": "no vegetation within range",
            }

        # Candidate slope: when any patch (including excluded) is in range but
        # no hazardous patch exists, compute slope to the candidate so the
        # geometry is ready if a photo or override later reclassifies it.
        # When a hazardous patch exists, reuse the slope already computed.
        candidate_slope_degrees = None
        if side_veg.get("candidate_point_lat") is not None:
            if side_veg["vegetation_found"]:
                candidate_slope_degrees = side_slope["effective_slope_degrees"]
            else:
                try:
                    cand_slope = await calculate_slope(
                        house_lat=side_veg.get("transect_point_lat", location["latitude"]),
                        house_lon=side_veg.get("transect_point_lon", location["longitude"]),
                        veg_lat=side_veg["candidate_point_lat"],
                        veg_lon=side_veg["candidate_point_lon"],
                        horizontal_distance_m=side_veg["candidate_distance_m"],
                    )
                    candidate_slope_degrees = cand_slope["effective_slope_degrees"]
                except ElevationServiceError:
                    pass

        # Resolve this side's class + BAL: the map gives the conservative
        # baseline, and a confident photo class can raise (always allowed) or
        # lower (allowed but flagged for review) it. Distance and slope above
        # always come from the map. This is pure/testable - see resolve_side_bal.
        resolved = resolve_side_bal(
            fdi=fire_danger_index,
            map_veg_form=side_veg["nearest_svtm_form"],
            map_as3959_class=side_veg["nearest_as3959_class"],
            map_class_manual_review=(
                classify_vegetation(side_veg["nearest_svtm_class"])["manual_review"]
                if side_veg["vegetation_found"]
                else False
            ),
            effective_slope_degrees=side_slope["effective_slope_degrees"],
            distance_m=side_veg["nearest_distance_m"],
            vegetation_found=side_veg["vegetation_found"],
            photo_entry=photo_overrides.get(direction.lower()),
        )

        record = {
            "direction": direction,
            "vegetation_class": resolved["vegetation_class"],
            "class_source": resolved["class_source"],
            "distance_m": side_veg["nearest_distance_m"],
            "effective_slope_degrees": side_slope["effective_slope_degrees"],
            "slope_direction": side_slope["slope_direction"],
            "bal_rating": resolved["bal_rating"],
            # The PBP formation this side's BAL used - lets a manual recalc
            # re-band the same formation when only distance/slope/FDI change.
            # For a needs_distance side this is the photo's formation, so
            # entering a distance on the result page rates it immediately.
            "pbp_formation": resolved["_bal"].get("pbp_formation"),
            "requires_manual_review": resolved["requires_manual_review"],
            # True when the photo saw hazardous vegetation the map missed and
            # the side needs a distance before it can be rated.
            "needs_distance": resolved.get("needs_distance", False),
            "vegetation_found": side_veg["vegetation_found"],
            # Carried through (underscore-prefixed) to assemble the governing
            # top-level fields; stripped from the public response below.
            "_slope": side_slope,
            "_bal": resolved["_bal"],
            "_veg": side_veg,
        }

        # Boundary mode only: surface which way this transect looked. Absent in
        # point mode, so the four-sector response stays byte-identical.
        if "outward_direction" in side_veg:
            record["outward_direction"] = side_veg["outward_direction"]
            record["outward_bearing"] = side_veg["outward_bearing"]

        # Candidate geometry: nearest ANY patch (including excluded) on this
        # side, with its slope. Absent in point mode and when no patch of any
        # kind is outward within range. Consumed by nobody yet.
        if "candidate_distance_m" in side_veg:
            record["candidate_distance_m"] = side_veg["candidate_distance_m"]
            record["candidate_as3959_class"] = side_veg["candidate_as3959_class"]
            record["candidate_svtm_form"] = side_veg["candidate_svtm_form"]
            record["candidate_point_lat"] = side_veg["candidate_point_lat"]
            record["candidate_point_lon"] = side_veg["candidate_point_lon"]
            record["candidate_effective_slope_degrees"] = candidate_slope_degrees

        per_direction_results.append(record)

    # The worst side governs the overall house BAL. max() keeps the first side
    # in N/E/S/W order on a tie, so the result is deterministic.
    governing = max(
        per_direction_results, key=lambda d: BAL_SEVERITY[d["bal_rating"]]
    )
    governing_direction = governing["direction"]
    governing_slope = governing["_slope"]
    governing_bal = governing["_bal"]
    governing_veg = governing["_veg"]

    yield _done(
        "slope",
        "Measuring the slope",
        f"{governing_slope['slope_degrees']}° {governing_slope['slope_direction']} "
        f"({governing_direction})",
    )

    yield _start("bal", "Calculating the BAL rating")
    yield _done(
        "bal",
        "Calculating the BAL rating",
        f"{governing_bal['bal_rating']} ({governing_direction} governs)",
    )

    # C1 safety net: a nearby patch the crosswalk could not confidently classify
    # as non-hazardous (Excluded, but flagged manual_review / Low confidence) is
    # not allowed to disappear silently. If such a patch is closer than the
    # nearest mapped hazard - or there is no mapped hazard at all but one sits
    # within range - it could be the deciding fuel, so flag the assessment for
    # review. This never changes the numeric BAL, distance, or governing side
    # (spec safety rules §5 / conservative defaults §11).
    low_conf_excluded_m = nearest_vegetation.get("low_confidence_excluded_min_distance_m")
    nearest_hazard_m = nearest_vegetation["nearest_distance_m"]
    uncertain_nearest_fuel = low_conf_excluded_m is not None and (
        nearest_hazard_m is None or low_conf_excluded_m < nearest_hazard_m
    )

    manual_review_reasons = []
    if uncertain_nearest_fuel:
        manual_review_reasons.append(
            "Nearby vegetation could not be confidently classified as non-hazardous "
            "and may be the closest fuel to the property - professional assessment "
            "recommended."
        )

    # Any side needing review flags the whole assessment; so does an uncertain
    # overall-nearest class (kept for backward-compatible top-level behaviour),
    # and an uncertain exclusion that may be the nearest fuel (above).
    requires_manual_review = (
        classification["manual_review"]
        or uncertain_nearest_fuel
        or any(side["requires_manual_review"] for side in per_direction_results)
    )

    # Strip the internal carry-throughs from the public per_direction array.
    per_direction_public = [
        {key: value for key, value in side.items() if not key.startswith("_")}
        for side in per_direction_results
    ]

    result = _build_result(
        request, location, lga_name, fire_danger_index, vegetation,
        nearest_vegetation, classification, governing_slope, governing_bal,
        requires_manual_review, per_direction_public, governing_direction,
        governing_veg, manual_review_reasons,
    )
    yield ("result", result)


def _build_result(
    request, location, lga_name, fire_danger_index, vegetation,
    nearest_vegetation, classification, slope, bal, requires_manual_review,
    per_direction, governing_direction, governing_veg, manual_review_reasons=None,
):
    """
    Assemble the final /assess response dict (including map geometry).

    The top-level scalar fields (bal_rating, pbp_formation, slope_*, distance)
    describe the GOVERNING (worst) direction, so the existing single-value
    frontend keeps working. The per_direction array carries every side's own
    rating, and governing_direction names which side won. The descriptive
    vegetation fields (svtm/as3959 class, pct) stay the overall-nearest patch's
    - that's what the map highlights.
    """

    vegetation_features = []
    for patch in nearest_vegetation["hazardous_patches"]:
        properties = {
            "as3959_class": patch["as3959_class"],
            "svtm_class": patch["svtm_class"],
            "pct_id": patch["pct_id"],
            "pct_name": patch["pct_name"],
            "distance_m": patch["distance_m"],
            "governing": patch["governing"],
        }
        if patch["governing"]:
            properties["bal"] = bal["bal_rating"]
        vegetation_features.append(
            {
                "type": "Feature",
                "geometry": patch["geometry"],
                "properties": properties,
            }
        )

    # Draw the distance line to the GOVERNING side's nearest vegetation, so the
    # line, the top-level distance, and the displayed BAL all describe the same
    # side. Falls back to None when the governing side has no vegetation.
    if governing_veg["vegetation_found"]:
        distance_line = {
            "type": "LineString",
            "coordinates": [
                [location["longitude"], location["latitude"]],
                [
                    governing_veg["nearest_point_lon"],
                    governing_veg["nearest_point_lat"],
                ],
            ],
        }
    else:
        distance_line = None

    geometry = {
        "property_point": {
            "type": "Point",
            "coordinates": [location["longitude"], location["latitude"]],
        },
        "assessment_ring_m": 100,
        "search_buffer_m": settings.VEGETATION_SEARCH_RADIUS_METRES,
        "vegetation": {
            "type": "FeatureCollection",
            "features": vegetation_features,
        },
        "distance_line": distance_line,
    }

    # Echo the drawn site boundary back for the map, but only when one was
    # supplied - so a point-mode response is byte-identical to before.
    if request.site_polygon is not None:
        geometry["site_polygon"] = request.site_polygon

    result = {
        "address": request.address,
        "matched_address": location["matched_address"],
        "latitude": location["latitude"],
        "longitude": location["longitude"],
        "lga": lga_name,
        "fire_danger_index": fire_danger_index,
        "vegetation_type": vegetation["vegetation_formation"],
        "svtm_vegetation_class": nearest_vegetation["nearest_svtm_class"],
        "as3959_vegetation_class": nearest_vegetation["nearest_as3959_class"],
        "vegetation_pct_id": nearest_vegetation["nearest_pct_id"],
        "vegetation_pct_name": nearest_vegetation["nearest_pct_name"],
        "vegetation_confidence": classification["confidence"],
        "vegetation_manual_review": classification["manual_review"],
        # Distance is the GOVERNING side's nearest vegetation (matches bal_rating).
        "nearest_vegetation_distance_m": governing_veg["nearest_distance_m"],
        "vegetation_found_within_range": nearest_vegetation["vegetation_found"],
        "slope_degrees": slope["slope_degrees"],
        "slope_direction": slope["slope_direction"],
        "effective_slope_degrees": slope["effective_slope_degrees"],
        "bal_rating": bal["bal_rating"],
        "pbp_formation": bal["pbp_formation"] or "N/A",
        "bal_slope_band": bal["slope_band"] or "N/A",
        "requires_manual_review": requires_manual_review,
        # Per-direction breakdown: each side rated separately, worst governs.
        "per_direction": per_direction,
        "governing_direction": governing_direction,
        "geometry": geometry,
    }

    # Only present when an uncertain exclusion may be the nearest fuel, so a
    # normal assessment's response shape is unchanged (byte-identical baseline).
    if manual_review_reasons:
        result["manual_review_reasons"] = manual_review_reasons

    return result

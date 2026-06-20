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
from app.services.address_lookup import geocode_address, AddressNotFoundError
from app.services.lga_lookup import get_lga_name, LgaNotFoundError
from app.services.fire_danger import get_fire_danger_index
from app.services.vegetation_finder import get_vegetation_at_point
from app.services.vegetation_classifier import classify_vegetation
from app.services.vegetation_scan import find_nearest_vegetation, DIRECTIONS
from app.services.slope_analyzer import calculate_slope, ElevationServiceError
from app.services.bal_calculator import calculate_bal
from app.services.photo_class_mapper import map_photo_class_to_pbp


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

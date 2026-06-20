# This service turns the four BAL ingredients (FDI, vegetation, distance,
# slope) into a final BAL (Bushfire Attack Level) rating, using the PBP 2019
# distance tables.

from app.data.bal_tables_loader import BAL_TABLES, DEFAULT_PBP_FORMATION
from app.services.pbp_formation_mapper import map_vegform_to_pbp

# The FDI values the BAL tables have columns for. Anything else falls back
# to the worst case (100) and is flagged for review.
VALID_TABLE_FDI_KEYS = {"100", "80", "50"}

# Slope bands, in the order the BAL tables use them. Anything past 20
# degrees is outside the PBP method, so we use the steepest band available
# and flag it for manual review.
MAX_SLOPE_BAND_DEGREES = 20


def calculate_bal(
    fdi: int,
    veg_form: str,
    effective_slope_degrees: float,
    distance_m: float | None,
    vegetation_found: bool,
    as3959_class: str | None = None,
    pbp_formation_override: str | None = None,
) -> dict:
    """
    Work out the BAL rating for a property, given:
        - fdi: the Fire Danger Index (50, 80, or 100).
        - veg_form: the SVTM vegetation formation of the nearest hazardous
          vegetation (vegForm).
        - effective_slope_degrees: the slope AS 3959 uses for BAL (downslope
          vegetation only - upslope/flat counts as 0).
        - distance_m: distance in metres to the nearest hazardous vegetation.
        - vegetation_found: whether any hazardous vegetation was found within
          the search radius.
        - as3959_class: the class-level AS 3959 result from
          classify_vegetation (e.g. "Forest", "Woodland"). Used to resolve
          vegForm rules flagged requires_pct_override - see Rule D below.
        - pbp_formation_override: an already-resolved PBP formation key (e.g.
          from the photo step, see photo_class_mapper). When given, it REPLACES
          the vegForm-derived formation, so the photo's class actually drives
          the rating. "Excluded" forces BAL-LOW. Distance, slope and FDI still
          come from the map - only the formation column changes. The distance-
          banding logic below is shared, never duplicated.

    Returns a dict with:
        - bal_rating (str)
        - pbp_formation (str | None)
        - slope_band (str | None)
        - thresholds_used (list[float] | None)
        - requires_manual_review (bool)
        - reason (str)
    """

    # Rule A: no hazardous vegetation nearby at all - the real "no vegetation" path.
    if not vegetation_found:
        return {
            "bal_rating": "BAL-LOW",
            "pbp_formation": None,
            "slope_band": None,
            "thresholds_used": None,
            "requires_manual_review": False,
            "reason": "No hazardous vegetation within range",
        }

    if pbp_formation_override is not None:
        # Photo-driven path: use the supplied PBP formation directly, skipping
        # the vegForm bridge (Rules B/C/D). Distance/slope/FDI are unchanged.
        pbp_formation = pbp_formation_override
        requires_manual_review = False

        # "Excluded" means the photo says this side is low-risk -> BAL-LOW
        # (mirrors Rule B for vegForm-derived exclusions).
        if pbp_formation == "Excluded":
            return {
                "bal_rating": "BAL-LOW",
                "pbp_formation": "Excluded",
                "slope_band": None,
                "thresholds_used": None,
                "requires_manual_review": False,
                "reason": "Photo class is low-risk / excluded from the BAL hazard tables",
            }
    else:
        mapping = map_vegform_to_pbp(veg_form)
        pbp_formation = mapping["pbp_formation"]
        requires_manual_review = mapping["manual_review"]
        requires_pct_override = mapping["requires_pct_override"]

        # Rule B: the bridge says this formation isn't a fire hazard (e.g. saline wetland).
        if pbp_formation == "Excluded":
            return {
                "bal_rating": "BAL-LOW",
                "pbp_formation": "Excluded",
                "slope_band": None,
                "thresholds_used": None,
                "requires_manual_review": requires_manual_review,
                "reason": f"'{veg_form}' is excluded from the BAL hazard tables",
            }

        # Rule C: no reliable mapping - substitute the worst-case Forest formation,
        # but DO NOT treat this as "no hazard" (unlike Rule B).
        if pbp_formation is None:
            pbp_formation = DEFAULT_PBP_FORMATION
            requires_manual_review = True

        # Rule D: the matched vegForm rule groups together vegetation that PBP
        # actually splits at the PCT/class level. The known case is the SVTM
        # "Forested Wetlands" formation, whose Coastal Swamp Forest subset belongs
        # under "Forest" in PBP (the wetland row has much shorter setbacks and
        # under-rates it - e.g. BAL-12.5 instead of BAL-29 at ~31 m). We can't see
        # the PCT here, but the class-level AS 3959 result distinguishes the subset,
        # so use it to resolve the override. If it can't be confidently resolved,
        # fail safe to the worst-case Forest row (per the spec's conservative
        # defaults). Either way, flag the result for manual review.
        if requires_pct_override:
            if as3959_class == "Forest":
                # Class crosswalk confirms forest (e.g. Coastal Swamp Forest);
                # use the Forest row instead of the lower wetland row.
                pbp_formation = DEFAULT_PBP_FORMATION
            else:
                # Override can't be confidently resolved - conservative worst case.
                pbp_formation = DEFAULT_PBP_FORMATION
            requires_manual_review = True

    slope_band, slope_out_of_method = _slope_band(effective_slope_degrees)
    if slope_out_of_method:
        requires_manual_review = True

    fdi_key = str(fdi)
    if fdi_key not in VALID_TABLE_FDI_KEYS:
        fdi_key = "100"
        requires_manual_review = True

    # If this formation has no column for this FDI/slope (e.g. Alpine Complex
    # outside the FDI 50 table), fall back to the Forest formation rather
    # than crashing.
    slope_table = BAL_TABLES[fdi_key][slope_band]
    if pbp_formation not in slope_table:
        pbp_formation = DEFAULT_PBP_FORMATION
        requires_manual_review = True

    thresholds = slope_table[pbp_formation]
    bal_rating = _band_distance(distance_m, thresholds)

    return {
        "bal_rating": bal_rating,
        "pbp_formation": pbp_formation,
        "slope_band": slope_band,
        "thresholds_used": thresholds,
        "requires_manual_review": requires_manual_review,
        "reason": (
            f"{pbp_formation} at {distance_m}m, {slope_band}, FDI {fdi_key}"
        ),
    }


def _slope_band(effective_slope_degrees: float) -> tuple[str, bool]:
    """
    Turn an effective slope (in degrees) into one of the BAL table's slope
    bands. Returns (slope_band, slope_out_of_method) - slope_out_of_method
    is True if the slope is steeper than the tables support (20 degrees).
    """

    if effective_slope_degrees <= 0:
        return "Upslope/Flat", False
    if effective_slope_degrees <= 5:
        return ">0-5 downslope", False
    if effective_slope_degrees <= 10:
        return ">5-10 downslope", False
    if effective_slope_degrees <= 15:
        return ">10-15 downslope", False
    if effective_slope_degrees <= MAX_SLOPE_BAND_DEGREES:
        return ">15-20 downslope", False

    # Steeper than the tables go - use the steepest band, flagged for review.
    return ">15-20 downslope", True


def _band_distance(distance_m: float, thresholds: list) -> str:
    """Apply the BAL distance-banding rule to thresholds [t1, t2, t3, t4, t5]."""

    fire_zone_max, bal40_max, bal29_max, bal19_max, bal12_5_max = thresholds

    if distance_m < fire_zone_max:
        return "BAL-FZ"
    if distance_m < bal40_max:
        return "BAL-40"
    if distance_m < bal29_max:
        return "BAL-29"
    if distance_m < bal19_max:
        return "BAL-19"
    if distance_m < bal12_5_max:
        return "BAL-12.5"
    return "BAL-LOW"

"""The canonical vocabulary for flood readings.

Every council publishes its flood data under different field names. Each council
provider translates those names into the keys below, so the assessment layer only
ever sees one vocabulary and never needs to know which council it is reading.

Adding a council means mapping its fields onto these keys — not adding new ones.
Add a new key here only when a genuinely new kind of measurement appears.
"""


class FloodValueKeys:
    """Canonical keys produced by every council provider.

    All levels are metres on the Australian Height Datum (mAHD), so they are
    directly comparable with the ground level returned by the elevation service.
    """

    # Flood levels by event, most frequent to rarest.
    LEVEL_5_YEAR_ARI = "level_5yr_ari_mAHD"
    LEVEL_10_PERCENT_AEP = "level_10pct_aep_mAHD"
    LEVEL_5_PERCENT_AEP = "level_5pct_aep_mAHD"
    LEVEL_2_PERCENT_AEP = "level_2pct_aep_mAHD"

    # The design flood. This one drives depth, flood planning level and band.
    LEVEL_1_PERCENT_AEP = "level_1pct_aep_mAHD"

    LEVEL_FLOOD_PLANNING_AREA = "level_flood_planning_area_mAHD"
    LEVEL_PROBABLE_MAXIMUM_FLOOD = "level_pmf_mAHD"

    # Non-level measurements a council may also publish.
    HYDRAULIC_CATEGORY_1_PERCENT_AEP = "hydraulic_category_1pct_aep"
    FLOOR_LEVEL = "floor_level_mAHD"
    INUNDATION_OVER_FLOOR = "inundation_over_floor_m"

    # Ground level published by the council itself. Where a council supplies this,
    # it is preferred over the elevation model because it is surveyed at the
    # building rather than sampled from a terrain grid.
    GROUND_LEVEL = "ground_level_mAHD"


# The level used for depth, flood planning level and banding. Named separately so
# the assessment layer states its dependency explicitly.
DESIGN_FLOOD_LEVEL_KEY = FloodValueKeys.LEVEL_1_PERCENT_AEP

# Fallback level used only to distinguish "rare flood risk" from "no flood risk".
EXTREME_FLOOD_LEVEL_KEY = FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD

# The level a council publishes for planning purposes. Where a council publishes
# this, it is preferred over adding a freeboard to the design flood level.
FLOOD_PLANNING_LEVEL_KEY = FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA


def is_measurement_key(key: str) -> bool:
    """Whether a canonical key holds a number rather than a category.

    Keys are named by their unit: a level is `_mAHD` and a distance is `_m`.
    Anything else, such as a hydraulic category, is a label.
    """
    return key.endswith("_mAHD") or key.endswith("_m")


def coerce_measurement(key: str, value):
    """Return a measurement as a number, whatever the council published it as.

    Councils sometimes type a level field as text — Tweed's flood planning level
    is one — which would otherwise flow through as a string and break the
    arithmetic. Used by every path that reads council values, so the live API and
    the precomputed map data agree.
    """
    if value is None or not is_measurement_key(key):
        return value
    if isinstance(value, (int, float)):
        return value
    try:
        return float(str(value).strip())
    except (TypeError, ValueError):
        return None


def coerce_measurements(values: dict) -> dict:
    """`coerce_measurement` applied across a whole set of canonical values."""
    return {key: coerce_measurement(key, value) for key, value in values.items()}

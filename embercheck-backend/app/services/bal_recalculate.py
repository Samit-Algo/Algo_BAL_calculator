# Recomputes the per-direction BAL from explicit inputs plus optional manual
# overrides, WITHOUT re-scanning the map. This backs the "adjust the inputs"
# step: the AI/map read can mismatch reality, so a user can override a side's
# distance, slope, or vegetation type (and the FDI globally), recalculate, and
# reset back to the original map/photo values.
#
# It reuses calculate_bal (the banding logic and PBP tables) and the photo
# class -> PBP formation mapper - no BAL logic is duplicated here.

from app.services.bal_calculator import calculate_bal
from app.services.photo_class_mapper import map_photo_class_to_pbp

# BAL severity, least to most, for picking the worst (governing) side. Kept
# local so this module doesn't pull in the whole assessment pipeline.
BAL_SEVERITY = {
    "BAL-LOW": 0,
    "BAL-12.5": 1,
    "BAL-19": 2,
    "BAL-29": 3,
    "BAL-40": 4,
    "BAL-FZ": 5,
}


def recalculate(
    *,
    base_fdi: int,
    fire_danger_override: int | None,
    per_direction: list[dict],
    overrides: dict,
) -> dict:
    """
    Recompute every side's BAL from its base inputs, applying any overrides.

    base_fdi: the FDI the original assessment used.
    fire_danger_override: a user FDI override (50/80/100), or None to keep base.
    per_direction: the base per-side dicts from /assess (each needs direction,
        vegetation_found, distance_m, effective_slope_degrees, vegetation_class,
        pbp_formation, slope_direction).
    overrides: { "<direction>": { distance_m?, effective_slope_degrees?,
        vegetation_class? } } - any field omitted/None keeps the base value.

    Returns { fire_danger_index, per_direction: [...], bal_rating,
    governing_direction, requires_manual_review }. Passing overrides={} (and no
    FDI override) reproduces the original map/photo result - that's "reset".
    """

    fdi = fire_danger_override if fire_danger_override is not None else base_fdi

    results = []
    for base in per_direction:
        results.append(_recalc_side(fdi, base, overrides.get(base["direction"].lower(), {})))

    governing = max(results, key=lambda side: BAL_SEVERITY[side["bal_rating"]])

    return {
        "fire_danger_index": fdi,
        "per_direction": results,
        "bal_rating": governing["bal_rating"],
        "governing_direction": governing["direction"],
        "requires_manual_review": any(side["requires_manual_review"] for side in results),
    }


def _recalc_side(fdi: int, base: dict, override: dict) -> dict:
    """Recompute one side, applying its overrides over the base inputs."""

    # Effective inputs: the override if present, else the base value.
    distance_m = _override_or_base(override.get("distance_m"), base.get("distance_m"))
    effective_slope = _override_or_base(
        override.get("effective_slope_degrees"), base.get("effective_slope_degrees", 0.0)
    )

    veg_class_override = override.get("vegetation_class")
    # Resolve the PBP formation that drives this side's BAL:
    #   - vegetation type overridden -> map the chosen class to its formation
    #     (low_risk -> "Excluded" -> BAL-LOW). "cant_tell" means "keep base".
    #   - otherwise -> the formation the base BAL already used.
    if veg_class_override:
        mapping = map_photo_class_to_pbp(veg_class_override)
        formation = mapping["pbp_formation"] if mapping["override"] else base.get("pbp_formation")
        vegetation_class = veg_class_override
    else:
        formation = base.get("pbp_formation")
        vegetation_class = base.get("vegetation_class")

    # There's vegetation to rate only when we have both a distance and a
    # formation. "Excluded" is a valid formation (it forces BAL-LOW).
    has_vegetation = distance_m is not None and formation is not None

    bal = calculate_bal(
        fdi=fdi,
        veg_form="",  # ignored: the resolved formation drives the result below.
        effective_slope_degrees=effective_slope,
        distance_m=distance_m,
        vegetation_found=has_vegetation,
        pbp_formation_override=formation if has_vegetation else None,
    )

    overridden_fields = [
        field
        for field in ("distance_m", "effective_slope_degrees", "vegetation_class")
        if override.get(field) is not None
    ]

    return {
        "direction": base["direction"],
        "vegetation_class": vegetation_class,
        "vegetation_found": has_vegetation,
        "distance_m": distance_m,
        "effective_slope_degrees": effective_slope,
        "slope_direction": "manual" if "effective_slope_degrees" in overridden_fields
        else base.get("slope_direction"),
        "pbp_formation": bal["pbp_formation"],
        "bal_rating": bal["bal_rating"],
        "requires_manual_review": bal["requires_manual_review"],
        # Where this side's values came from, for the UI's reset/override tags.
        "source": "override" if overridden_fields else base.get("class_source", "map"),
        "overridden_fields": overridden_fields,
    }


def _override_or_base(override_value, base_value):
    """Return the user's override value when supplied, else the base value."""
    return override_value if override_value is not None else base_value

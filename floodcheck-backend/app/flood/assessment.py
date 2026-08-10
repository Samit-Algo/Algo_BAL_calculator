"""Flood assessment maths, on the mAHD ruler.

    depth                = design flood level - ground level
    flood planning level = design flood level + freeboard, or the council's own
                           published flood planning level where it has one

This module is deliberately council-agnostic: it takes canonical flood values, a
ground level and a freeboard, and knows nothing about where they came from. That
is what lets a new council be added without touching any calculation.

It never invents a number. Where an input is missing the result says so, because a
missing flood level means unknown risk, never no risk.
"""

from app.flood.flood_values import (
    DESIGN_FLOOD_LEVEL_KEY,
    EXTREME_FLOOD_LEVEL_KEY,
    FLOOD_PLANNING_LEVEL_KEY,
)
from app.flood.providers.council_provider import DEFAULT_FREEBOARD_METRES

# Provisional shallow/deep cutoff within the design flood extent. Confirm against
# the council development control plan and AIDR Guideline 7-3 before any
# commercial assessment.
DEEP_DEPTH_THRESHOLD_M = 0.5


class FloodBands:
    HIGH = "High"
    MODERATE = "Moderate"
    LOW = "Low"
    MINIMAL = "Minimal"


def calculate_depth(flood_level: float | None, ground_level: float) -> float | None:
    """Water depth above ground, or None when there is no flood level here."""
    if flood_level is None:
        return None
    return round(flood_level - ground_level, 2)


def classify_flood_band(
    design_flood_depth: float | None,
    extreme_flood_depth: float | None,
) -> str | None:
    """Turn depths into a plain-language band.

    Depth in the design flood decides High or Moderate. If the design flood does
    not reach the ground, an extreme flood that does still means Low rather than
    Minimal. None means there was nothing to classify.
    """
    if design_flood_depth is not None and design_flood_depth > 0:
        return (
            FloodBands.HIGH
            if design_flood_depth > DEEP_DEPTH_THRESHOLD_M
            else FloodBands.MODERATE
        )
    if extreme_flood_depth is not None and extreme_flood_depth > 0:
        return FloodBands.LOW
    if design_flood_depth is not None or extreme_flood_depth is not None:
        return FloodBands.MINIMAL
    return None


def resolve_flood_planning_level(
    flood_values: dict,
    freeboard_metres: float | None,
) -> float | None:
    """The level development must be built to.

    Councils express this in one of two ways. Most publish only the design flood
    level and a freeboard to add to it. Some publish the flood planning level
    itself, in which case that value is authoritative and adding a freeboard on
    top would double-count it.
    """
    if freeboard_metres is None:
        return flood_values.get(FLOOD_PLANNING_LEVEL_KEY)
    design_flood_level = flood_values.get(DESIGN_FLOOD_LEVEL_KEY)
    if design_flood_level is None:
        return None
    return round(design_flood_level + freeboard_metres, 2)


def build_empty_assessment(
    flood_values: dict,
    ground_level: float | None,
    freeboard_metres: float | None,
) -> dict:
    return {
        "computable": False,
        "flood_band": None,
        "depth_1pct_aep_m": None,
        "flood_planning_level_mAHD": None,
        "pmf_depth_m": None,
        "inputs": {
            "ground_level_mAHD": ground_level,
            "flood_level_1pct_aep_mAHD": flood_values.get(DESIGN_FLOOD_LEVEL_KEY),
            "flood_level_pmf_mAHD": flood_values.get(EXTREME_FLOOD_LEVEL_KEY),
            "freeboard_m": freeboard_metres,
        },
        "notes": [],
    }


def assess_flood(
    flood_values: dict,
    ground_level: float | None,
    freeboard_metres: float | None = DEFAULT_FREEBOARD_METRES,
    inside_study_area: bool = True,
    study_area_name: str = "council flood study",
) -> dict:
    # `study_area_name` is phrased without a leading article so it reads correctly
    # both at the start of a sentence and after "outside the".
    """Assess one location from its flood values and ground level."""
    design_flood_level = flood_values.get(DESIGN_FLOOD_LEVEL_KEY)
    extreme_flood_level = flood_values.get(EXTREME_FLOOD_LEVEL_KEY)

    result = build_empty_assessment(flood_values, ground_level, freeboard_metres)
    notes: list[str] = result["notes"]

    # The flood planning level needs no ground level, so report it as soon as it
    # can be resolved.
    result["flood_planning_level_mAHD"] = resolve_flood_planning_level(
        flood_values, freeboard_metres)

    if not inside_study_area:
        notes.append(
            f"This location sits outside the {study_area_name} - no flood data here. "
            "Risk is UNKNOWN, not zero."
        )
        return result

    if not any(value is not None for value in flood_values.values()):
        notes.append(
            f"{study_area_name} covers this location but publishes no flood level "
            "for it. Risk is UNKNOWN, not zero."
        )
        return result

    if ground_level is None:
        notes.append(
            "Ground level unavailable (no elevation model returned a value here) - "
            "depth and flood band not computed."
        )
        return result

    design_flood_depth = calculate_depth(design_flood_level, ground_level)
    extreme_flood_depth = calculate_depth(extreme_flood_level, ground_level)
    result["depth_1pct_aep_m"] = design_flood_depth
    result["pmf_depth_m"] = extreme_flood_depth

    band = classify_flood_band(design_flood_depth, extreme_flood_depth)
    if band is None:
        notes.append(
            "Inside the study area, but neither a design flood nor an extreme "
            "flood level is published here - band not computed."
        )

    result["flood_band"] = band
    result["computable"] = band is not None
    return result

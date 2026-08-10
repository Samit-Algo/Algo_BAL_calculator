"""The confidence-tiered cascade.

    Tier A  a registered council flood study  -> real depth and band   (high)
    Tier B  NSW EPI Flood Planning layer      -> planning designation  (medium)
    Tier C  elevation model terrain screen    -> low-lying or elevated (low)

The resolver returns the highest tier that can answer, always tagged with tier,
confidence and provenance, and never a false "safe".

It works through the provider registry rather than any named council, so adding a
council changes nothing in this file.
"""

from dataclasses import dataclass, field

from app.flood.assessment import assess_flood
from app.flood.providers.council_provider import CouncilProvider
from app.flood.providers.flood_data_source import FloodReading
from app.flood.providers.registry import find_council_providers
from app.flood.tiers.planning_designation import query_planning_designation
from app.flood.tiers.terrain_screen import TerrainIndicators, screen_terrain
from app.services.arcgis_feature_service import ArcGisQueryError
from app.services.elevation import ElevationServiceError, get_ground_level

DISCLAIMER = (
    "Indicative only - not a substitute for a Section 10.7 certificate or a "
    "council flood certificate."
)


class Tiers:
    COUNCIL_FLOOD_STUDY = "A"
    PLANNING_DESIGNATION = "B"
    TERRAIN_SCREEN = "C"


async def resolve_ground_level(
    latitude: float,
    longitude: float,
    council_ground_level: float | None = None,
) -> float | None:
    """Prefer the council's own surveyed ground level over the elevation model."""
    if council_ground_level is not None:
        return council_ground_level
    try:
        return await get_ground_level(latitude, longitude)
    except ElevationServiceError:
        return None


def describe_depth(assessment: dict) -> str:
    depth = assessment.get("depth_1pct_aep_m")
    if depth is not None and depth > 0:
        return f"{depth:.2f} m of water above ground in a 1% (1-in-100-year) flood."
    return "Ground here sits above the 1% (1-in-100-year) flood level."


def build_council_result(
    provider: CouncilProvider,
    reading: FloodReading,
    assessment: dict,
    ground_level: float | None,
) -> dict:
    return {
        "tier": Tiers.COUNCIL_FLOOD_STUDY,
        "confidence": "high",
        "tier_label": "Council flood study",
        "council": provider.name,
        "council_id": provider.identifier(),
        "state": provider.state,
        "flood_affected": assessment["flood_band"] != "Minimal",
        "band": assessment["flood_band"],
        "headline": describe_depth(assessment),
        "provenance": provider.attribution,
        "source_url": provider.source_url,
        "fetched": {
            "flood_values": reading.flood_values,
            "ground_level_mAHD": ground_level,
            "ground_level_source": (
                provider.name if reading.ground_level_mAHD is not None else "elevation model"
            ),
        },
        "assessment": assessment,
        "data_notes": list(provider.data_notes),
        "disclaimer": DISCLAIMER,
    }


@dataclass
class CouncilOutcome:
    """What Tier A produced, including why it could not answer.

    When a council covers a location but publishes no flood level for it, that is
    worth telling the user — it is more informative than a bare terrain screen. The
    explanation is carried down and attached to whichever lower tier answers.
    """

    result: dict | None = None
    council_name: str | None = None
    explanation: list[str] = field(default_factory=list)
    ground_level_mAHD: float | None = None


async def assess_with_provider(
    provider: CouncilProvider,
    latitude: float,
    longitude: float,
) -> CouncilOutcome:
    reading = await provider.flood_data_source.read(latitude, longitude)
    ground_level = await resolve_ground_level(latitude, longitude, reading.ground_level_mAHD)

    assessment = assess_flood(
        flood_values=reading.flood_values,
        ground_level=ground_level,
        freeboard_metres=provider.freeboard_metres,
        inside_study_area=reading.inside_study_area,
        study_area_name=f"{provider.name} flood study",
    )
    if not assessment["computable"] or not assessment["flood_band"]:
        return CouncilOutcome(
            council_name=provider.name,
            explanation=list(assessment["notes"]),
            ground_level_mAHD=ground_level,
        )

    return CouncilOutcome(
        result=build_council_result(provider, reading, assessment, ground_level),
        council_name=provider.name,
        ground_level_mAHD=ground_level,
    )


async def resolve_council_flood_study(latitude: float, longitude: float) -> CouncilOutcome:
    """Tier A. A council flood study, where one covers the coordinate.

    Coverage boxes overlap along shared borders, so several councils can claim a
    coordinate. Each is tried in turn and the first whose study actually holds
    data there answers; a council that merely overlaps on paper falls through.
    """
    outcome = CouncilOutcome()
    for provider in find_council_providers(latitude, longitude):
        outcome = await assess_with_provider(provider, latitude, longitude)
        if outcome.result is not None:
            return outcome
    return outcome


async def resolve_planning_designation(latitude: float, longitude: float) -> dict | None:
    """Tier B. Returns None outside NSW or where the land carries no flood clause."""
    try:
        designation = await query_planning_designation(latitude, longitude)
    except ArcGisQueryError:
        return None
    if not designation.get("flood_affected"):
        return None

    instrument = designation.get("epi_name") or "the local environmental planning instrument"
    return {
        "tier": Tiers.PLANNING_DESIGNATION,
        "confidence": "medium",
        "tier_label": "Planning designation (EPI Flood)",
        "flood_affected": True,
        "band": None,
        "headline": f"Flood-controlled land under {instrument} (planning designation).",
        "provenance": "NSW Planning Portal - EPI Flood Planning layer",
        "detail": designation,
        "disclaimer": DISCLAIMER,
    }


async def resolve_terrain_screen(
    latitude: float,
    longitude: float,
    ground_level: float | None,
) -> dict | None:
    """Tier C. Returns None where no elevation model covers the point.

    The screen samples a ring of surrounding points, so it makes several more
    elevation calls than the tiers above it and is the most likely to hit a
    timeout. A failing tier answers None like any other rather than failing the
    whole request.
    """
    try:
        screen = await screen_terrain(latitude, longitude, ground_level)
    except ElevationServiceError:
        return None
    if not screen.get("available"):
        return None
    if screen.get("indicator") not in (TerrainIndicators.LOW_LYING, TerrainIndicators.ELEVATED):
        return None

    is_low_lying = screen["indicator"] == TerrainIndicators.LOW_LYING
    return {
        "tier": Tiers.TERRAIN_SCREEN,
        "confidence": "low",
        "tier_label": "Terrain screening (no flood study here)",
        "flood_affected": None,
        "band": None,
        "headline": (
            "Low-lying terrain - possible overland-flow / ponding (screening only)."
            if is_low_lying
            else "Elevated relative to local surroundings (screening only)."
        ),
        "provenance": "State elevation model terrain screen",
        "detail": screen,
        "disclaimer": DISCLAIMER,
    }


def build_no_data_result(ground_level: float | None) -> dict:
    return {
        "tier": None,
        "confidence": "none",
        "tier_label": "No data",
        "flood_affected": None,
        "band": None,
        "headline": (
            "No flood study, no planning designation, and no elevation here - "
            "risk UNKNOWN, not zero."
        ),
        "provenance": "",
        "ground_level_mAHD": ground_level,
        "disclaimer": DISCLAIMER,
    }


def apply_council_context(result: dict, council: CouncilOutcome) -> dict:
    """Explain, on a lower-tier answer, why the council study could not answer."""
    if council.council_name and council.explanation:
        result["council_context"] = {
            "council": council.council_name,
            "notes": council.explanation,
        }
    return result


async def resolve_flood(latitude: float, longitude: float) -> dict:
    """Return the highest-confidence flood answer available for a coordinate."""
    council = await resolve_council_flood_study(latitude, longitude)
    if council.result is not None:
        return council.result

    # Tiers B and C share this ground level, so it is read at most once.
    ground_level = council.ground_level_mAHD
    if ground_level is None:
        ground_level = await resolve_ground_level(latitude, longitude)

    planning_result = await resolve_planning_designation(latitude, longitude)
    if planning_result is not None:
        planning_result["ground_level_mAHD"] = ground_level
        return apply_council_context(planning_result, council)

    terrain_result = await resolve_terrain_screen(latitude, longitude, ground_level)
    if terrain_result is not None:
        terrain_result["ground_level_mAHD"] = ground_level
        return apply_council_context(terrain_result, council)

    return apply_council_context(build_no_data_result(ground_level), council)

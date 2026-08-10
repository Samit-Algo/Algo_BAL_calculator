"""Tier C - the terrain screen, available wherever an elevation model reaches.

Samples the ground at the point and on a ring around it, and reports whether the
point sits low relative to its surroundings.

This is a screen, not a flood model: the elevation models are not hydrologically
enforced. It is always reported at low confidence, never as a flood level, and
never as a verdict that a location is safe.
"""

import asyncio
import math

from app.services.elevation import get_ground_level

RING_RADIUS_METRES = 200
RING_SAMPLE_COUNT = 6
LOW_LYING_THRESHOLD_METRES = 2.0

METRES_PER_DEGREE_LATITUDE = 111_320.0


class TerrainIndicators:
    LOW_LYING = "low_lying"
    ELEVATED = "elevated"
    UNKNOWN = "unknown"


def offset_coordinate(
    latitude: float,
    longitude: float,
    east_metres: float,
    north_metres: float,
) -> tuple[float, float]:
    """Move a coordinate by a distance in metres, for small local offsets."""
    latitude_change = north_metres / METRES_PER_DEGREE_LATITUDE
    longitude_change = east_metres / (
        METRES_PER_DEGREE_LATITUDE * math.cos(math.radians(latitude))
    )
    return latitude + latitude_change, longitude + longitude_change


def build_ring_coordinates(latitude: float, longitude: float) -> list[tuple[float, float]]:
    """Evenly spaced sample points on a circle around the location."""
    coordinates = []
    for index in range(RING_SAMPLE_COUNT):
        angle = 2 * math.pi * index / RING_SAMPLE_COUNT
        coordinates.append(
            offset_coordinate(
                latitude,
                longitude,
                east_metres=RING_RADIUS_METRES * math.cos(angle),
                north_metres=RING_RADIUS_METRES * math.sin(angle),
            )
        )
    return coordinates


async def screen_terrain(
    latitude: float,
    longitude: float,
    ground_level: float | None = None,
) -> dict:
    if ground_level is None:
        ground_level = await get_ground_level(latitude, longitude)
    if ground_level is None:
        return {"available": False, "reason": "no elevation model covers this point"}

    ring_coordinates = build_ring_coordinates(latitude, longitude)
    ring_levels = await asyncio.gather(
        *(get_ground_level(sample_lat, sample_lon) for sample_lat, sample_lon in ring_coordinates)
    )
    neighbours = [level for level in ring_levels if level is not None]

    if not neighbours:
        return {
            "available": True,
            "ground_mAHD": round(ground_level, 2),
            "indicator": TerrainIndicators.UNKNOWN,
            "note": "No surrounding elevation to compare against.",
        }

    local_minimum = min(neighbours + [ground_level])
    relative_elevation = round(ground_level - local_minimum, 2)
    is_low_lying = relative_elevation <= LOW_LYING_THRESHOLD_METRES

    return {
        "available": True,
        "ground_mAHD": round(ground_level, 2),
        "local_min_mAHD": round(local_minimum, 2),
        "relative_elevation_m": relative_elevation,
        "indicator": TerrainIndicators.LOW_LYING if is_low_lying else TerrainIndicators.ELEVATED,
        "note": (
            "Sits low relative to the surrounding ~200 m - possible overland-flow / ponding."
            if is_low_lying
            else "Sits high relative to the surrounding ~200 m."
        ),
    }

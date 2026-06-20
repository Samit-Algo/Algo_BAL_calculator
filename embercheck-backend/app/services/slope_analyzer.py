# This service works out the slope between a house and its nearest hazardous
# vegetation, using ground heights from the NSW 5m Elevation ImageServer.
#
# This is a screening approximation: AS 3959 actually wants the "effective
# slope" measured under the vegetation itself, which can differ from the
# simple house-to-vegetation slope used here. A manual override
# (slope_override) is provided so a real assessor can correct this.

import json
from math import atan, degrees

import httpx

from app.config import settings

# How long to wait for a response before giving up. The first request to
# this elevation service is often slow (10s+) even though later ones are
# fast, so we allow more time than usual.
REQUEST_TIMEOUT_SECONDS = 30

# The ImageServer returns this string when a point has no elevation data
# (e.g. it falls outside the data's coverage area).
NO_DATA_VALUE = "NoData"

# The elevation service is prone to slow cold starts, so a single request can
# time out even though the service is healthy. We retry once before giving up.
ELEVATION_MAX_ATTEMPTS = 2


class ElevationServiceError(Exception):
    """Raised when the elevation service can't be reached (timeout/network)."""

# If the height difference between two points is smaller than this, we treat
# the ground as "flat" rather than calling it upslope/downslope.
FLAT_HEIGHT_TOLERANCE_METRES = 0.5


async def get_elevation(latitude: float, longitude: float) -> float | None:
    """
    Look up the ground height (in metres) at the given point, using the
    ImageServer's "identify" operation. Returns None if there's no
    elevation data for this point.
    """

    params = {
        "geometry": json.dumps(
            {"x": longitude, "y": latitude, "spatialReference": {"wkid": 4326}}
        ),
        "geometryType": "esriGeometryPoint",
        "returnGeometry": "false",
        "f": "json",
    }

    # Retry on timeout/network errors to ride out the service's slow cold
    # start; if every attempt fails, surface it so the caller can return a
    # clear "try again" response instead of an opaque 500.
    last_error: httpx.RequestError | None = None
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for _ in range(ELEVATION_MAX_ATTEMPTS):
            try:
                response = await client.get(
                    f"{settings.ELEVATION_API_URL}/identify", params=params
                )
                break
            except httpx.RequestError as error:
                last_error = error
        else:
            raise ElevationServiceError(
                f"Elevation service unavailable after {ELEVATION_MAX_ATTEMPTS} "
                f"attempts: {last_error}"
            ) from last_error

    if response.status_code != 200:
        raise RuntimeError(
            f"Elevation request failed with status {response.status_code}: {response.text}"
        )

    value = response.json().get("value")

    if value is None or value == NO_DATA_VALUE:
        return None

    try:
        return float(value)
    except ValueError:
        return None


async def calculate_slope(
    house_lat: float,
    house_lon: float,
    veg_lat: float,
    veg_lon: float,
    horizontal_distance_m: float,
) -> dict:
    """
    Work out the slope between the house and the nearest hazardous
    vegetation, and whether the vegetation sits upslope or downslope of
    the house.

    Returns a dict with:
        - slope_degrees (float): the raw slope angle between the two points.
        - slope_direction (str): "downslope", "upslope", or "flat" - from
          the house's point of view, which way the vegetation sits.
        - effective_slope_degrees (float): the slope value AS 3959 uses for
          BAL. Downslope vegetation makes BAL worse, so its angle is kept.
          Upslope/flat vegetation is treated as 0 degrees.
        - slope_note (str): a short explanation of the result.
    """

    house_elevation = await get_elevation(house_lat, house_lon)
    vegetation_elevation = await get_elevation(veg_lat, veg_lon)

    if house_elevation is None or vegetation_elevation is None or horizontal_distance_m == 0:
        return {
            "slope_degrees": 0.0,
            "slope_direction": "flat",
            "effective_slope_degrees": 0.0,
            "slope_note": "could not determine / flat",
        }

    height_difference = house_elevation - vegetation_elevation
    slope_degrees = round(degrees(atan(abs(height_difference) / horizontal_distance_m)), 1)

    if abs(height_difference) < FLAT_HEIGHT_TOLERANCE_METRES:
        slope_direction = "flat"
        effective_slope_degrees = 0.0
    elif height_difference > 0:
        # The vegetation is lower than the house - fire burns uphill toward
        # the house, which AS 3959 treats as the worse case.
        slope_direction = "downslope"
        effective_slope_degrees = slope_degrees
    else:
        # The vegetation is higher than the house - AS 3959 treats
        # upslope vegetation as 0 degrees, which lowers the BAL.
        slope_direction = "upslope"
        effective_slope_degrees = 0.0

    return {
        "slope_degrees": slope_degrees,
        "slope_direction": slope_direction,
        "effective_slope_degrees": effective_slope_degrees,
        "slope_note": f"{slope_direction} ({slope_degrees} degrees)",
    }

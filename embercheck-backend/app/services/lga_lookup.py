# This service turns map coordinates into the name of the LGA (Local Government
# Area / council area) that point falls inside, using NSW Spatial Services.

import httpx

from app.config import settings

# How long to wait for a response before giving up.
REQUEST_TIMEOUT_SECONDS = 10


class LgaNotFoundError(Exception):
    """Raised when no LGA is found for the given coordinates (point is outside NSW)."""


async def get_lga_name(latitude: float, longitude: float) -> str:
    """
    Look up the LGA (council area) that contains the given coordinates.

    Returns the LGA name as reported by NSW Spatial Services (e.g. "CAMPBELLTOWN").

    Raises:
        LgaNotFoundError: if no LGA contains this point (i.e. it's outside NSW).
    """

    params = {
        # Note: longitude comes first here, then latitude.
        "geometry": f"{longitude},{latitude}",
        "geometryType": "esriGeometryPoint",
        "inSR": 4326,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "*",
        "returnGeometry": "false",
        "f": "json",
    }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(settings.LGA_BOUNDARY_API_URL, params=params)

    if response.status_code != 200:
        raise RuntimeError(
            f"LGA boundary request failed with status "
            f"{response.status_code}: {response.text}"
        )

    features = response.json().get("features", [])

    if not features:
        raise LgaNotFoundError(
            f"No LGA found for coordinates ({latitude}, {longitude}) - "
            f"this point may be outside NSW."
        )

    return features[0]["attributes"]["lganame"]

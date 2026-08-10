"""Tier B - the NSW statewide EPI Flood Planning layer.

A planning designation, not a measurement: a hit means the land is flood-controlled
under an environmental planning instrument. A miss is NOT "no flood risk", because
the layer only covers councils whose flood clause has been gazetted into it.

This layer is New South Wales only. Outside that coverage the tier is skipped, and
the cascade falls from a council study straight to the terrain screen.
"""

import httpx

from app.geography import GeographicBounds
from app.services.arcgis_feature_service import query_point_attributes

EPI_FLOOD_LAYER_URL = (
    "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/"
    "Planning/Hazard/MapServer/1"
)
REQUEST_TIMEOUT_SECONDS = 12
OUTPUT_FIELDS = "EPI_NAME,LGA_NAME,EPI_TYPE"
DESCRIPTION = "NSW EPI Flood Planning layer"

NSW_COVERAGE = GeographicBounds(
    minimum_latitude=-37.6,
    maximum_latitude=-28.1,
    minimum_longitude=140.9,
    maximum_longitude=153.7,
)


def covers(latitude: float, longitude: float) -> bool:
    return NSW_COVERAGE.contains(latitude, longitude)


async def query_planning_designation(latitude: float, longitude: float) -> dict:
    """Return the planning designation at this coordinate.

    `flood_affected` is False both when the layer has no feature here and when the
    coordinate is outside New South Wales entirely.
    """
    if not covers(latitude, longitude):
        return {"flood_affected": False, "applicable": False}

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        attributes = await query_point_attributes(
            client=client,
            layer_url=EPI_FLOOD_LAYER_URL,
            latitude=latitude,
            longitude=longitude,
            output_fields=OUTPUT_FIELDS,
            description=DESCRIPTION,
        )

    if attributes is None:
        return {"flood_affected": False, "applicable": True}

    return {
        "flood_affected": True,
        "applicable": True,
        "epi_name": attributes.get("EPI_NAME"),
        "lga_name": attributes.get("LGA_NAME"),
        "epi_type": attributes.get("EPI_TYPE"),
    }

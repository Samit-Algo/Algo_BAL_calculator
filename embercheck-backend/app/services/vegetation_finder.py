# This service finds the vegetation formation at a given point, using the
# NSW State Vegetation Type Map (SVTM). The SVTM layers are raster (image)
# layers, so we use the ArcGIS "identify" operation rather than "query".

import httpx

from app.config import settings

# How long to wait for a response before giving up.
REQUEST_TIMEOUT_SECONDS = 10

# Used for points with no mapped vegetation (cleared/urban land), and also
# what SVTM itself returns for pixel value 0 - we treat both the same way.
NOT_CLASSIFIED = "Not classified"


async def get_vegetation_at_point(latitude: float, longitude: float) -> dict:
    """
    Look up the vegetation formation at the given coordinates.

    Returns a dict with:
        - vegetation_formation (str): the vegetation formation name (from the
          "vegForm" attribute), or "Not classified" if there's no vegetation
          mapped at this point.
        - vegetation_class (str): the vegetation class (from the "vegClass"
          attribute), or "Not classified" if there's no vegetation mapped at
          this point. This is the value used for the AS 3959 crosswalk.
        - raw_attributes (dict | None): the full raw attributes from SVTM,
          so the result can be verified/cross-checked.
    """

    # Build a small bounding box (map extent) around the point, as required
    # by the identify operation.
    extent_margin = 0.01
    map_extent = (
        f"{longitude - extent_margin},{latitude - extent_margin},"
        f"{longitude + extent_margin},{latitude + extent_margin}"
    )

    params = {
        "geometry": f"{longitude},{latitude}",
        "geometryType": "esriGeometryPoint",
        "sr": 4326,
        "layers": "all:0",  # Layer 0 = Vegetation Formation
        "tolerance": 2,
        "mapExtent": map_extent,
        "imageDisplay": "400,400,96",
        "returnGeometry": "false",
        "f": "json",
    }

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(
            f"{settings.SVTM_VEGETATION_API_URL}/identify", params=params
        )

    if response.status_code != 200:
        raise RuntimeError(
            f"SVTM vegetation request failed with status "
            f"{response.status_code}: {response.text}"
        )

    results = response.json().get("results", [])

    if not results:
        # No mapped vegetation usually means cleared/urban land.
        return {
            "vegetation_formation": NOT_CLASSIFIED,
            "vegetation_class": NOT_CLASSIFIED,
            "raw_attributes": None,
        }

    attributes = results[0]["attributes"]

    # Pixel value 0 gives vegForm/vegClass == "Not classified" already, so
    # this is the same "no real vegetation" outcome as an empty results list.
    return {
        "vegetation_formation": attributes["vegForm"],
        "vegetation_class": attributes["vegClass"],
        "raw_attributes": attributes,
    }

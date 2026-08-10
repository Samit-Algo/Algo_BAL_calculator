"""A small client for point-querying ArcGIS feature/map service layers.

Every flood source in FloodCheck — council flood studies and statewide planning
layers alike — asks the same question: "which feature covers this coordinate, and
what are its attributes?". That request is written once here so no provider has to
repeat the ArcGIS query parameters or the retry and error handling.
"""

import httpx

DEFAULT_TIMEOUT_SECONDS = 15
MAX_ATTEMPTS = 2

# ArcGIS expects point geometry as "x,y", which is longitude first.
WGS84_SPATIAL_REFERENCE = 4326


class ArcGisQueryError(Exception):
    """Raised when an ArcGIS layer cannot be queried or returns an error."""


def build_point_query_parameters(
    latitude: float,
    longitude: float,
    output_fields: str,
) -> dict:
    return {
        "geometry": f"{longitude},{latitude}",
        "geometryType": "esriGeometryPoint",
        "inSR": WGS84_SPATIAL_REFERENCE,
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": output_fields,
        "returnGeometry": "false",
        "f": "json",
    }


async def request_with_retry(
    client: httpx.AsyncClient,
    url: str,
    parameters: dict,
    description: str,
) -> httpx.Response:
    """Send the request, retrying once so a transient network blip surfaces as a
    clean upstream error rather than an unhandled exception."""
    last_error: httpx.RequestError | None = None
    for _ in range(MAX_ATTEMPTS):
        try:
            return await client.get(url, params=parameters)
        except httpx.RequestError as error:
            last_error = error
    raise ArcGisQueryError(f"{description} is unreachable: {last_error}")


async def query_point_attributes(
    client: httpx.AsyncClient,
    layer_url: str,
    latitude: float,
    longitude: float,
    output_fields: str,
    description: str,
) -> dict | None:
    """Return the attributes of the first feature covering the coordinate.

    Returns None when the coordinate falls outside every feature in the layer,
    which is a normal outcome and not an error.
    """
    parameters = build_point_query_parameters(latitude, longitude, output_fields)
    response = await request_with_retry(client, f"{layer_url}/query", parameters, description)

    if response.status_code != 200:
        raise ArcGisQueryError(
            f"{description} request failed with status {response.status_code}: "
            f"{response.text[:200]}"
        )

    payload = response.json()
    if "error" in payload:
        raise ArcGisQueryError(f"{description} returned an error: {payload['error']}")

    features = payload.get("features") or []
    if not features:
        return None
    return features[0].get("attributes") or {}

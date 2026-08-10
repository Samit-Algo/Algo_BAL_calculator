"""Ground height in metres AHD, from whichever state elevation model covers the point.

Each state publishes its own digital elevation model. They share the ArcGIS image
service `identify` contract, so one function reads them all; only the service URL
and its coverage differ.

Both models below return metres on the Australian Height Datum, the same ruler the
council flood levels use, so a depth is a plain subtraction with no datum
conversion.
"""

import json
from dataclasses import dataclass

import httpx

from app.geography import GeographicBounds

# The first request to a cold service can be slow, so allow generous time and one retry.
REQUEST_TIMEOUT_SECONDS = 30
MAX_ATTEMPTS = 2

# Returned by the image service when a point lies outside its coverage.
NO_DATA_VALUE = "NoData"


class ElevationServiceError(Exception):
    """Raised when an elevation service cannot be reached."""


@dataclass(frozen=True)
class ElevationModel:
    """A state digital elevation model and the area it covers."""

    name: str
    image_service_url: str
    coverage: GeographicBounds

    def covers(self, latitude: float, longitude: float) -> bool:
        return self.coverage.contains(latitude, longitude)


NSW_ELEVATION_MODEL = ElevationModel(
    name="NSW 5 m Elevation",
    image_service_url=(
        "https://maps.six.nsw.gov.au/arcgis/rest/services/public/"
        "NSW_5M_Elevation/ImageServer"
    ),
    coverage=GeographicBounds(
        minimum_latitude=-37.6,
        maximum_latitude=-28.1,
        minimum_longitude=140.9,
        maximum_longitude=153.7,
    ),
)

QUEENSLAND_ELEVATION_MODEL = ElevationModel(
    name="Queensland Digital Elevation Model",
    image_service_url=(
        "https://spatial-img.information.qld.gov.au/arcgis/rest/services/"
        "Elevation/QldDem/ImageServer"
    ),
    coverage=GeographicBounds(
        minimum_latitude=-29.3,
        maximum_latitude=-9.0,
        minimum_longitude=137.9,
        maximum_longitude=153.7,
    ),
)

ELEVATION_MODELS: tuple[ElevationModel, ...] = (
    NSW_ELEVATION_MODEL,
    QUEENSLAND_ELEVATION_MODEL,
)


def find_elevation_model(latitude: float, longitude: float) -> ElevationModel | None:
    """Return the elevation model covering this coordinate, if one does."""
    for model in ELEVATION_MODELS:
        if model.covers(latitude, longitude):
            return model
    return None


def build_identify_parameters(latitude: float, longitude: float) -> dict:
    return {
        "geometry": json.dumps(
            {"x": longitude, "y": latitude, "spatialReference": {"wkid": 4326}}
        ),
        "geometryType": "esriGeometryPoint",
        "returnGeometry": "false",
        "f": "json",
    }


def parse_elevation_value(raw_value) -> float | None:
    if raw_value is None or raw_value == NO_DATA_VALUE:
        return None
    try:
        return float(raw_value)
    except (TypeError, ValueError):
        return None


async def get_ground_level(latitude: float, longitude: float) -> float | None:
    """Ground height in metres AHD, or None where no model covers the point.

    None is a normal answer outside the mapped states, not an error.
    """
    model = find_elevation_model(latitude, longitude)
    if model is None:
        return None

    parameters = build_identify_parameters(latitude, longitude)
    last_error: httpx.RequestError | None = None

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        for _ in range(MAX_ATTEMPTS):
            try:
                response = await client.get(
                    f"{model.image_service_url}/identify", params=parameters
                )
                break
            except httpx.RequestError as error:
                last_error = error
        else:
            raise ElevationServiceError(
                f"{model.name} unavailable after {MAX_ATTEMPTS} attempts: {last_error}"
            ) from last_error

    if response.status_code != 200:
        raise ElevationServiceError(
            f"{model.name} request failed with status {response.status_code}: "
            f"{response.text[:200]}"
        )

    return parse_elevation_value(response.json().get("value"))

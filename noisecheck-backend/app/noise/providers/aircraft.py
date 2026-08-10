# Aircraft noise at a point, from the two authoritative sources that actually exist.
#
# 1. NSW ePlanning "Airport Noise" EPI layer (live ArcGIS query, CC BY).
#    Statewide, but only 29 polygons across 5 planning instruments — Western Sydney
#    Airport, Cessnock, Liverpool, Upper Hunter, Gloucester. Sydney (Kingsford Smith)
#    is NOT in it: the airport is Commonwealth land so its ANEF never entered an LEP.
#
# 2. Department of Defence airfield ANEF contours (bundled GeoJSON, CC BY 3.0 AU).
#    Covers RAAF Richmond, RAAF Williamtown and HMAS Albatross.
#
# Both report ANEF/ANEC — the Australian Noise Exposure Forecast/Concept. This is a
# dimensionless annoyance index, NOT decibels. "25-30" means ANEF units 25 to 30.

import json
from functools import lru_cache
from pathlib import Path

import httpx

from app.config import settings
from app.geo import point_in_polygon

DEFENCE_ANEF_PATH = Path(__file__).resolve().parents[2] / "data" / "defence_anef_nsw.geojson"


@lru_cache(maxsize=1)
def _load_defence_contours() -> dict:
    """Load the bundled Defence ANEF contours once and keep them in memory."""
    if not DEFENCE_ANEF_PATH.exists():
        return {"features": [], "attribution": None}
    return json.loads(DEFENCE_ANEF_PATH.read_text(encoding="utf-8"))


def _esri_rings_to_geojson(rings: list) -> dict:
    """ArcGIS polygon rings share GeoJSON's coordinate layout, so this is a relabel."""
    return {"type": "Polygon", "coordinates": rings}


async def _fetch_eplanning_contours(client: httpx.AsyncClient, instrument: str) -> list[dict]:
    """
    Every contour band belonging to one planning instrument, as GeoJSON features.

    The map needs the whole contour set for context — showing only the band the
    address falls in gives no sense of how close the next band is.
    """
    params = {
        "where": "EPI_NAME = '" + instrument.replace("'", "''") + "'",
        "outFields": "ANEF_CODE,EPI_NAME",
        "returnGeometry": "true",
        "outSR": "4326",
        # ~1 m precision. Full precision roughly triples the payload for no visible gain.
        "geometryPrecision": "5",
        "f": "json",
    }
    response = await client.get(settings.EPLANNING_AIRPORT_NOISE_URL, params=params)
    response.raise_for_status()

    features = []
    for feature in response.json().get("features") or []:
        geometry = feature.get("geometry") or {}
        if not geometry.get("rings"):
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"anef_band": feature["attributes"].get("ANEF_CODE")},
                "geometry": _esri_rings_to_geojson(geometry["rings"]),
            }
        )
    return features


async def _query_eplanning(latitude: float, longitude: float) -> dict | None:
    """Point-query the NSW ePlanning Airport Noise layer. Returns None if outside coverage."""
    params = {
        "geometry": f"{longitude},{latitude}",
        "geometryType": "esriGeometryPoint",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": "EPI_NAME,LGA_NAME,LAY_NAME,ANEF_CODE",
        "returnGeometry": "false",
        "f": "json",
    }
    async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(settings.EPLANNING_AIRPORT_NOISE_URL, params=params)
        response.raise_for_status()
        payload = response.json()

        features = payload.get("features") or []
        if not features:
            return None

        attributes = features[0]["attributes"]

        # The band is the answer; the full contour set is only there so the map can
        # show how close the next band sits. Fetching every polygon is by far the
        # slowest call here, so a failure on it must not cost us the answer we
        # already have — the read degrades to "no map geometry", not "no result".
        try:
            contours = await _fetch_eplanning_contours(client, attributes.get("EPI_NAME") or "")
        except (httpx.HTTPError, ValueError):
            contours = []

    return {
        "anef_band": attributes.get("ANEF_CODE"),
        "measure": attributes.get("LAY_NAME"),
        "instrument": attributes.get("EPI_NAME"),
        "lga": attributes.get("LGA_NAME") or None,
        "contours": contours,
        "source": "NSW ePlanning — Airport Noise EPI layer",
        "source_url": settings.EPLANNING_AIRPORT_NOISE_URL.replace("/query", ""),
        "licence": "CC BY 4.0",
        "provenance": {
            "api": "NSW ePlanning ArcGIS REST — Airport Noise (layer 235)",
            "steps": [
                {
                    "label": "Ask which contour contains this point",
                    "method": "GET",
                    "url": settings.EPLANNING_AIRPORT_NOISE_URL,
                    "body": {**params, "geometry": f"{longitude},{latitude}"},
                    "note": (
                        "A spatial intersect query. Returns the contour polygon the "
                        "address falls inside, or an empty list if none does."
                    ),
                    "raw": {"attributes": attributes},
                },
            ],
            "mapping": [
                {"ui": "ANEF band", "from": "ANEF_CODE", "via": "shown as-is"},
                {"ui": "Instrument", "from": "EPI_NAME", "via": "shown as-is"},
                {"ui": "Measure", "from": "LAY_NAME", "via": "shown as-is"},
                {"ui": "Map contours", "from": "geometry.rings", "via": "relabelled as GeoJSON"},
            ],
        },
    }


def _query_defence(latitude: float, longitude: float) -> dict | None:
    """Test the point against the bundled Defence ANEF contours (worst band first)."""
    contours = _load_defence_contours()
    for feature in contours["features"]:
        if point_in_polygon(longitude, latitude, feature["geometry"]["coordinates"]):
            properties = feature["properties"]
            base = properties["base"]
            # Return every band for this base so the map can show the full contour set.
            base_contours = [
                {
                    "type": "Feature",
                    "properties": {"anef_band": other["properties"]["anef_band"]},
                    "geometry": other["geometry"],
                }
                for other in contours["features"]
                if other["properties"]["base"] == base
            ]
            return {
                "anef_band": properties["anef_band"],
                "measure": "Australian Noise Exposure Forecast (units)",
                "instrument": base,
                "lga": None,
                "contours": base_contours,
                "provenance": {
                    "api": "Bundled file — no network call",
                    "steps": [
                        {
                            "label": "Point-in-polygon against the bundled contours",
                            "method": "LOCAL",
                            "url": "app/data/defence_anef_nsw.geojson",
                            "note": (
                                f"{len(contours['features'])} NSW polygons, converted once "
                                "from the Defence KML on data.gov.au. Bands are tested "
                                "worst-first, so the first hit is the answer."
                            ),
                            "raw": {"properties": properties},
                        },
                    ],
                    "mapping": [
                        {"ui": "ANEF band", "from": "anef_band", "via": "shown as-is"},
                        {"ui": "Instrument", "from": "base", "via": "shown as-is"},
                        {"ui": "Map contours", "from": "geometry", "via": "already GeoJSON"},
                    ],
                },
                "source": "Department of Defence — Defence Airfields ANEF",
                "source_url": (
                    "https://data.gov.au/data/dataset/"
                    "ed102748-0701-4d38-b2eb-a8b1d009ee9f"
                ),
                "licence": "CC BY 3.0 AU",
            }
    return None


async def assess_aircraft_noise(latitude: float, longitude: float) -> dict:
    """
    Return the aircraft noise finding for a point.

    Confidence A means an authoritative published contour covers this address.
    No contour is NOT the same as "quiet" — see the caveat in the payload.
    """
    # The two sources fail independently. ePlanning is a network call and can time
    # out; the Defence contours are a local file and cannot. If the live layer is
    # unreachable we still check Defence, and only report an outage when that also
    # finds nothing — otherwise a flaky upstream would hide a real Williamtown hit.
    eplanning_error: Exception | None = None
    try:
        finding = await _query_eplanning(latitude, longitude)
    except (httpx.HTTPError, ValueError, KeyError) as error:
        eplanning_error = error
        finding = None

    if finding is None:
        finding = _query_defence(latitude, longitude)

    if finding is None and eplanning_error is not None:
        reason = str(eplanning_error).strip() or type(eplanning_error).__name__
        return {
            "status": "unavailable",
            "confidence": None,
            "unit": "ANEF units",
            "value": None,
            "headline": "Aircraft noise unavailable",
            "caveat": (
                f"Could not reach the NSW ePlanning layer ({reason}). This is a service "
                "fault, not a finding — it does not mean the address is unaffected."
            ),
            "geojson": {"type": "FeatureCollection", "features": []},
            "provenance": None,
            "sources": [],
        }

    if finding is None:
        return {
            "status": "no_data",
            "confidence": None,
            "unit": "ANEF units",
            "value": None,
            "headline": "No published aircraft noise contour covers this address",
            "caveat": (
                "Absence of a contour does not mean the address is quiet. Sydney "
                "(Kingsford Smith) Airport has no contour in any NSW planning "
                "instrument, so addresses under its flight paths return no data here."
            ),
            "geojson": {"type": "FeatureCollection", "features": []},
            "provenance": {
                "api": "NSW ePlanning ArcGIS REST — Airport Noise (layer 235)",
                "steps": [
                    {
                        "label": "Asked, and the layer had nothing here",
                        "method": "GET",
                        "url": settings.EPLANNING_AIRPORT_NOISE_URL,
                        "note": (
                            "Both sources were checked and neither covers this point. "
                            "The query succeeded — the answer is genuinely 'no contour'."
                        ),
                        "raw": {"features": []},
                    },
                ],
                "mapping": [],
            },
            "sources": [],
        }

    return {
        "status": "covered",
        "confidence": "A",
        "unit": "ANEF units",
        "value": finding["anef_band"],
        "headline": f"ANEF {finding['anef_band']} — {finding['instrument']}",
        "measure": finding["measure"],
        "lga": finding["lga"],
        "caveat": (
            "ANEF is a dimensionless annoyance index, not decibels. Bands are set by "
            "planning instruments and forecast a future year, not today's flights."
        ),
        # Every band for this airport, so the map shows how close the next band is.
        "geojson": {
            "type": "FeatureCollection",
            "features": finding.get("contours") or [],
        },
        "provenance": finding.get("provenance"),
        "sources": [
            {
                "name": finding["source"],
                "url": finding["source_url"],
                "licence": finding["licence"],
            }
        ],
    }

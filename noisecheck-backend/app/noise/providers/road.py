# Road traffic noise at a point — MODELLED, not measured.
#
# There is no public GIS layer of road traffic noise in NSW. Transport for NSW
# publishes ~80 static PDF "traffic volume" maps for the Transport and Infrastructure
# SEPP, and nothing else. So to say anything at all about road noise we have to model it.
#
# This is a deliberately simple first-order estimate, and it is labelled Confidence C
# everywhere it surfaces. It exists to demonstrate the product shape, not to be an
# acoustic assessment. A real build would use CNOSSOS-EU or CoRTN with actual AADT
# counts from the TfNSW open data API, plus terrain, buildings and barriers.
#
# Method:
#   1. Pull nearby road geometry from OpenStreetMap via Overpass.
#   2. Assign each road a reference level by its OSM class (a proxy for traffic volume).
#   3. Attenuate over distance as a line source (3 dB per doubling) plus a ground term.
#   4. Energy-sum the contributions.
#
# Road data © OpenStreetMap contributors, ODbL.

import asyncio
import math

import httpx

from app.config import settings
from app.geo import decibel_sum, distance_to_segment_metres

# Indicative LAeq(day) at 10 m from the kerb, free field, by OSM highway class.
# These stand in for traffic volume, speed and heavy-vehicle share, none of which
# OSM reliably carries. They are calibrated to be plausible, not authoritative.
REFERENCE_LEVELS_AT_10M = {
    "motorway": 76.0,
    "motorway_link": 71.0,
    "trunk": 74.0,
    "trunk_link": 69.0,
    "primary": 71.0,
    "primary_link": 66.0,
    "secondary": 67.0,
    "secondary_link": 62.0,
    "tertiary": 63.0,
    "tertiary_link": 59.0,
    "residential": 55.0,
    "unclassified": 55.0,
    "living_street": 50.0,
    "service": 48.0,
}

REFERENCE_DISTANCE_METRES = 10.0
# Closer than this and the line-source model stops behaving; clamp instead.
MINIMUM_DISTANCE_METRES = 5.0

# How many roads the report lists individually. The total always sums all of them.
MAX_CONTRIBUTORS_SHOWN = 6

# The shared Overpass endpoint sheds load intermittently; see _fetch_nearby_roads.

OVERPASS_QUERY_TEMPLATE = """
[out:json][timeout:{timeout}];
way(around:{radius},{latitude},{longitude})["highway"~"^({classes})$"];
out tags geom;
"""


def _attenuation_db(distance_metres: float) -> float:
    """
    Level drop from 10 m out to `distance_metres`.

    A road is a line source, so geometric spreading is 3 dB per distance doubling
    (10*log10). The extra 1.5*log10 term is a rough stand-in for ground absorption
    and air attenuation over soft suburban ground.
    """
    distance = max(distance_metres, MINIMUM_DISTANCE_METRES)
    ratio = distance / REFERENCE_DISTANCE_METRES
    if ratio <= 1:
        return 0.0
    return 10 * math.log10(ratio) + 1.5 * math.log10(ratio)


async def _fetch_nearby_roads(latitude: float, longitude: float) -> tuple[list[dict], str]:
    """
    Return the raw Overpass elements plus the query text that produced them.

    The public Overpass endpoint is shared and frequently sheds load, answering 504
    or 429 and then succeeding seconds later on the identical query. Road noise is a
    third of the report, so a transient wobble is worth one retry rather than losing
    the whole section.
    """
    query = OVERPASS_QUERY_TEMPLATE.format(
        timeout=settings.UPSTREAM_TIMEOUT_SECONDS,
        radius=settings.ROAD_SEARCH_RADIUS_METRES,
        latitude=latitude,
        longitude=longitude,
        classes="|".join(REFERENCE_LEVELS_AT_10M.keys()),
    )

    last_error: Exception | None = None
    async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS + 10) as client:
        for attempt in range(settings.OVERPASS_ATTEMPTS):
            try:
                response = await client.post(
                    settings.OVERPASS_URL,
                    content=query.encode("utf-8"),
                    headers={"User-Agent": settings.NOMINATIM_USER_AGENT},
                )
                response.raise_for_status()
                return response.json().get("elements", []), query.strip()
            except (httpx.HTTPError, ValueError) as error:
                last_error = error
                if attempt + 1 < settings.OVERPASS_ATTEMPTS:
                    await asyncio.sleep(settings.OVERPASS_RETRY_DELAY_SECONDS * (attempt + 1))

    raise last_error  # type: ignore[misc]


def _sample_way(ways: list[dict]) -> dict | None:
    """
    One raw way for the UI to show, with its coordinate list trimmed.

    A single way can carry hundreds of points; the shape of the response is the
    point, not the full geometry.
    """
    named = next((w for w in ways if (w.get("tags") or {}).get("name")), None)
    way = named or (ways[0] if ways else None)
    if way is None:
        return None

    geometry = way.get("geometry") or []
    return {
        **{k: v for k, v in way.items() if k != "geometry"},
        "geometry": geometry[:3] + ([{"...": f"{len(geometry) - 3} more points"}] if len(geometry) > 3 else []),
    }


def _nearest_distance_to_way(latitude: float, longitude: float, way: dict) -> float | None:
    """Shortest distance from the point to any segment of this way, in metres."""
    geometry = way.get("geometry") or []
    if len(geometry) < 2:
        return None
    return min(
        distance_to_segment_metres(
            latitude,
            longitude,
            geometry[i]["lat"],
            geometry[i]["lon"],
            geometry[i + 1]["lat"],
            geometry[i + 1]["lon"],
        )
        for i in range(len(geometry) - 1)
    )


async def assess_road_noise(latitude: float, longitude: float) -> dict:
    """Return a modelled road traffic noise estimate. Always Confidence C."""
    try:
        ways, query = await _fetch_nearby_roads(latitude, longitude)
    except (httpx.HTTPError, ValueError) as error:
        return {
            "status": "unavailable",
            "confidence": None,
            "unit": "dB LAeq(day), estimated",
            "value": None,
            "headline": "Road noise estimate unavailable",
            "caveat": f"Could not reach the OpenStreetMap Overpass API: {error}",
            "contributors": [],
            "geojson": {"type": "FeatureCollection", "features": []},
            "provenance": None,
            "sources": [],
        }

    # OSM splits a single physical road into many way segments (speed limit changes,
    # bridges, lane counts). Treating each as an independent source would energy-sum
    # the same road several times and inflate the total by several dB. Collapse them:
    # one entry per distinct road, at its nearest approach to the address.
    nearest_by_road: dict[tuple[str, str], dict] = {}

    for way in ways:
        tags = way.get("tags") or {}
        highway_class = tags.get("highway")
        reference_level = REFERENCE_LEVELS_AT_10M.get(highway_class)
        if reference_level is None:
            continue

        distance = _nearest_distance_to_way(latitude, longitude, way)
        if distance is None or distance > settings.ROAD_SEARCH_RADIUS_METRES:
            continue

        # Unnamed ways of the same class are kept separate by OSM id — we cannot tell
        # whether they are one road or several, so we do not merge them.
        name = tags.get("name")
        key = (name, highway_class) if name else (f"way/{way.get('id')}", highway_class)

        existing = nearest_by_road.get(key)
        if existing is None or distance < existing["_distance"]:
            nearest_by_road[key] = {
                "_distance": distance,
                # Kept for the map, stripped from the JSON summary below.
                "_geometry": way.get("geometry") or [],
                "name": name or f"unnamed {highway_class}",
                "road_class": highway_class,
                "distance_m": round(distance),
                "contribution_db": round(reference_level - _attenuation_db(distance), 1),
            }

    # Draw every contributing road, coloured by how much it contributes.
    road_features = [
        {
            "type": "Feature",
            "properties": {
                "name": entry["name"],
                "road_class": entry["road_class"],
                "distance_m": entry["distance_m"],
                "contribution_db": entry["contribution_db"],
            },
            "geometry": {
                "type": "LineString",
                "coordinates": [[point["lon"], point["lat"]] for point in entry["_geometry"]],
            },
        }
        for entry in nearest_by_road.values()
        if len(entry["_geometry"]) >= 2
    ]

    contributors = list(nearest_by_road.values())
    for contributor in contributors:
        contributor.pop("_distance", None)
        contributor.pop("_geometry", None)

    if not contributors:
        return {
            "status": "no_roads_found",
            "confidence": None,
            "unit": "dB LAeq(day), estimated",
            "value": None,
            "headline": "No mapped roads within "
            f"{settings.ROAD_SEARCH_RADIUS_METRES} m",
            "caveat": "Nothing to model from. This is usually a rural address.",
            "contributors": [],
            "geojson": {"type": "FeatureCollection", "features": []},
            "provenance": None,
            "sources": [],
        }

    contributors.sort(key=lambda c: c["contribution_db"], reverse=True)
    total = decibel_sum([c["contribution_db"] for c in contributors])
    dominant = contributors[0]

    # The table shows only the loudest few, but the total sums every road. Report
    # what was left out and what it added, so the visible rows reconcile with the
    # headline instead of silently disagreeing with it.
    shown = contributors[:MAX_CONTRIBUTORS_SHOWN]
    remainder = contributors[MAX_CONTRIBUTORS_SHOWN:]
    remainder_db = (
        round(decibel_sum([c["contribution_db"] for c in remainder]), 1) if remainder else None
    )

    return {
        "status": "modelled",
        "confidence": "C",
        "unit": "dB LAeq(day), estimated",
        "value": round(total, 1),
        "headline": f"~{round(total)} dB LAeq(day), estimated",
        "dominant_source": f"{dominant['name']} ({dominant['distance_m']} m)",
        "caveat": (
            "Modelled estimate only — first-order line-source attenuation from OSM road "
            "classes. No traffic counts, terrain, buildings or barriers are used. Not an "
            "acoustic assessment and not suitable for planning decisions."
        ),
        "roads_modelled": len(contributors),
        "roads_hidden": len(remainder),
        "hidden_contribution_db": remainder_db,
        "contributors": shown,
        # OpenStreetMap gives geometry and a road class — every decibel below is ours.
        "provenance": {
            "api": "OpenStreetMap Overpass API",
            "steps": [
                {
                    "label": f"Fetch roads within {settings.ROAD_SEARCH_RADIUS_METRES} m",
                    "method": "POST",
                    "url": settings.OVERPASS_URL,
                    "body": query,
                    "note": (
                        f"Returned {len(ways)} raw way segments. Note there is no noise "
                        "field anywhere in the response — only geometry and a road class."
                    ),
                    "raw": _sample_way(ways),
                },
                {
                    "label": "Convert road class to a noise level",
                    "method": "CALCULATED",
                    "url": "app/services/road_noise.py",
                    "note": (
                        f"{dominant['road_class']} assumed at "
                        f"{REFERENCE_LEVELS_AT_10M[dominant['road_class']]} dB at 10 m, then "
                        f"faded to {dominant['distance_m']} m "
                        f"(-3 dB per doubling) = {dominant['contribution_db']} dB. "
                        f"All {len(contributors)} roads combined by energy = {round(total, 1)} dB."
                    ),
                    "raw": {
                        "reference_levels_at_10m": REFERENCE_LEVELS_AT_10M,
                        "formula": "level = reference - (10*log10(d/10) + 1.5*log10(d/10))",
                        "combine": "total = 10*log10(sum(10^(level/10)))",
                    },
                },
            ],
            "mapping": [
                {"ui": "Road name", "from": "tags.name", "via": "shown as-is"},
                {"ui": "Class", "from": "tags.highway", "via": "shown as-is"},
                {"ui": "Distance", "from": "geometry", "via": "nearest point on the line"},
                {"ui": "Contribution", "from": "tags.highway + distance", "via": "CALCULATED, not from OSM"},
                {"ui": "Total", "from": "all contributions", "via": "CALCULATED, energy sum"},
            ],
        },
        "geojson": {"type": "FeatureCollection", "features": road_features},
        "sources": [
            {
                "name": "Road geometry © OpenStreetMap contributors (via Overpass)",
                "url": "https://www.openstreetmap.org/copyright",
                "licence": "ODbL",
            }
        ],
    }

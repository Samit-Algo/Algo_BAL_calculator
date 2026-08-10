"""The on-screen explanation of how NoiseCheck works.

This is served rather than written into the frontend, and the numbers in it are read
from the same constants the providers use. Tuning the search radius or a reference
level changes the explanation automatically, instead of leaving the UI describing
behaviour the code no longer has.

Prose that is genuinely editorial — what ANEF means, why a station reading is not an
address reading — lives here as text. Anything numeric is derived.
"""

import json
from pathlib import Path

from app.config import settings
from app.noise.providers.aircraft import DEFENCE_ANEF_PATH
from app.noise.providers.road import MAX_CONTRIBUTORS_SHOWN, REFERENCE_LEVELS_AT_10M

CONFIDENCE_GRADES = [
    {"grade": "A", "meaning": "Official published data covers this exact spot."},
    {"grade": "B", "meaning": "A real measurement, but taken somewhere nearby."},
    {"grade": "C", "meaning": "Modelled — a calculated estimate, not a measurement."},
]


def _defence_coverage() -> dict:
    """Polygon and base counts read from the bundled file, not remembered."""
    if not DEFENCE_ANEF_PATH.exists():
        return {"polygons": 0, "bases": []}
    data = json.loads(Path(DEFENCE_ANEF_PATH).read_text(encoding="utf-8"))
    features = data.get("features", [])
    return {
        "polygons": len(features),
        "bases": sorted({f["properties"]["base"] for f in features}),
    }


def describe_method() -> dict:
    defence = _defence_coverage()
    headline_classes = ("motorway", "trunk", "primary", "tertiary", "residential")

    return {
        "confidence_grades": CONFIDENCE_GRADES,
        "reads": [
            {
                "key": "aircraft",
                "title": "Aircraft noise",
                "grade": "A",
                "summary": "Looked up, not calculated.",
                "detail": [
                    "Government already drew these contour maps. We test whether the "
                    "address falls inside one — like checking a flood zone.",
                    "ANEF is not decibels. It is an annoyance index combining how loud "
                    "each flyover is, how many there are, and whether they happen at "
                    "night. It has no unit: ANEF 30 does not mean 30 dB.",
                ],
                "scale": [
                    {"band": "under 20", "meaning": "generally fine for housing"},
                    {"band": "20–25", "meaning": "acceptable, noticeable"},
                    {"band": "25–30", "meaning": "needs acoustic treatment"},
                    {"band": "30+", "meaning": "unsuitable for new housing"},
                ],
                "coverage": (
                    f"Two sources: the NSW ePlanning airport noise layer (five planning "
                    f"instruments statewide), and {defence['polygons']} bundled Defence "
                    f"polygons covering {', '.join(defence['bases'])}. "
                    "Sydney Airport has no contour in either — it is Commonwealth land, "
                    "so its contours never entered NSW planning law. Blank does not mean quiet."
                ),
                "apis": [
                    {"name": "NSW ePlanning ArcGIS REST (layer 235)",
                     "url": settings.EPLANNING_AIRPORT_NOISE_URL.replace("/query", ""),
                     "licence": "CC BY 4.0"},
                    {"name": "Department of Defence — Airfields ANEF (bundled)",
                     "url": "https://data.gov.au/data/dataset/ed102748-0701-4d38-b2eb-a8b1d009ee9f",
                     "licence": "CC BY 3.0 AU"},
                ],
            },
            {
                "key": "road",
                "title": "Road noise",
                "grade": "C",
                "summary": "Calculated from scratch.",
                "detail": [
                    "NSW publishes no road noise data at all — only static PDF traffic "
                    "volume maps — so there is nothing to look up.",
                    "Decibels do not add normally: 57 dB + 57 dB is 60 dB, not 114. A "
                    "source 10 dB quieter adds almost nothing, so only the loudest few "
                    "roads matter.",
                    "Why grade C: road type stands in for traffic volume, because "
                    "OpenStreetMap carries no traffic counts. A road with 40,000 cars "
                    "and one with 8,000 score identically. No terrain, buildings or "
                    "noise walls are modelled.",
                ],
                "steps": [
                    f"Find every road within {settings.ROAD_SEARCH_RADIUS_METRES} m.",
                    "Assume a kerbside level from the road's type: "
                    + ", ".join(
                        f"{name} {REFERENCE_LEVELS_AT_10M[name]:.0f} dB"
                        for name in headline_classes
                    )
                    + " at 10 m.",
                    "Fade with distance — about 3 dB each time distance doubles, "
                    "because roads are long lines rather than points.",
                    "Combine every road by sound energy.",
                ],
                "formula": "level = reference − (10·log10(d/10) + 1.5·log10(d/10))",
                "combine": "total = 10·log10( Σ 10^(level/10) )",
                "table_note": (
                    f"The result table lists the {MAX_CONTRIBUTORS_SHOWN} loudest roads; "
                    "the total always sums every road found, with the remainder shown as "
                    "its own row."
                ),
                "apis": [
                    {"name": "OpenStreetMap Overpass API",
                     "url": settings.OVERPASS_URL,
                     "licence": "ODbL"},
                ],
            },
            {
                "key": "air_quality",
                "title": "Air quality",
                "grade": "B",
                "summary": "Genuinely measured — unlike noise, this one has a live API.",
                "detail": [
                    "NSW runs a network of monitoring stations: cabinets of instruments "
                    "in fixed locations, sampling air continuously. We find the nearest "
                    "and read its latest hourly values.",
                    "Why grade B: the stations cannot cover every address. A reading "
                    "describes the local airshed, not the front yard — and stations sit "
                    "away from traffic on purpose, so a house on a truck route is likely "
                    "worse than shown.",
                    f"Falls to grade C once the nearest station is more than "
                    f"{settings.AIR_QUALITY_MAX_STATION_DISTANCE_KM:.0f} km away.",
                ],
                "pollutants": [
                    {"code": "PM2.5", "meaning": "fine soot — exhaust, wood smoke, bushfires"},
                    {"code": "PM10", "meaning": "coarser dust and pollen"},
                    {"code": "NO2", "meaning": "traffic and diesel exhaust"},
                    {"code": "OZONE", "meaning": "forms in sunlight; peaks hot afternoons"},
                ],
                "apis": [
                    {"name": "NSW Air Quality API (DCCEEW/EPA)",
                     "url": settings.AIR_QUALITY_BASE_URL,
                     "licence": "CC BY 4.0"},
                ],
            },
        ],
        "geocoder": {
            "provider": "Geoscape" if settings.GEOSCAPE_API_KEY else "OpenStreetMap Nominatim",
            "note": (
                "Suburb-only searches resolve to the suburb centre. Contour edges are "
                "sharp, so a suburb search can miss a contour that a street address "
                "inside it would hit."
            ),
        },
        "limits": [
            "A demonstration of available data, not an acoustic or environmental "
            "assessment. Not for planning, valuation or purchase decisions.",
            "Aircraft figures forecast a future year — not today's flights, and not decibels.",
        ],
    }

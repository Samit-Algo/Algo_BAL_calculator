# Air quality at a point, from the NSW air quality monitoring network.
#
# Unlike noise, air quality DOES have a real live government API — this is the
# contrast that makes the demo worth building. We find the nearest monitoring
# station and read its latest hourly observations.
#
# Note the honest limitation: this is a station reading, not an address reading.
# A station 8 km away tells you about the airshed, not about the kerbside.
#
# Source : https://data.airquality.nsw.gov.au/
# Licence: CC BY (NSW Government open data)

from datetime import date, timedelta

import httpx

from app.config import settings
from app.geo import haversine_metres

# Pollutants worth showing on a property report, in display order.
REQUESTED_PARAMETERS = ["PM2.5", "PM10", "NO2", "OZONE"]

PARAMETER_LABELS = {
    "PM2.5": "Fine particles (PM2.5)",
    "PM10": "Coarse particles (PM10)",
    "NO2": "Nitrogen dioxide",
    "OZONE": "Ozone",
}


async def _fetch_sites(client: httpx.AsyncClient) -> list[dict]:
    response = await client.get(f"{settings.AIR_QUALITY_BASE_URL}/get_SiteDetails")
    response.raise_for_status()
    return response.json()


async def _fetch_observations(
    client: httpx.AsyncClient, site_id: int
) -> tuple[list[dict], dict]:
    """Return the raw observations plus the request that produced them."""
    # Ask for a short recent window; the network publishes hourly and lags a little.
    end = date.today()
    start = end - timedelta(days=2)
    body = {
        "Sites": [site_id],
        "Parameters": REQUESTED_PARAMETERS,
        "StartDate": start.isoformat(),
        "EndDate": end.isoformat(),
        "Categories": ["Averages"],
        "SubCategories": ["Hourly"],
        "Frequency": ["Hourly average"],
    }
    url = f"{settings.AIR_QUALITY_BASE_URL}/get_Observations"
    response = await client.post(url, json=body)
    response.raise_for_status()
    return response.json(), {"method": "POST", "url": url, "body": body}


def _latest_per_parameter(observations: list[dict]) -> dict[str, dict]:
    """Keep the most recent non-null reading for each pollutant."""
    latest: dict[str, dict] = {}
    for observation in observations:
        value = observation.get("Value")
        if value is None:
            continue
        parameter = observation.get("Parameter") or {}
        code = parameter.get("ParameterCode")
        if code not in REQUESTED_PARAMETERS:
            continue

        stamp = (observation.get("Date") or "", observation.get("Hour") or 0)
        if code not in latest or stamp > latest[code]["_stamp"]:
            latest[code] = {
                "_stamp": stamp,
                "code": code,
                "label": PARAMETER_LABELS.get(code, code),
                "value": round(float(value), 1),
                "unit": parameter.get("Units"),
                "category": observation.get("AirQualityCategory"),
                "observed": f"{observation.get('Date')} {observation.get('HourDescription')}",
            }
    for reading in latest.values():
        reading.pop("_stamp", None)
    return latest


async def assess_air_quality(latitude: float, longitude: float) -> dict:
    """Return the latest readings from the nearest NSW air quality monitoring station."""
    try:
        async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS) as client:
            sites = await _fetch_sites(client)

            located = [
                site
                for site in sites
                if site.get("Latitude") is not None and site.get("Longitude") is not None
            ]
            if not located:
                raise ValueError("Air quality API returned no located stations")

            nearest = min(
                located,
                key=lambda site: haversine_metres(
                    latitude, longitude, site["Latitude"], site["Longitude"]
                ),
            )
            distance_km = (
                haversine_metres(latitude, longitude, nearest["Latitude"], nearest["Longitude"])
                / 1000
            )
            observations, request = await _fetch_observations(client, nearest["Site_Id"])
    except (httpx.HTTPError, ValueError, KeyError) as error:
        return {
            "status": "unavailable",
            "confidence": None,
            "headline": "Air quality unavailable",
            "caveat": f"Could not reach the NSW air quality API: {error}",
            "readings": [],
            "provenance": None,
            "sources": [],
        }

    readings = list(_latest_per_parameter(observations).values())
    too_far = distance_km > settings.AIR_QUALITY_MAX_STATION_DISTANCE_KM

    # Confidence B: a real measurement, but from a station rather than the address.
    # Drops to C once the nearest station is too far to represent the address.
    confidence = "C" if too_far else "B"

    headline_reading = next((r for r in readings if r["code"] == "PM2.5"), None)
    if headline_reading:
        headline = (
            f"{headline_reading['label']} {headline_reading['value']} "
            f"{headline_reading['unit']} — {headline_reading['category'] or 'no category'}"
        )
    else:
        headline = f"Nearest station: {nearest['SiteName'].title()}"

    return {
        "status": "measured" if readings else "no_recent_readings",
        "confidence": confidence if readings else None,
        "headline": headline,
        "station": {
            "name": nearest["SiteName"].title(),
            "region": nearest.get("Region"),
            "distance_km": round(distance_km, 1),
            # The map draws the station and a line back to the address, so the
            # gap between "measured here" and "your address" is visible, not buried
            # in a caveat.
            "latitude": nearest["Latitude"],
            "longitude": nearest["Longitude"],
        },
        "caveat": (
            f"Measured at {nearest['SiteName'].title()}, {round(distance_km, 1)} km away — "
            "this describes the local airshed, not the address itself. Kerbside levels on a "
            "busy road are typically higher."
            + (
                " The nearest station is far enough away that this is only indicative."
                if too_far
                else ""
            )
        ),
        "readings": readings,
        # Shown in the UI so anyone can see the real call and the untouched response
        # it came from, rather than taking the tidy numbers on trust.
        "provenance": {
            "api": "NSW Air Quality API (DCCEEW/EPA)",
            "steps": [
                {
                    "label": "Find the nearest station",
                    "method": "GET",
                    "url": f"{settings.AIR_QUALITY_BASE_URL}/get_SiteDetails",
                    "note": f"Returns all {len(sites)} stations; we pick the closest by distance.",
                    "raw": nearest,
                },
                {
                    "label": "Read its latest hourly observations",
                    "method": request["method"],
                    "url": request["url"],
                    "body": request["body"],
                    "note": (
                        f"Returned {len(observations)} hourly records; we keep the most "
                        "recent non-null reading per pollutant."
                    ),
                    "raw": next(
                        (o for o in observations if o.get("Value") is not None),
                        observations[0] if observations else None,
                    ),
                },
            ],
            "mapping": [
                {"ui": "Pollutant name", "from": "Parameter.ParameterCode", "via": "renamed to plain English"},
                {"ui": "Latest value", "from": "Value", "via": "rounded to 1 decimal"},
                {"ui": "Unit", "from": "Parameter.Units", "via": "shown as-is"},
                {"ui": "Category", "from": "AirQualityCategory", "via": "shown as-is"},
                {"ui": "Observed", "from": "Date + HourDescription", "via": "joined into one label"},
                {"ui": "Distance", "from": "Latitude / Longitude", "via": "haversine from the address"},
            ],
        },
        "sources": [
            {
                "name": "NSW Air Quality Monitoring Network (DCCEEW/EPA)",
                "url": "https://data.airquality.nsw.gov.au/",
                "licence": "CC BY 4.0",
            }
        ],
    }

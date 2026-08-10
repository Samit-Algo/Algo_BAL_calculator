# Address -> coordinates.
#
# Two backends. Geoscape is used when GEOSCAPE_API_KEY is set (same provider the
# FloodCheck backend uses); otherwise we fall back to Nominatim so the demo runs
# with no credentials at all.
#
# Nominatim is fine for a demo but NOT for production: ~1 request/second, no SLA,
# and it resolves Australian addresses less precisely than Geoscape.

import httpx

from app.config import settings


SUGGESTION_LIMIT = 6


class AddressNotFoundError(Exception):
    """Raised when the address lookup finds no match."""


async def _geocode_via_geoscape(address: str) -> dict:
    headers = {"Authorization": settings.GEOSCAPE_API_KEY}
    async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS) as client:
        suggest = await client.get(
            settings.GEOSCAPE_ADDRESS_URL, params={"query": address}, headers=headers
        )
        suggest.raise_for_status()
        suggestions = suggest.json().get("suggest", [])
        if not suggestions:
            raise AddressNotFoundError(f"No address found matching: {address}")

        resolve = await client.get(
            f"{settings.GEOSCAPE_ADDRESS_URL}/{suggestions[0]['id']}", headers=headers
        )
        resolve.raise_for_status()
        resolved = resolve.json()["address"]

    # Geoscape returns coordinates as [longitude, latitude].
    longitude, latitude = resolved["geometry"]["coordinates"]
    return {
        "latitude": latitude,
        "longitude": longitude,
        "matched_address": resolved["properties"]["formatted_address"],
        "geocoder": "Geoscape Predictive Address API",
    }


async def _geocode_via_nominatim(address: str) -> dict:
    params = {
        "q": address,
        "format": "json",
        "limit": 1,
        "countrycodes": "au",
        "addressdetails": 1,
    }
    headers = {"User-Agent": settings.NOMINATIM_USER_AGENT}
    async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(settings.NOMINATIM_URL, params=params, headers=headers)
        response.raise_for_status()
        results = response.json()

    if not results:
        raise AddressNotFoundError(f"No address found matching: {address}")

    top = results[0]
    return {
        "latitude": float(top["lat"]),
        "longitude": float(top["lon"]),
        "matched_address": top["display_name"],
        "geocoder": "OpenStreetMap Nominatim (demo only)",
    }


async def geocode_address(address: str) -> dict:
    """Return {latitude, longitude, matched_address, geocoder} for a free-text address."""
    if settings.GEOSCAPE_API_KEY:
        return await _geocode_via_geoscape(address)
    return await _geocode_via_nominatim(address)


async def _suggest_via_geoscape(partial_text: str) -> list[str]:
    headers = {"Authorization": settings.GEOSCAPE_API_KEY}
    async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(
            settings.GEOSCAPE_ADDRESS_URL, params={"query": partial_text}, headers=headers
        )
        response.raise_for_status()
        return [s["address"] for s in response.json().get("suggest", [])]


async def _suggest_via_nominatim(partial_text: str) -> list[str]:
    params = {
        "q": partial_text,
        "format": "json",
        "limit": SUGGESTION_LIMIT,
        "countrycodes": "au",
    }
    headers = {"User-Agent": settings.NOMINATIM_USER_AGENT}
    async with httpx.AsyncClient(timeout=settings.UPSTREAM_TIMEOUT_SECONDS) as client:
        response = await client.get(settings.NOMINATIM_URL, params=params, headers=headers)
        response.raise_for_status()
        return [result["display_name"] for result in response.json()]


async def get_address_suggestions(partial_text: str) -> list[str]:
    """Ranked address suggestions for autocomplete."""
    if settings.GEOSCAPE_API_KEY:
        return await _suggest_via_geoscape(partial_text)
    return await _suggest_via_nominatim(partial_text)

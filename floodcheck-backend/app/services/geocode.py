# Address -> coordinates via the Geoscape Predictive Address API.
# Standalone port for the FloodCheck backend — no EmberCheck imports.

import httpx

from app.config import settings

REQUEST_TIMEOUT_SECONDS = 10


class AddressNotFoundError(Exception):
    """Raised when the address lookup API can't find a match."""


def build_auth_headers() -> dict:
    # Geoscape expects the raw API key in the Authorization header (no "Bearer").
    return {"Authorization": settings.GEOSCAPE_API_KEY}


async def geocode_address(address: str) -> dict:
    """
    Look up an address and return {latitude, longitude, matched_address}.
    Raises AddressNotFoundError if no match is found.
    """
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        suggest = await client.get(
            settings.ADDRESS_API_URL, params={"query": address}, headers=build_auth_headers()
        )
        if suggest.status_code != 200:
            raise RuntimeError(
                f"Address autocomplete failed with status {suggest.status_code}: {suggest.text}"
            )
        suggestions = suggest.json().get("suggest", [])
        if not suggestions:
            raise AddressNotFoundError(f"No address found matching: {address}")

        top_id = suggestions[0]["id"]
        resolve = await client.get(
            f"{settings.ADDRESS_API_URL}/{top_id}", headers=build_auth_headers()
        )
        if resolve.status_code != 200:
            raise RuntimeError(
                f"Address resolve failed with status {resolve.status_code}: {resolve.text}"
            )
        resolved = resolve.json()["address"]

    # Geoscape returns coordinates as [longitude, latitude].
    longitude, latitude = resolved["geometry"]["coordinates"]
    return {
        "latitude": latitude,
        "longitude": longitude,
        "matched_address": resolved["properties"]["formatted_address"],
    }


async def get_address_suggestions(partial_text: str) -> list[str]:
    """Return ranked address suggestion strings for autocomplete."""
    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(
            settings.ADDRESS_API_URL, params={"query": partial_text}, headers=build_auth_headers()
        )
        if response.status_code != 200:
            raise RuntimeError(
                f"Address autocomplete failed with status {response.status_code}: {response.text}"
            )
        suggestions = response.json().get("suggest", [])
    return [s["address"] for s in suggestions]

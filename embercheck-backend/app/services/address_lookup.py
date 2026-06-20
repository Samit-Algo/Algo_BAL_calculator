# This service turns a typed address into map coordinates (latitude/longitude)
# by calling the Geoscape Predictive Address API.
#
# Geoscape uses a two-step flow:
#   1. Autocomplete - search for the address and get back a short list of
#      suggestions, each with an "id".
#   2. Resolve - look up the full details (including coordinates) for the
#      chosen suggestion's "id".

import httpx

from app.config import settings

# How long to wait for a response before giving up.
REQUEST_TIMEOUT_SECONDS = 10


class AddressNotFoundError(Exception):
    """Raised when the address lookup API can't find a match for the given address."""


def _auth_headers() -> dict:
    """Build the headers needed to authenticate with the Geoscape API."""
    # Geoscape expects the raw API key in the Authorization header (no "Bearer" prefix).
    return {"Authorization": settings.GEOSCAPE_API_KEY}


async def geocode_address(address: str) -> dict:
    """
    Look up an address and return its coordinates.

    Returns a dict with:
        - latitude (float)
        - longitude (float)
        - matched_address (str): the official formatted address from the API

    Raises:
        AddressNotFoundError: if no matching address is found.
    """

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        # Step 1: autocomplete - search for the address.
        suggest_response = await client.get(
            settings.ADDRESS_API_URL,
            params={"query": address},
            headers=_auth_headers(),
        )

        if suggest_response.status_code != 200:
            raise RuntimeError(
                f"Address autocomplete request failed with status "
                f"{suggest_response.status_code}: {suggest_response.text}"
            )

        suggestions = suggest_response.json().get("suggest", [])

        if not suggestions:
            raise AddressNotFoundError(f"No address found matching: {address}")

        # The suggestions are ranked - the first one is the best match.
        top_suggestion_id = suggestions[0]["id"]

        # Step 2: resolve - get the full details (including coordinates) for that id.
        resolve_response = await client.get(
            f"{settings.ADDRESS_API_URL}/{top_suggestion_id}",
            headers=_auth_headers(),
        )

        if resolve_response.status_code != 200:
            raise RuntimeError(
                f"Address resolve request failed with status "
                f"{resolve_response.status_code}: {resolve_response.text}"
            )

        resolved_address = resolve_response.json()["address"]

    # IMPORTANT: Geoscape returns coordinates as [longitude, latitude],
    # i.e. longitude comes first.
    longitude, latitude = resolved_address["geometry"]["coordinates"]
    matched_address = resolved_address["properties"]["formatted_address"]

    return {
        "latitude": latitude,
        "longitude": longitude,
        "matched_address": matched_address,
    }


async def get_address_suggestions(partial_text: str) -> list[str]:
    """
    Return a list of suggested address strings for autocomplete, based on
    partial user input.
    """

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        response = await client.get(
            settings.ADDRESS_API_URL,
            params={"query": partial_text},
            headers=_auth_headers(),
        )

        if response.status_code != 200:
            raise RuntimeError(
                f"Address autocomplete request failed with status "
                f"{response.status_code}: {response.text}"
            )

        suggestions = response.json().get("suggest", [])

    return [suggestion["address"] for suggestion in suggestions]

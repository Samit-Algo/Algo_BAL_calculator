"""NoiseCheck API routes.

    GET /noise/point?lat=..&lon=..   assess a coordinate
    GET /noise/address?q=<address>   geocode an address, then assess it
    GET /noise/suggest?q=<partial>   address autocomplete
    GET /noise/method                what each read is, and its licence
"""

from fastapi import APIRouter, HTTPException, Query

from app.noise.method import describe_method
from app.noise.resolver import resolve_noise
from app.services.geocode import (
    AddressNotFoundError,
    geocode_address,
    get_address_suggestions,
)

router = APIRouter(prefix="/noise", tags=["noisecheck"])

MINIMUM_SUGGESTION_LENGTH = 3


@router.get("/point")
async def noise_point(
    lat: float = Query(..., ge=-90, le=90, description="Latitude (WGS84)"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude (WGS84)"),
):
    return await resolve_noise(lat, lon)


@router.get("/address")
async def noise_address(q: str = Query(..., min_length=3, description="Street address")):
    try:
        location = await geocode_address(q)
    except AddressNotFoundError:
        raise HTTPException(status_code=404, detail=f"No address found matching: {q}")
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Address lookup failed: {error}")

    result = await resolve_noise(location["latitude"], location["longitude"])
    result["query"] = q
    result["location"] = location
    return result


@router.get("/suggest")
async def noise_suggest(q: str = Query("", description="Partial address")):
    """Address autocomplete. Forgiving: short queries and upstream hiccups return []."""
    if len(q.strip()) < MINIMUM_SUGGESTION_LENGTH:
        return []
    try:
        return await get_address_suggestions(q)
    except Exception:
        return []


@router.get("/method")
async def noise_method():
    """
    How each read works, served rather than hard-coded in the UI.

    The frontend's explainer renders from this, so tuning a constant in config
    cannot leave the on-screen explanation quietly describing the old behaviour.
    """
    return describe_method()

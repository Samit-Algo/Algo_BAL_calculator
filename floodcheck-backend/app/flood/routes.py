"""FloodCheck API routes.

    GET /flood/point?lat=..&lon=..   assess a coordinate through the tier cascade
    GET /flood/address?q=<address>   geocode an address, then assess it
    GET /flood/suggest?q=<partial>   address autocomplete
    GET /flood/councils              councils currently registered for Tier A
"""

from fastapi import APIRouter, HTTPException, Query

from app.flood.providers.registry import list_registered_councils
from app.flood.resolver import resolve_flood
from app.services.arcgis_feature_service import ArcGisQueryError
from app.services.geocode import (
    AddressNotFoundError,
    geocode_address,
    get_address_suggestions,
)

router = APIRouter(prefix="/flood", tags=["floodcheck"])

MINIMUM_SUGGESTION_LENGTH = 3


async def assess_coordinate(latitude: float, longitude: float) -> dict:
    try:
        result = await resolve_flood(latitude, longitude)
    except ArcGisQueryError as error:
        raise HTTPException(status_code=502, detail=str(error))
    result["point"] = {"lat": latitude, "lon": longitude}
    return result


@router.get("/point")
async def flood_point(
    lat: float = Query(..., ge=-90, le=90, description="Latitude (WGS84)"),
    lon: float = Query(..., ge=-180, le=180, description="Longitude (WGS84)"),
):
    return await assess_coordinate(lat, lon)


@router.get("/address")
async def flood_address(q: str = Query(..., min_length=3, description="Street address")):
    try:
        location = await geocode_address(q)
    except AddressNotFoundError:
        raise HTTPException(status_code=404, detail=f"No address found matching: {q}")
    except Exception as error:
        raise HTTPException(status_code=502, detail=f"Address lookup failed: {error}")

    result = await assess_coordinate(location["latitude"], location["longitude"])
    result["query"] = q
    result["matched_address"] = location["matched_address"]
    return result


@router.get("/suggest")
async def flood_suggest(q: str = Query("", description="Partial address")):
    """Address autocomplete. Forgiving: short queries and upstream hiccups return []."""
    if len(q.strip()) < MINIMUM_SUGGESTION_LENGTH:
        return []
    try:
        return await get_address_suggestions(q)
    except Exception:
        return []


@router.get("/councils")
async def flood_councils():
    """The councils with a registered flood study, and their data caveats."""
    return {"councils": list_registered_councils()}

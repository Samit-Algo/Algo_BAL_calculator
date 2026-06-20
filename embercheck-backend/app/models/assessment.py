# Pydantic models define the shape of data coming into and out of the API.

from pydantic import BaseModel


class AssessmentRequest(BaseModel):
    """The data the client sends to request a bushfire risk assessment."""

    address: str

    # Optional manual override for the Fire Danger Index (50, 80, or 100).
    # If not given, the FDI is looked up automatically from the property's LGA.
    fire_danger_override: int | None = None

    # Optional manual override for the effective slope (in degrees), for
    # when a real assessor has measured the slope under the vegetation.
    slope_override: float | None = None

    # Optional per-direction vegetation classes from the photo step, keyed by
    # lowercase compass direction, each carrying a class and a 0.0-1.0
    # confidence, e.g. {"north": {"class": "Forest", "confidence": 0.8}}. A
    # confident class can drive that side's BAL (raising is free; lowering is
    # flagged for review); distance and slope ALWAYS come from the map.
    photo_overrides: dict[str, dict] | None = None

    # Optional site boundary the user drew on the map, as a GeoJSON Polygon in
    # WGS84 lon/lat (a {"type": "Polygon", "coordinates": [...]} dict, or a
    # Feature wrapping one). When given, vegetation distances are measured from
    # the nearest BOUNDARY EDGE instead of the geocoded point - the way an
    # assessor measures from the site perimeter. When omitted, the assessment
    # runs from the single geocoded point exactly as before (unchanged).
    site_polygon: dict | None = None


class CapturedPhoto(BaseModel):
    """One photo from the guided four-photo capture, exactly as the frontend
    produces it. Only intended_direction + image are needed for the VLM; the
    rest is captured metadata we store with the training-data record."""

    intended_direction: str
    image: str  # JPEG data URL ("data:image/jpeg;base64,...")
    compass_heading_at_capture: float | None = None
    location: dict | None = None
    captured_at: str | None = None
    direction_source: str | None = None
    quality_check_results: list | None = None


class PhotoAssessmentRequest(BaseModel):
    """The 4-photo capture for a saved case (Phase 1, Step 3a). The case_id is
    required and gates the endpoint to its owner; the address used for the re-run
    comes from the stored case, not this request."""

    # The case this capture sharpens. Required - /assess/photos is now case-bound
    # and login-only (the case's stored address drives the re-run).
    case_id: str

    # Property context still accepted for the stored training-data record; the
    # coordinates are carried through for that record / future coord-only runs.
    address: str | None = None
    latitude: float | None = None
    longitude: float | None = None

    # Same optional overrides the free screen supports, so a sharpened re-run
    # keeps any FDI/slope the user had set.
    fire_danger_override: int | None = None
    slope_override: float | None = None

    photos: list[CapturedPhoto]


class DirectionBaseInput(BaseModel):
    """One side's base (map/photo) inputs, echoed back from an /assess response
    so a recalc can re-band it without re-scanning the map."""

    direction: str
    vegetation_found: bool = False
    distance_m: float | None = None
    effective_slope_degrees: float = 0.0
    slope_direction: str | None = None
    vegetation_class: str | None = None
    pbp_formation: str | None = None
    class_source: str | None = None


class DirectionOverride(BaseModel):
    """A user's manual overrides for one side. Any field left None keeps the
    base value for that field."""

    distance_m: float | None = None
    effective_slope_degrees: float | None = None
    vegetation_class: str | None = None  # AS 3959 class, or "low_risk"


class RecalcRequest(BaseModel):
    """Recompute the BAL from known per-direction inputs plus manual overrides.
    Stateless - no address, no map scan."""

    fire_danger_index: int
    fire_danger_override: int | None = None
    per_direction: list[DirectionBaseInput]
    # Keyed by lowercase direction, e.g. {"north": {"distance_m": 30}}.
    overrides: dict[str, DirectionOverride] = {}


class AssessmentResult(BaseModel):
    """The full result returned after assessing a property's bushfire risk."""

    address: str
    latitude: float
    longitude: float
    lga: str
    fire_danger_index: int
    vegetation_type: str
    svtm_vegetation_class: str
    as3959_vegetation_class: str
    vegetation_confidence: str
    vegetation_manual_review: bool
    nearest_vegetation_distance_m: float | None
    vegetation_found_within_range: bool
    distance_to_vegetation_m: float
    slope_degrees: float
    slope_direction: str
    effective_slope_degrees: float
    bal_rating: str
    pbp_formation: str
    bal_slope_band: str
    requires_manual_review: bool

    # GeoJSON geometry for the map UI (property point, rings, vegetation
    # patches, distance line). See Master Spec section 8. Optional so existing
    # callers and tests are unaffected.
    geometry: dict | None = None

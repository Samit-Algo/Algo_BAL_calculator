# This file keeps all external URLs and shared settings in one place,
# so the rest of the app never hardcodes a URL directly.

import os
from pathlib import Path

from dotenv import load_dotenv

# Load variables from a .env file (if one exists) into the environment.
load_dotenv()


class Settings:
    """Holds configuration values used across the EmberCheck backend."""

    # The Geoscape Predictive Address API - used to turn an address into
    # coordinates. The API key comes from .env (GEOSCAPE_API_KEY=...).
    ADDRESS_API_URL: str = "https://api.psma.com.au/v1/predictive/address"
    GEOSCAPE_API_KEY: str = os.getenv("GEOSCAPE_API_KEY", "")

    # NSW Spatial Services - used to find which LGA (council area) a point falls in.
    LGA_BOUNDARY_API_URL: str = (
        "https://maps.six.nsw.gov.au/arcgis/rest/services/public/"
        "NSW_Administrative_Boundaries/MapServer/1/query"
    )

    # NSW State Vegetation Type Map (SVTM) - used to find the vegetation at a point.
    # Layer 0 = Vegetation Formation, Layer 1 = Vegetation Class, Layer 2 = Plant
    # Community Type (PCT).
    SVTM_VEGETATION_API_URL: str = (
        "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/"
        "SVTM_NSW_Extant_PCT/MapServer"
    )

    # NSW 5m Elevation ImageServer - used to read ground height at a point,
    # so we can work out the slope between the house and nearby vegetation.
    ELEVATION_API_URL: str = (
        "https://maps.six.nsw.gov.au/arcgis/rest/services/public/"
        "NSW_5M_Elevation/ImageServer"
    )

    # How far (in metres) to search around a property for nearby vegetation.
    VEGETATION_SEARCH_RADIUS_METRES: int = 150

    # NSW SVTM Layer 3 ("Plant Community Type with labels") - a vector polygon
    # layer with the same vegClass/vegForm attributes as the raster layers, but
    # with real polygon geometry we can measure distances against.
    SVTM_POLYGON_QUERY_URL: str = (
        "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services/VIS/"
        "SVTM_NSW_Extant_PCT/MapServer/3/query"
    )

    # Groq vision model - reads each capture photo and classifies the dominant
    # vegetation (AS 3959 class) for that direction. Server-side only; the key
    # never reaches the browser. Add GROQ_API_KEY to .env. When the key is
    # missing or the call fails, the photo step falls back to the map value
    # (cant_tell) rather than erroring - see vegetation_vision.py.
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    GROQ_VLM_URL: str = os.getenv(
        "GROQ_VLM_URL", "https://api.groq.com/openai/v1/chat/completions"
    )
    GROQ_VLM_MODEL: str = os.getenv(
        "GROQ_VLM_MODEL", "meta-llama/llama-4-scout-17b-16e-instruct"
    )

    # Where the photo-assessment training-data records are written (photos +
    # VLM reads + final per-side result + metadata). One folder per assessment.
    PHOTO_STORAGE_DIR: Path = Path(
        os.getenv(
            "PHOTO_STORAGE_DIR",
            str(Path(__file__).resolve().parent.parent / "data_store" / "photo_assessments"),
        )
    )

    # Log file for the VLM: every request + the RAW model response + the parsed
    # result, so a wrong classification can be inspected. Set VLM_LOG_PATH to
    # change it; defaults to logs/vlm.log under the backend root.
    VLM_LOG_PATH: Path = Path(
        os.getenv(
            "VLM_LOG_PATH",
            str(Path(__file__).resolve().parent.parent / "logs" / "vlm.log"),
        )
    )


# A single ready-to-use settings instance, imported elsewhere in the app.
settings = Settings()

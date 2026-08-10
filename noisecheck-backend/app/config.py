# NoiseCheck API configuration. Standalone — does not import from EmberCheck or FloodCheck.
# Values load from .env (see .env.example); safe defaults are baked in.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Geocoding ---
    # Geoscape is used when a key is present (same provider as FloodCheck). Without
    # one we fall back to Nominatim so the service runs with no credentials —
    # acceptable for evaluation, not for production traffic.
    GEOSCAPE_API_KEY: str = ""
    GEOSCAPE_ADDRESS_URL: str = "https://api.psma.com.au/v1/predictive/address"
    NOMINATIM_URL: str = "https://nominatim.openstreetmap.org/search"
    # Nominatim's usage policy requires a contactable User-Agent.
    NOMINATIM_USER_AGENT: str = "NoiseCheck/0.1 (samit.algoorange@gmail.com)"

    # --- Aircraft noise: NSW ePlanning "Airport Noise" EPI layer (CC BY) ---
    EPLANNING_AIRPORT_NOISE_URL: str = (
        "https://mapprod3.environment.nsw.gov.au/arcgis/rest/services"
        "/ePlanning/Planning_Portal_Protection/MapServer/235/query"
    )

    # --- Road noise: OpenStreetMap geometry via Overpass (ODbL) ---
    OVERPASS_URL: str = "https://overpass-api.de/api/interpreter"
    ROAD_SEARCH_RADIUS_METRES: int = 500
    # The shared Overpass endpoint sheds load intermittently; see the road provider.
    OVERPASS_ATTEMPTS: int = 3
    OVERPASS_RETRY_DELAY_SECONDS: float = 1.5

    # --- Air quality: NSW air quality monitoring network (CC BY) ---
    AIR_QUALITY_BASE_URL: str = "https://data.airquality.nsw.gov.au/api/Data"
    # Beyond this, the nearest station stops being a fair proxy for the address.
    AIR_QUALITY_MAX_STATION_DISTANCE_KM: float = 25.0

    UPSTREAM_TIMEOUT_SECONDS: int = 30

    # --- CORS: the NoiseCheck frontend dev/prod origins allowed to call this API ---
    CORS_ORIGINS: list[str] = [
        "http://localhost:5175",
        "http://127.0.0.1:5175",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://noise.samitweb.xyz",
    ]
    # Cloudflare Pages deployments (production + previews), same pattern as FloodCheck.
    CORS_ORIGIN_REGEX: str = r"https://.*\.pages\.dev"


settings = Settings()

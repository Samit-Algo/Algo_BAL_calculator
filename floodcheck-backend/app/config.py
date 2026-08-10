# FloodCheck API configuration. Standalone — does not import from EmberCheck.
# Values load from .env (see .env.example); safe defaults are baked in.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # --- Geoscape Predictive Address API (address -> coordinates) ---
    # The API key comes from .env (GEOSCAPE_API_KEY=...).
    ADDRESS_API_URL: str = "https://api.psma.com.au/v1/predictive/address"
    GEOSCAPE_API_KEY: str = ""

    # Elevation models are chosen per coordinate, so their URLs live with their
    # coverage areas in app/services/elevation.py rather than in configuration.

    # --- CORS: the FloodCheck frontend dev/prod origins allowed to call this API ---
    CORS_ORIGINS: list[str] = [
        "http://localhost:5174",
        "http://127.0.0.1:5174",
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://flood.samitweb.xyz",
    ]
    # Cloudflare Pages deployments (production + previews), same pattern as EmberCheck.
    CORS_ORIGIN_REGEX: str = r"https://.*\.pages\.dev"


settings = Settings()

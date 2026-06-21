# Phase 1 settings (persistence + auth foundation).
#
# Kept separate from the existing app/config.py (external API URLs for the
# assessment pipeline) on purpose: this module holds only the database/auth
# configuration the consumer-accounts feature plugs into, loaded from the
# environment via pydantic-settings. Nothing here touches the assessment flow.

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Database + auth configuration, loaded from environment variables / .env.

    Secrets (the Atlas URI, the JWT signing secret) are NEVER hardcoded - they
    come from the environment. See .env.example for the keys to set.
    """

    # MongoDB Atlas. MONGODB_URI is the full SRV connection string (with the
    # username/password). MONGODB_DB_NAME selects the database within it.
    MONGODB_URI: str = ""
    MONGODB_DB_NAME: str = "embercheck"

    # Secret used to sign auth tokens. Wired into fastapi-users in Step 2; kept
    # here now so the config surface is settled before the auth code lands.
    AUTH_SECRET: str = ""

    # Google OAuth 2.0 client ID used to verify frontend Google ID tokens. This
    # must match VITE_GOOGLE_CLIENT_ID in the frontend.
    GOOGLE_CLIENT_ID: str = ""

    # Token lifetimes (seconds). Access token short-lived; refresh token long.
    ACCESS_TOKEN_LIFETIME_SECONDS: int = 3600  # 1 hour
    REFRESH_TOKEN_LIFETIME_SECONDS: int = 2592000  # 30 days

    # Read from .env; ignore unrelated keys (GEOSCAPE_API_KEY, GROQ_API_KEY,
    # ...) that the assessment pipeline's own config already consumes.
    model_config = SettingsConfigDict(
        env_file=".env", env_file_encoding="utf-8", extra="ignore"
    )


# A single ready-to-use settings instance, imported elsewhere in the app.
settings = Settings()

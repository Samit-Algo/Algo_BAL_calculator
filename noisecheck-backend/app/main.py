# NoiseCheck API — standalone FastAPI service (independent of EmberCheck and FloodCheck).

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.noise.routes import router as noise_router

logger = logging.getLogger("noisecheck")

app = FastAPI(title="NoiseCheck API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(noise_router)


@app.get("/health")
def health():
    return {
        "status": "ok",
        "service": "noisecheck",
        "geocoder": "geoscape" if settings.GEOSCAPE_API_KEY else "nominatim",
    }

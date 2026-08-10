# FloodCheck API — standalone FastAPI service (independent of EmberCheck).

import logging

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.flood.routes import router as flood_router

logger = logging.getLogger("floodcheck")

app = FastAPI(title="FloodCheck API", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_origin_regex=settings.CORS_ORIGIN_REGEX,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(flood_router)


@app.get("/health")
def health():
    return {"status": "ok", "service": "floodcheck"}

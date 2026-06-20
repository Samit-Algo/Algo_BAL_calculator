# Reads a capture photo with a Groq vision model and classifies the dominant
# vegetation in it into an AS 3959 class, so the photo can sharpen that side's
# BAL. This is the only place the VLM is called - it stays server-side, so the
# API key never reaches the browser.
#
# Resilience is the whole point: a missing key, a network error, a blocked or
# unreadable photo must NEVER crash the assessment. Any failure returns a
# "cant_tell" read, which the pipeline treats as "keep the map's value".

import asyncio
import json
import logging

import httpx

from app.config import settings

# How long to wait on one VLM call before giving up (and falling back to map).
REQUEST_TIMEOUT_SECONDS = 30


def _build_logger() -> logging.Logger:
    """A logger that writes the VLM request + raw response + parsed result to a
    file, so wrong classifications can be inspected. Configured once."""

    logger = logging.getLogger("embercheck.vlm")
    if logger.handlers:  # already configured (avoid duplicate handlers on reload)
        return logger
    logger.setLevel(logging.INFO)
    logger.propagate = False
    try:
        settings.VLM_LOG_PATH.parent.mkdir(parents=True, exist_ok=True)
        handler = logging.FileHandler(settings.VLM_LOG_PATH, encoding="utf-8")
    except OSError:
        # If the file can't be opened, fall back to console so logging never
        # breaks the request.
        handler = logging.StreamHandler()
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    logger.addHandler(handler)
    return logger


_log = _build_logger()

# The classes the VLM may return. These line up exactly with the photo ->
# PBP-formation mapper (see photo_class_mapper.py); "cant_tell" / "low_risk"
# are the two non-AS3959 extras. Anything else is normalised to "cant_tell".
ALLOWED_CLASSES = {
    "Forest",
    "Woodland",
    "Shrubland",
    "Scrub",
    "Mallee/Heath",
    "Rainforest",
    "Grassland",
    "low_risk",
    "cant_tell",
}

# A read we return whenever the VLM can't be used or trusted. confidence 0.0 +
# class "cant_tell" makes the pipeline keep the conservative map value.
def _fallback(direction: str, reason: str) -> dict:
    return {
        "direction": direction,
        "class": "cant_tell",
        "confidence": 0.0,
        "condition": None,
        "limits": reason,
    }


_SYSTEM_PROMPT = (
    "You are a bushfire vegetation classifier for NSW Australia, applying the "
    "AS 3959 vegetation classes. You are shown ONE photo taken from a property "
    "looking in one compass direction. Identify the DOMINANT fire-relevant "
    "vegetation visible, judging the WHOLE stand - do not downgrade a class just "
    "because of foreground gaps, a fence, or a partly obstructed view.\n\n"
    "Class definitions (choose the single best fit):\n"
    "- Forest: trees taller than ~10 m with a CLOSED or near-closed canopy - "
    "crowns touch or nearly touch, little sky shows THROUGH the canopy. Dense "
    "continuous tall trees (wet/dry sclerophyll/eucalypt forest) are Forest even "
    "if the trunks are spaced and you can see between them at ground level.\n"
    "- Woodland: trees taller than ~10 m but an OPEN, sparse canopy - distinctly "
    "separated crowns with lots of sky between them, usually grass underneath.\n"
    "- Shrubland: dominated by shrubs under ~2 m, few or no trees.\n"
    "- Scrub: dense shrubs / small trees ~1-3 m, thick and continuous.\n"
    "- Mallee/Heath: multi-stemmed mallee eucalypts, or low heath shrubs under ~2 m.\n"
    "- Rainforest: closed, dense, broad-leaved moist canopy, little understorey.\n"
    "- Grassland: grasses dominate, no significant trees or shrubs.\n"
    "- low_risk: managed lawn, crop, bare ground, water, or built surfaces - no real fuel.\n"
    "- cant_tell: too dark / blurry / obstructed, or no useful vegetation.\n\n"
    "Forest vs Woodland is the key call: if the tree crowns form a mostly "
    "continuous canopy, choose Forest; only choose Woodland when crowns are "
    "clearly separated with open sky between them.\n\n"
    "Respond with ONLY a JSON object, no prose, with these keys IN THIS ORDER:\n"
    '  "reasoning": one short sentence describing the canopy/structure you see '
    "and why it fits the class (decide AFTER looking, not before).\n"
    '  "class": exactly one of "Forest", "Woodland", "Shrubland", "Scrub", '
    '"Mallee/Heath", "Rainforest", "Grassland", "low_risk", "cant_tell".\n'
    '  "confidence": a number 0.0-1.0.\n'
    '  "condition": a short phrase on fuel state (e.g. "dry, dense understorey"), or null.\n'
    '  "limits": a short note on anything that limited the read, or null.'
)


async def read_vegetation(image_data_url: str, direction: str) -> dict:
    """
    Classify the vegetation in one capture photo with the Groq vision model.

    Returns {direction, class, confidence, condition, limits}. On ANY problem
    (no API key, network/HTTP error, unparseable or out-of-range answer) returns
    a "cant_tell" fallback so the caller can fall back to the map value.
    """

    _log.info(
        "REQUEST direction=%s model=%s image_bytes=%d key=%s",
        direction,
        settings.GROQ_VLM_MODEL,
        len(image_data_url or ""),
        "set" if settings.GROQ_API_KEY else "MISSING",
    )

    if not settings.GROQ_API_KEY:
        _log.warning("FALLBACK direction=%s reason=no-api-key", direction)
        return _fallback(direction, "No vision API key configured - used map value")

    if not image_data_url or not image_data_url.startswith("data:image"):
        _log.warning("FALLBACK direction=%s reason=bad-image", direction)
        return _fallback(direction, "Photo missing or not a valid image")

    payload = {
        "model": settings.GROQ_VLM_MODEL,
        "temperature": 0,
        "max_tokens": 300,
        "response_format": {"type": "json_object"},
        "messages": [
            {"role": "system", "content": _SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "text",
                        "text": (
                            f"This photo looks {direction} from the property. "
                            "Classify the dominant vegetation."
                        ),
                    },
                    {"type": "image_url", "image_url": {"url": image_data_url}},
                ],
            },
        ],
    }

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.post(
                settings.GROQ_VLM_URL,
                headers={"Authorization": f"Bearer {settings.GROQ_API_KEY}"},
                json=payload,
            )
        if response.status_code != 200:
            _log.error(
                "HTTP %s direction=%s body=%s",
                response.status_code,
                direction,
                response.text[:1000],
            )
            return _fallback(direction, f"Vision service returned {response.status_code}")

        content = response.json()["choices"][0]["message"]["content"]
        # The exact string the model returned - this is what to inspect when a
        # classification looks wrong.
        _log.info("RAW direction=%s content=%s", direction, content)
        parsed = json.loads(content)
    except (httpx.RequestError, KeyError, ValueError, IndexError) as error:
        _log.exception("ERROR direction=%s (%s)", direction, type(error).__name__)
        return _fallback(direction, f"Vision read failed ({type(error).__name__})")

    result = _normalise(parsed, direction)
    _log.info(
        "PARSED direction=%s class=%s confidence=%s condition=%s limits=%s",
        direction,
        result["class"],
        result["confidence"],
        result["condition"],
        result["limits"],
    )
    return result


def _normalise(parsed: dict, direction: str) -> dict:
    """Coerce a raw VLM answer into a safe, in-range read."""

    veg_class = parsed.get("class")
    if veg_class not in ALLOWED_CLASSES:
        # Unknown label -> don't risk a wrong override; keep the map value.
        _log.warning(
            "FALLBACK direction=%s reason=unrecognised-class class=%r", direction, veg_class
        )
        return _fallback(direction, f"Unrecognised class '{veg_class}' - used map value")

    try:
        confidence = float(parsed.get("confidence", 0.0))
    except (TypeError, ValueError):
        confidence = 0.0
    confidence = max(0.0, min(1.0, confidence))

    return {
        "direction": direction,
        "class": veg_class,
        "confidence": confidence,
        "condition": parsed.get("condition"),
        "limits": parsed.get("limits"),
    }


async def read_photos(photos: list[dict]) -> list[dict]:
    """
    Run every capture photo through the VLM concurrently and return one read per
    photo, each tagged with the photo's intended_direction. Order matches the
    input. Individual failures degrade to "cant_tell" - the batch never raises.
    """

    async def read_one(photo: dict) -> dict:
        direction = (photo.get("intended_direction") or "").lower()
        return await read_vegetation(photo.get("image", ""), direction)

    return await asyncio.gather(*(read_one(photo) for photo in photos))


def build_photo_overrides(reads: list[dict]) -> dict:
    """
    Turn VLM reads into the photo_overrides the per-direction pipeline expects:
    { direction: { "class": ..., "confidence": ... } }. "cant_tell" reads are
    dropped so the pipeline keeps the map value for that side.
    """

    overrides = {}
    for read in reads:
        if read["class"] == "cant_tell":
            continue
        overrides[read["direction"]] = {
            "class": read["class"],
            "confidence": read["confidence"],
        }
    return overrides

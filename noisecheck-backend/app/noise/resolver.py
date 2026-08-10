"""Combine the three reads into one assessment for a coordinate.

The confidence grades mirror FloodCheck's cascade so the two products read the same
way:

    A — an authoritative published dataset covers this exact point
    B — a real measurement near the point, used as a proxy
    C — modelled or indicative only

One deliberate difference from FloodCheck and EmberCheck: the headline grade here is
governed by the *best* available read, not the worst. A bushfire or flood rating is a
safety call, where the worst read must govern. Environmental amenity is a completeness
question — road noise being modelled does not make a published aircraft contour less
true. Reads that could not answer are reported separately in `unanswered` rather than
being folded into a single score, so a gap is never presented as a low result.
"""

import asyncio

from app.noise.providers.air_quality import assess_air_quality
from app.noise.providers.aircraft import assess_aircraft_noise
from app.noise.providers.road import assess_road_noise

CONFIDENCE_RANK = {"A": 3, "B": 2, "C": 1}

CONFIDENCE_NOTES = {
    "A": "At least one read comes from an authoritative published dataset.",
    "B": "Best available read is a nearby measurement used as a proxy.",
    "C": "Every available read is modelled or indicative. Screening view only.",
}

SECTION_LABELS = (
    ("Aircraft noise", "aircraft"),
    ("Road noise", "road"),
    ("Air quality", "air_quality"),
)

DISCLAIMER = (
    "NSW publishes no per-address noise dataset. Aircraft figures are planning "
    "contours in ANEF units (not decibels), road figures are modelled, and air "
    "quality is measured at the nearest station rather than at the address. "
    "Not an acoustic or environmental assessment."
)


def _failed_section(label: str, error: BaseException) -> dict:
    """
    A provider that raised still has to return a shaped section, not vanish.

    httpx timeout exceptions stringify to an empty string, so falling back to the
    class name is what stops the UI showing "check failed" with a blank reason.
    """
    reason = str(error).strip() or type(error).__name__
    return {
        "status": "error",
        "confidence": None,
        "headline": f"{label} check failed",
        "caveat": f"Upstream error: {reason}. This is a service fault, not a finding — "
        "it does not mean the address is unaffected.",
        "geojson": {"type": "FeatureCollection", "features": []},
        "provenance": None,
        "sources": [],
    }


def _overall_confidence(sections: list[dict]) -> tuple[str | None, str]:
    grades = [s["confidence"] for s in sections if s.get("confidence")]
    if not grades:
        return None, "No source could answer for this address."
    best = max(grades, key=lambda grade: CONFIDENCE_RANK[grade])
    return best, CONFIDENCE_NOTES[best]


async def resolve_noise(latitude: float, longitude: float) -> dict:
    """Run all three reads concurrently and assemble one payload."""
    results = await asyncio.gather(
        assess_aircraft_noise(latitude, longitude),
        assess_road_noise(latitude, longitude),
        assess_air_quality(latitude, longitude),
        return_exceptions=True,
    )

    sections = {}
    for (label, key), result in zip(SECTION_LABELS, results):
        sections[key] = (
            _failed_section(label, result) if isinstance(result, BaseException) else result
        )

    confidence, confidence_note = _overall_confidence(list(sections.values()))
    unanswered = [
        label for label, key in SECTION_LABELS if not sections[key].get("confidence")
    ]

    return {
        "point": {"lat": latitude, "lon": longitude},
        "confidence": confidence,
        "confidence_note": confidence_note,
        "unanswered": unanswered,
        "noise": {"aircraft": sections["aircraft"], "road": sections["road"]},
        "air_quality": sections["air_quality"],
        "disclaimer": DISCLAIMER,
    }

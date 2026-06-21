# Classifies sector photos via the existing VLM and combines proposals per side
# by worst-case-governs. Populates sector_evidence fields but does NOT touch
# the BAL — that is Step 6.

import base64
from pathlib import Path

from app.config import settings
from app.models.case import AiVegetationProposal, SectorEvidence
from app.services.vegetation_vision import read_vegetation

CONFIDENCE_THRESHOLD = 0.7

# Vegetation class severity: higher = more hazardous. Forest is worst-case,
# Excluded is least. Used by worst-case-governs combination. Classes not in
# this dict are treated as maximally hazardous (Forest-equivalent).
CLASS_SEVERITY = {
    "Excluded": 0,
    "Grassland": 1,
    "Shrubland": 2,
    "Mallee/Mulga": 3,
    "Mallee/Heath": 3,
    "Scrub": 4,
    "Woodland": 5,
    "Rainforest": 6,
    "Forest": 7,
    "Unknown": 8,
}


async def classify_sector_photo(file_path: str, compass_side: str) -> AiVegetationProposal:
    """Run one stored sector photo through the VLM and return a proposal."""
    full = Path(settings.PHOTO_STORAGE_DIR).resolve() / file_path
    if not full.is_file():
        return AiVegetationProposal(
            vegetation_class="Unknown", exclusion=False,
            confidence=0.0, model_version=settings.GROQ_VLM_MODEL,
        )

    data = full.read_bytes()
    ext = full.suffix.lower()
    mime = "image/png" if ext == ".png" else "image/jpeg"
    data_url = f"data:{mime};base64,{base64.b64encode(data).decode()}"

    vlm_read = await read_vegetation(data_url, compass_side.lower())
    return _vlm_read_to_proposal(vlm_read)


def _vlm_read_to_proposal(vlm_read: dict) -> AiVegetationProposal:
    """Map the existing VLM read dict to an AiVegetationProposal."""
    raw_class = vlm_read.get("class", "cant_tell")
    confidence = float(vlm_read.get("confidence", 0.0))

    if raw_class in ("cant_tell", "can't tell"):
        veg_class = "Unknown"
        exclusion = False
    elif raw_class == "low_risk":
        veg_class = "Excluded"
        exclusion = True
    else:
        veg_class = raw_class
        exclusion = False

    return AiVegetationProposal(
        vegetation_class=veg_class,
        exclusion=exclusion,
        confidence=max(0.0, min(1.0, confidence)),
        model_version=settings.GROQ_VLM_MODEL,
        reasoning=vlm_read.get("reasoning"),
    )


def combine_proposals(
    proposals: list[AiVegetationProposal],
    gis_draft_classification: str | None = None,
) -> tuple[str | None, float | None, list[str], str | None]:
    """Combine per-photo proposals for one side by worst-case-governs.

    Returns (combined_classification, combined_confidence, review_flags,
    combined_reasoning) - the reasoning is whichever proposal's read actually
    drove the combined classification, so the UI can show why, not just what.
    """
    if not proposals:
        return None, None, [], None

    review_flags: list[str] = []

    has_uncertain = any(
        p.confidence < CONFIDENCE_THRESHOLD or p.vegetation_class == "Unknown"
        for p in proposals
    )
    if has_uncertain:
        review_flags.append("uncertain_vegetation")
        least_confident = min(proposals, key=lambda p: p.confidence)
        return "Forest", least_confident.confidence, review_flags, least_confident.reasoning

    worst = max(proposals, key=lambda p: CLASS_SEVERITY.get(p.vegetation_class, 8))
    combined_class = worst.vegetation_class
    combined_conf = min(p.confidence for p in proposals)

    if (
        gis_draft_classification
        and combined_class != gis_draft_classification
        and CLASS_SEVERITY.get(combined_class, 8) < CLASS_SEVERITY.get(gis_draft_classification, 8)
    ):
        review_flags.append("photo_lower_than_draft")

    return combined_class, combined_conf, review_flags, worst.reasoning


async def classify_and_combine(side_ev: SectorEvidence) -> None:
    """Classify all photos on a SectorEvidence and recompute the combined
    fields. Mutates side_ev in place. Idempotent: re-running reclassifies
    every photo and recomputes combined from scratch."""
    proposals: list[AiVegetationProposal] = []

    for photo in side_ev.photos:
        proposal = await classify_sector_photo(photo.file_path, side_ev.compass_side)
        photo.ai_proposal = proposal
        proposals.append(proposal)

    combined_class, combined_conf, flags, reasoning = combine_proposals(
        proposals, side_ev.gis_draft_classification,
    )
    side_ev.combined_classification = combined_class
    side_ev.combined_confidence = combined_conf
    side_ev.combined_reasoning = reasoning
    side_ev.review_flags = flags

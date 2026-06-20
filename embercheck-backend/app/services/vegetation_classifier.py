# This service converts an SVTM vegetation class (Layer 1) into an AS 3959
# vegetation classification, using the SVTM -> AS 3959 crosswalk table.

from app.data.crosswalk_loader import CROSSWALK_BY_SVTM_CLASS

# Runtime rule: if the SVTM class is unknown, or the crosswalk has no AS 3959
# class for it, fall back to the worst case ("Forest") and flag for review.
FALLBACK_AS3959_CLASS = "Forest"
FALLBACK_CONFIDENCE = "Unknown"


def classify_vegetation(vegetation_class: str) -> dict:
    """
    Look up the AS 3959 vegetation classification for an SVTM vegetation class.

    Returns a dict with:
        - as3959_class (str)
        - confidence (str)
        - manual_review (bool)
        - matched (bool): True if a known AS 3959 class was found in the crosswalk.
    """

    row = CROSSWALK_BY_SVTM_CLASS.get(vegetation_class)

    if row is not None and row["as3959_class"] is not None:
        return {
            "as3959_class": row["as3959_class"],
            "confidence": row["confidence"],
            "manual_review": row["manual_review"],
            "matched": True,
        }

    # Unknown class, or a known class with no AS 3959 mapping yet.
    return {
        "as3959_class": FALLBACK_AS3959_CLASS,
        "confidence": FALLBACK_CONFIDENCE,
        "manual_review": True,
        "matched": False,
    }

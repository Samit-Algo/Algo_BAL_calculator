# Bridges an AS 3959 vegetation class supplied by the PHOTO step to the exact
# PBP 2019 formation key used as a column in the BAL distance tables. This is
# what lets a confident photo class actually drive the BAL rating, instead of
# only relabelling the map's class.
#
# The formation strings here MUST match the keys in pbp_bal_tables.json exactly.
# Choices follow the same conventions as the vegForm bridge
# (vegform_to_pbp_formation.json): heath defaults to the conservative "Tall
# Heath"; shrubland maps to the single "Arid-Shrublands" formation.

from app.data.bal_tables_loader import DEFAULT_PBP_FORMATION

# The seven AS 3959 classes plus the two extras (low_risk, cant_tell). Each
# entry's manual_review flags a structural approximation that a single class
# label can't fully resolve (e.g. Scrub / Mallee-Heath both collapse onto the
# closest dense-shrub formation, Tall Heath; Tall vs Short heath is unknown).
_PHOTO_CLASS_TO_PBP = {
    "forest": {"pbp_formation": DEFAULT_PBP_FORMATION, "manual_review": False},
    "woodland": {
        "pbp_formation": "Grassy and Semi-Arid Woodland (including Mallee)",
        "manual_review": False,
    },
    "shrubland": {
        "pbp_formation": "Arid-Shrublands (acacia and chenopod)",
        "manual_review": False,
    },
    # No PBP "Scrub" formation exists; Tall Heath is the closest dense-shrub row.
    "scrub": {"pbp_formation": "Tall Heath", "manual_review": True},
    # Mallee/heath: heath -> Tall Heath (conservative, matches the vegForm bridge).
    "mallee/heath": {"pbp_formation": "Tall Heath", "manual_review": True},
    "rainforest": {"pbp_formation": "Rainforest", "manual_review": False},
    "grassland": {"pbp_formation": "Grassland", "manual_review": False},
    # low_risk -> Excluded forces BAL-LOW for that side (handled in calculate_bal).
    "low_risk": {"pbp_formation": "Excluded", "manual_review": False},
}

# Accepted spellings that mean "don't trust the photo - keep the map's value".
_CANT_TELL_KEYS = {"cant_tell", "can't tell", "cant tell", "unknown", "unsure"}

# Aliases for classes a user might phrase differently.
_ALIASES = {
    "mallee": "mallee/heath",
    "heath": "mallee/heath",
    "mallee-heath": "mallee/heath",
    "mallee_heath": "mallee/heath",
    "low risk": "low_risk",
    "low-risk": "low_risk",
}


def map_photo_class_to_pbp(photo_class: str | None) -> dict:
    """
    Resolve a photo AS 3959 class to a PBP formation for the BAL tables.

    Returns a dict with:
        - override (bool): whether the photo should drive the BAL at all. False
          for cant_tell / missing classes (the caller keeps the map's value).
        - pbp_formation (str | None): the exact PBP formation key, or "Excluded"
          (forces BAL-LOW), or None when override is False.
        - manual_review (bool): True when the mapping is a structural
          approximation (Scrub, Mallee/Heath) or an unrecognised-class fail-safe.
        - recognized (bool): True if the class matched a known mapping.
    """

    if not photo_class:
        return {"override": False, "pbp_formation": None, "manual_review": False, "recognized": False}

    key = photo_class.strip().lower()

    if key in _CANT_TELL_KEYS:
        # Explicit "can't tell" - never override; the conservative map value wins.
        return {"override": False, "pbp_formation": None, "manual_review": False, "recognized": True}

    key = _ALIASES.get(key, key)
    entry = _PHOTO_CLASS_TO_PBP.get(key)

    if entry is None:
        # Unrecognised class with no clean PBP row -> fail safe to worst-case
        # Forest and flag for review (per the spec's conservative default).
        return {
            "override": True,
            "pbp_formation": DEFAULT_PBP_FORMATION,
            "manual_review": True,
            "recognized": False,
        }

    return {
        "override": True,
        "pbp_formation": entry["pbp_formation"],
        "manual_review": entry["manual_review"],
        "recognized": True,
    }

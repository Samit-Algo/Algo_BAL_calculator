# This service looks up the Fire Danger Index (FDI) for an LGA (council area).
# FDI is a fixed regulatory value set by NSW RFS - either 80 or 100, depending
# on which Fire Weather District the LGA sits in.

import json
from pathlib import Path

# The set of FDI values that are allowed when a caller manually overrides the result.
VALID_FDI_VALUES = {50, 80, 100}

# Load the FDI lookup data once, when this module is first imported.
_FDI_DATA_PATH = Path(__file__).resolve().parent.parent / "data" / "fdi_nsw.json"

with open(_FDI_DATA_PATH, encoding="utf-8") as fdi_file:
    _fdi_data = json.load(fdi_file)

_FDI_BY_LGA = _fdi_data["fdi"]
_DEFAULT_FDI = _fdi_data["_meta"]["default_if_missing"]


def normalise_lga_name(name: str) -> str:
    """
    Normalise an LGA name to match the keys used in fdi_nsw.json:
    uppercase, no "COUNCIL" or "CITY OF", hyphens as spaces, single spaces, trimmed.
    """
    normalised = name.upper()
    normalised = normalised.replace("CITY OF", "")
    normalised = normalised.replace("COUNCIL", "")
    normalised = normalised.replace("-", " ")

    # Collapse any repeated spaces left behind by the replacements above.
    normalised = " ".join(normalised.split())

    return normalised


def get_fire_danger_index(
    lga_name: str | None = None,
    manual_override: int | None = None,
) -> int:
    """
    Return the Fire Danger Index (FDI) to use for an assessment.

    - If manual_override is given, it must be 50, 80, or 100 and is returned as-is.
    - Otherwise, the LGA name is normalised and looked up in the FDI table.
    - If the LGA isn't known (or no name was given), the default FDI is returned.
      The default is 100 - the worst case, which is the safe choice for screening.
    """

    if manual_override is not None:
        if manual_override not in VALID_FDI_VALUES:
            raise ValueError(
                f"Invalid fire_danger_override: {manual_override}. "
                f"Must be one of {sorted(VALID_FDI_VALUES)}."
            )
        return manual_override

    if lga_name is None:
        return _DEFAULT_FDI

    return _FDI_BY_LGA.get(normalise_lga_name(lga_name), _DEFAULT_FDI)

# Loads the SVTM -> AS 3959 vegetation crosswalk once, and provides a fast
# lookup from SVTM vegetation class -> crosswalk row.

import json
from pathlib import Path

_CROSSWALK_DATA_PATH = Path(__file__).resolve().parent / "svtm_as3959_crosswalk.json"

with open(_CROSSWALK_DATA_PATH, encoding="utf-8") as crosswalk_file:
    _crosswalk_data = json.load(crosswalk_file)

# A dict of {svtm_class: row} for quick lookups by vegetation class.
CROSSWALK_BY_SVTM_CLASS = {
    row["svtm_class"]: row for row in _crosswalk_data["crosswalk"]
}

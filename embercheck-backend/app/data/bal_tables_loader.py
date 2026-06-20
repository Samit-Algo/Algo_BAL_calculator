# Loads the two BAL data files once, so the BAL calculator and the
# vegForm -> PBP formation mapper don't re-read them on every request.

import json
from pathlib import Path

_DATA_DIR = Path(__file__).resolve().parent

_BAL_TABLES_PATH = _DATA_DIR / "pbp_bal_tables.json"
_VEGFORM_BRIDGE_PATH = _DATA_DIR / "vegform_to_pbp_formation.json"

with open(_BAL_TABLES_PATH, encoding="utf-8") as bal_tables_file:
    BAL_TABLES_DATA = json.load(bal_tables_file)

with open(_VEGFORM_BRIDGE_PATH, encoding="utf-8") as vegform_bridge_file:
    VEGFORM_BRIDGE_DATA = json.load(vegform_bridge_file)

# The distance tables themselves: tables[fdi][slope_band][pbp_formation] -> thresholds.
BAL_TABLES = BAL_TABLES_DATA["tables"]

# The vegForm -> PBP formation rules, sorted by priority so the first
# matching rule (lowest priority number) wins.
VEGFORM_BRIDGE_RULES = sorted(VEGFORM_BRIDGE_DATA["rules"], key=lambda rule: rule["priority"])

# The "Forest (...)" key used as the worst-case fallback formation.
DEFAULT_PBP_FORMATION = VEGFORM_BRIDGE_DATA["_meta"]["default_if_no_match"]

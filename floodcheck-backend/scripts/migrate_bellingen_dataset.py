"""Move Bellingen's existing map data into the shared per-council layout.

The Bellingen dataset was generated before councils were a concept, so it sits at
the root of the frontend's public folder and names its flood events with keys of
its own. This rewrites it in place under councils/bellingen/ using the canonical
FloodValueKeys vocabulary, so every council's data looks the same to the map.

Rebuilding from source would mean another OpenStreetMap and elevation run for
11,613 buildings; the geometry and levels are unchanged, so a rename is enough.

    python -m scripts.migrate_bellingen_dataset
"""

import json
import shutil
from pathlib import Path

from app.flood.flood_values import FloodValueKeys

FRONTEND_PUBLIC_DIRECTORY = Path(
    r"C:\Users\manoj\Desktop\EmberCheck\floodcheck-frontend\public"
)
COUNCIL_ID = "bellingen"

# The original precompute keys, and their canonical equivalents.
LEGACY_KEY_TO_CANONICAL = {
    "yr5_ari": FloodValueKeys.LEVEL_5_YEAR_ARI,
    "aep5_20yr": FloodValueKeys.LEVEL_5_PERCENT_AEP,
    "aep1_100yr": FloodValueKeys.LEVEL_1_PERCENT_AEP,
    "fpa": FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA,
    "pmf": FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD,
}

SOURCE_FILES = {
    "bellingen_buildings.geojson": "buildings.geojson",
    "bellingen_boundary.geojson": "boundary.geojson",
    "bellingen_flood_1aep.geojson": "flood_extent.geojson",
}

BUILDING_FLOODED_DEPTH_M = 0.2


def rename_level_keys(levels: dict) -> dict:
    return {LEGACY_KEY_TO_CANONICAL.get(key, key): value for key, value in levels.items()}


def classify_status(design_level, ground_level) -> str:
    if design_level is None:
        return "not"
    if ground_level is None:
        return "parcel"
    return "building" if design_level - ground_level > BUILDING_FLOODED_DEPTH_M else "parcel"


def count_by_status(features: list[dict], level_key: str) -> dict:
    counts = {"not": 0, "parcel": 0, "building": 0}
    for feature in features:
        properties = feature["properties"]
        counts[classify_status(properties.get("levels", {}).get(level_key),
                               properties.get("ground_m"))] += 1
    return counts


def migrate_buildings(source: Path, destination: Path) -> list[dict]:
    data = json.loads(source.read_text(encoding="utf-8"))
    for feature in data["features"]:
        properties = feature["properties"]
        properties["levels"] = rename_level_keys(properties.get("levels") or {})
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    return data["features"]


def main() -> None:
    output_directory = FRONTEND_PUBLIC_DIRECTORY / "councils" / COUNCIL_ID
    output_directory.mkdir(parents=True, exist_ok=True)

    features: list[dict] = []
    for source_name, destination_name in SOURCE_FILES.items():
        source = FRONTEND_PUBLIC_DIRECTORY / source_name
        destination = output_directory / destination_name
        if not source.exists():
            print(f"  missing, skipped: {source_name}")
            continue
        if destination_name == "buildings.geojson":
            features = migrate_buildings(source, destination)
            print(f"  {source_name} -> {destination_name} "
                  f"({len(features)} features, keys renamed)")
        else:
            shutil.copyfile(source, destination)
            print(f"  {source_name} -> {destination_name} (copied)")

    index = {
        "council_id": COUNCIL_ID,
        "delivery_mode": "single",
        "feature_count": len(features),
        "counts_by_event": {
            key: count_by_status(features, key)
            for key in LEGACY_KEY_TO_CANONICAL.values()
        },
    }
    (output_directory / "index.json").write_text(
        json.dumps(index, separators=(",", ":")), encoding="utf-8")
    print("  wrote index.json:", index["counts_by_event"][FloodValueKeys.LEVEL_1_PERCENT_AEP])


if __name__ == "__main__":
    main()

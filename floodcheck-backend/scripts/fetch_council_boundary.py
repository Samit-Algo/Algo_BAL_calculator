"""Download a council's local government area outline for the map.

The outline is the dashed border that shows how far a council's coverage
extends. It is written next to that council's other map data as a static file,
so the map never calls a boundary service at runtime.

    python -m scripts.fetch_council_boundary --council hinchinbrook
    python -m scripts.fetch_council_boundary --council gold-coast

Bellingen's outline came from the NSW administrative boundaries and already
exists; the Queensland councils are served here.
"""

import argparse
import json
from dataclasses import dataclass
from pathlib import Path

from scripts.precompute_council import (
    FRONTEND_PUBLIC_DIRECTORY,
    create_client,
    simplify_geometry,
)

# Queensland's administrative boundaries framework, local government area layer.
QUEENSLAND_LGA_LAYER = (
    "https://spatial-gis.information.qld.gov.au/arcgis/rest/services/"
    "Boundaries/AdminBoundariesFramework/FeatureServer/11"
)

# NSW Spatial Services administrative boundaries, local government area layer.
NEW_SOUTH_WALES_LGA_LAYER = (
    "https://portal.spatial.nsw.gov.au/server/rest/services/"
    "NSW_Administrative_Boundaries_Theme/FeatureServer/17"
)

# LGA outlines follow the coastline and carry far more detail than a dashed
# border needs. About 20 m, which is invisible at the zoom levels used here.
SIMPLIFY_TOLERANCE_DEGREES = 2e-4


@dataclass(frozen=True)
class BoundarySource:
    council_id: str
    layer_url: str
    name_field: str
    name_value: str


BOUNDARIES = {
    "hinchinbrook": BoundarySource(
        council_id="hinchinbrook",
        layer_url=QUEENSLAND_LGA_LAYER,
        name_field="lga",
        name_value="Hinchinbrook Shire",
    ),
    "gold-coast": BoundarySource(
        council_id="gold-coast",
        layer_url=QUEENSLAND_LGA_LAYER,
        name_field="lga",
        name_value="Gold Coast City",
    ),
    "tweed": BoundarySource(
        council_id="tweed",
        layer_url=NEW_SOUTH_WALES_LGA_LAYER,
        name_field="LGA_Name",
        name_value="Tweed (A)",
    ),
}


def count_positions(geometry: dict) -> int:
    coordinates = geometry.get("coordinates") or []
    polygons = coordinates if geometry.get("type") == "MultiPolygon" else [coordinates]
    return sum(len(ring) for polygon in polygons for ring in polygon)


def fetch_boundary(source: BoundarySource) -> dict:
    with create_client() as client:
        response = client.get(
            f"{source.layer_url}/query",
            params={
                "where": f"{source.name_field} = '{source.name_value}'",
                "outFields": source.name_field,
                "returnGeometry": "true",
                "outSR": 4326,
                "f": "geojson",
                "geometryPrecision": 6,
            },
        )
        response.raise_for_status()
    payload = response.json()
    features = payload.get("features") or []
    if not features:
        raise RuntimeError(f"no boundary found for {source.name_value}")
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Download a council's LGA outline.")
    parser.add_argument("--council", required=True, choices=sorted(BOUNDARIES))
    council_id = parser.parse_args().council
    source = BOUNDARIES[council_id]

    print(f"=== {source.name_value} ({council_id}) ===")
    boundary = fetch_boundary(source)

    before = sum(count_positions(f["geometry"]) for f in boundary["features"])
    for feature in boundary["features"]:
        feature["geometry"] = simplify_geometry(
            feature["geometry"], SIMPLIFY_TOLERANCE_DEGREES)
    after = sum(count_positions(f["geometry"]) for f in boundary["features"])

    destination = FRONTEND_PUBLIC_DIRECTORY / "councils" / council_id / "boundary.geojson"
    destination.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(boundary, separators=(",", ":"))
    destination.write_text(text, encoding="utf-8")
    print(f"  {len(boundary['features'])} feature(s), {before} -> {after} points, "
          f"{len(text) / 1024:.0f} KB")
    print(f"  wrote {destination}")


if __name__ == "__main__":
    main()

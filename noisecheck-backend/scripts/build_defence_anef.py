# Convert the Defence Airfields ANEF KML into a small GeoJSON the API can load at startup.
#
# Source : https://data.gov.au/data/dataset/ed102748-0701-4d38-b2eb-a8b1d009ee9f
# Licence: CC BY 3.0 Australia (commercial use permitted with attribution)
#
# The published KML is ~4.8 MB and covers every Australian Defence airfield. We keep only
# the NSW bases, which cuts it to something we can ship in the repo and hold in memory.
# Run this once; the output is committed.
#
#   python scripts/build_defence_anef.py
#
# Three defects in the published file are handled here — see load_kml_root(),
# BASE_NAME_CORRECTIONS, and the note on legend stubs in main().

import json
import re
import sys
import xml.etree.ElementTree as ET
from pathlib import Path

KML_NS = {"kml": "http://www.opengis.net/kml/2.2"}

SCRIPT_DIR = Path(__file__).resolve().parent
SOURCE_KML = SCRIPT_DIR / "defence_anef_source.kml"
OUTPUT_GEOJSON = SCRIPT_DIR.parent / "app" / "data" / "defence_anef_nsw.geojson"

# Placemarks carrying geometry are named like:
#   "RAAF Base Williamtown - Contour Range 25-30"
#   "RAAF Base Richmond - Contour Range 35+"
CONTOUR_RANGE_PATTERN = re.compile(
    r"^(?P<base>.+?)\s*-\s*Contour\s+Range\s+(?P<low>\d+)\s*(?:-\s*(?P<high>\d+)|(?P<open>\+))$",
    re.IGNORECASE,
)

# The source file misspells two base names and gives Albatross the wrong service prefix.
# Left as published -> corrected.
BASE_NAME_CORRECTIONS = {
    "RAAF Base Williamown": "RAAF Base Williamtown",
    "RAAF Base Albatross": "HMAS Albatross",
}

# Only these three Defence airfields are in NSW. Everything else is dropped.
NSW_BASES = {
    "RAAF Base Richmond",
    "RAAF Base Williamtown",
    "HMAS Albatross",
}


def load_kml_root(path: Path) -> ET.Element:
    """
    Parse the KML, working around a defect in the published file.

    The data.gov.au KML puts an `xsi:schemaLocation` attribute on <Document> but never
    declares the `xsi` prefix, so a strict XML parser rejects it with "unbound prefix".
    We declare the missing namespace on the root element before parsing.
    """
    text = path.read_text(encoding="utf-8", errors="replace")
    if "xmlns:xsi=" not in text:
        text = text.replace(
            "<kml ",
            '<kml xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ',
            1,
        )
    return ET.fromstring(text)


def parse_coordinates(text: str) -> list[list[float]]:
    """KML coordinate strings are 'lon,lat,alt lon,lat,alt ...' — return [[lon, lat], ...]."""
    ring = []
    for chunk in text.split():
        parts = chunk.split(",")
        if len(parts) >= 2:
            ring.append([float(parts[0]), float(parts[1])])
    return ring


def extract_polygons(placemark: ET.Element) -> list[list[list[list[float]]]]:
    """Return GeoJSON Polygon coordinate arrays found under this placemark."""
    polygons = []
    for polygon in placemark.iter(f"{{{KML_NS['kml']}}}Polygon"):
        outer = polygon.find(".//kml:outerBoundaryIs//kml:coordinates", KML_NS)
        if outer is None or not outer.text:
            continue
        rings = [parse_coordinates(outer.text)]
        for inner in polygon.findall(".//kml:innerBoundaryIs//kml:coordinates", KML_NS):
            if inner.text:
                rings.append(parse_coordinates(inner.text))
        polygons.append(rings)
    return polygons


def main() -> int:
    if not SOURCE_KML.exists():
        print(f"Missing source KML: {SOURCE_KML}", file=sys.stderr)
        print(
            "Download it from data.gov.au dataset ed102748-0701-4d38-b2eb-a8b1d009ee9f",
            file=sys.stderr,
        )
        return 1

    root = load_kml_root(SOURCE_KML)
    features = []

    for placemark in root.iter(f"{{{KML_NS['kml']}}}Placemark"):
        name_element = placemark.find("kml:name", KML_NS)
        if name_element is None or not name_element.text:
            continue

        # The file also contains "<base> - Contour 35" placemarks. Those are legend stubs
        # with no geometry — only the "Contour Range" placemarks carry polygons, so the
        # pattern below deliberately skips them.
        match = CONTOUR_RANGE_PATTERN.match(name_element.text.strip())
        if not match:
            continue

        base = match.group("base").strip()
        base = BASE_NAME_CORRECTIONS.get(base, base)
        if base not in NSW_BASES:
            continue

        low = int(match.group("low"))
        high = int(match.group("high")) if match.group("high") else None
        band = f"{low}-{high}" if high else f"{low}+"

        for rings in extract_polygons(placemark):
            features.append(
                {
                    "type": "Feature",
                    "properties": {
                        "base": base,
                        "anef_band": band,
                        # Lower bound of the band, used to rank overlapping contours.
                        "anef_min": low,
                    },
                    "geometry": {"type": "Polygon", "coordinates": rings},
                }
            )

    if not features:
        print("Parsed the KML but matched no NSW contours — check the name patterns.", file=sys.stderr)
        return 1

    # Worst band first, so a point-in-polygon scan can stop at the first hit.
    features.sort(key=lambda f: f["properties"]["anef_min"], reverse=True)

    collection = {
        "type": "FeatureCollection",
        "attribution": "Department of Defence — Australian Defence Airfields ANEF/ANEC, CC BY 3.0 AU",
        "source": "https://data.gov.au/data/dataset/ed102748-0701-4d38-b2eb-a8b1d009ee9f",
        "features": features,
    }

    OUTPUT_GEOJSON.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_GEOJSON.write_text(json.dumps(collection), encoding="utf-8")

    size_kb = OUTPUT_GEOJSON.stat().st_size / 1024
    print(f"Wrote {len(features)} polygons ({size_kb:.0f} KB) -> {OUTPUT_GEOJSON}")
    for base in sorted(NSW_BASES):
        bands = sorted(
            {f["properties"]["anef_band"] for f in features if f["properties"]["base"] == base},
            key=lambda b: int(b.rstrip("+").split("-")[0]),
        )
        print(f"  {base}: ANEF {bands or '(none)'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

"""Add street addresses to Bellingen's buildings.

The original Bellingen precompute kept only OpenStreetMap's `name` tag, which
about 12% of buildings carry, and discarded `addr:housenumber` / `addr:street`,
which about 24% carry. The result was a panel reading "Feature #592" for
buildings whose address was available all along.

This refetches the tags and fills them in by matching building centroids, so the
geometry, levels and ground heights already computed are left untouched.

    python -m scripts.enrich_bellingen_addresses
"""

import json
from pathlib import Path

from scripts.precompute_council import (
    OVERPASS_ENDPOINTS,
    create_client,
    openstreetmap_address,
)


def fetch_building_centres(client, bounding_box) -> list[dict]:
    """Each building's centre point and tags, without its outline.

    Two deliberate choices here, both forced by Overpass behaviour observed while
    building this:

    `out center` rather than `out geom` returns a fraction of the data. The
    full-geometry response for a whole shire is large enough that mirrors time
    out, and only a location and the tags are needed to attach an address.

    A bounding box rather than `area["admin_level"="6"]`, because the mirrors
    currently reachable resolve that area to about a tenth of the shire's
    buildings. The bounding box comes from the shire boundary already stored with
    the map data, and the results are filtered against it below.
    """
    south, west, north, east = bounding_box
    query = (
        f"[out:json][timeout:240];"
        f'way["building"]({south},{west},{north},{east});out center tags;'
    )
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = client.post(endpoint, data={"data": query}, timeout=300)
            if response.status_code == 200 and response.text.lstrip().startswith("{"):
                elements = response.json()["elements"]
                return [
                    {
                        "centre": (element["center"]["lon"], element["center"]["lat"]),
                        "tags": element.get("tags") or {},
                    }
                    for element in elements
                    if element.get("center")
                ]
            print(f"    overpass {endpoint.split('/')[2]}: HTTP {response.status_code}")
        except Exception as error:  # noqa: BLE001
            print(f"    overpass {endpoint.split('/')[2]}: {type(error).__name__}")
    raise RuntimeError("no Overpass endpoint returned building centres")

BUILDINGS_PATH = Path(
    r"C:\Users\manoj\Desktop\EmberCheck\floodcheck-frontend\public\councils\bellingen"
    r"\buildings.geojson"
)

# The same administrative area the original precompute used. A bounding box was
# tried first and was wrong: it also returns the neighbouring councils' buildings,
# so only about a tenth of what came back was actually in Bellingen Shire.
ADMINISTRATIVE_AREA = "Bellingen Shire Council"

# Refetching Overpass repeatedly gets throttled, so the response is kept.
CACHE_PATH = Path(__file__).parent / ".cache" / "bellingen_osm_buildings.json"

# Outlines are matched by centroid rather than by exact geometry: many Bellingen
# buildings have been re-traced in OpenStreetMap since the dataset was built, so
# an exact key matches under a tenth of them. A building's centroid barely moves
# when its outline is refined, and neighbouring buildings are metres apart, so a
# small search radius is unambiguous.
MATCH_RADIUS_DEGREES = 0.00012  # about 13 metres
GRID_SIZE_DEGREES = 0.001


BOUNDARY_PATH = BUILDINGS_PATH.parent / "boundary.geojson"


def shire_bounding_box() -> tuple:
    """South, west, north, east of the shire, from the boundary already stored."""
    boundary = json.loads(BOUNDARY_PATH.read_text(encoding="utf-8"))
    longitudes, latitudes = [], []
    for feature in boundary["features"]:
        geometry = feature["geometry"]
        polygons = (geometry["coordinates"] if geometry["type"] == "MultiPolygon"
                    else [geometry["coordinates"]])
        for polygon in polygons:
            for ring in polygon:
                for point in ring:
                    longitudes.append(point[0])
                    latitudes.append(point[1])
    return (min(latitudes), min(longitudes), max(latitudes), max(longitudes))


def outline_centroid(geometry: dict) -> tuple | None:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "MultiPolygon":
        coordinates = coordinates[0] if coordinates else []
    ring = coordinates[0] if coordinates else []
    if len(ring) < 4:
        return None
    return (
        sum(point[0] for point in ring) / len(ring),
        sum(point[1] for point in ring) / len(ring),
    )


class AddressLocator:
    """Finds the nearest addressed OpenStreetMap building to a point."""

    def __init__(self, buildings: list[dict]):
        self.cells: dict[tuple[int, int], list] = {}
        for building in buildings:
            address = openstreetmap_address(building["tags"])
            centre = tuple(building["centre"])
            if not address:
                continue
            cell = (int(centre[0] / GRID_SIZE_DEGREES), int(centre[1] / GRID_SIZE_DEGREES))
            self.cells.setdefault(cell, []).append((centre, address))

    def find(self, point: tuple) -> str | None:
        column = int(point[0] / GRID_SIZE_DEGREES)
        row = int(point[1] / GRID_SIZE_DEGREES)
        best_address, best_distance = None, MATCH_RADIUS_DEGREES
        for column_offset in (-1, 0, 1):
            for row_offset in (-1, 0, 1):
                for centroid, address in self.cells.get(
                        (column + column_offset, row + row_offset), ()):
                    distance = max(abs(centroid[0] - point[0]), abs(centroid[1] - point[1]))
                    if distance < best_distance:
                        best_address, best_distance = address, distance
        return best_address


def main() -> None:
    data = json.loads(BUILDINGS_PATH.read_text(encoding="utf-8"))
    features = data["features"]
    named_before = sum(1 for f in features if f["properties"].get("name"))

    if CACHE_PATH.exists():
        footprints = json.loads(CACHE_PATH.read_text(encoding="utf-8"))
        print(f"reusing cached OpenStreetMap buildings ({len(footprints)})")
    else:
        bounding_box = shire_bounding_box()
        print(f"shire bounding box from the stored boundary: {bounding_box}")
        with create_client() as client:
            print("fetching OpenStreetMap building tags:")
            footprints = fetch_building_centres(client, bounding_box)
        CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
        CACHE_PATH.write_text(json.dumps(footprints, separators=(",", ":")), encoding="utf-8")
    print(f"  {len(footprints)} buildings")

    locator = AddressLocator(footprints)
    print(f"  {sum(len(v) for v in locator.cells.values())} carry an address or name")

    updated = 0
    for feature in features:
        centroid = outline_centroid(feature["geometry"])
        address = locator.find(centroid) if centroid else None
        if address and address != feature["properties"].get("name"):
            feature["properties"]["name"] = address
            updated += 1

    BUILDINGS_PATH.write_text(json.dumps(data, separators=(",", ":")), encoding="utf-8")
    named_after = sum(1 for f in features if f["properties"].get("name"))
    print(f"  buildings with a label: {named_before} -> {named_after} "
          f"of {len(features)} ({updated} updated)")


if __name__ == "__main__":
    main()

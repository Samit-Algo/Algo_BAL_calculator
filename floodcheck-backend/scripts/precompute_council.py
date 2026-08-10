"""Build the static map datasets a council needs, into the frontend's public folder.

Run once per council, offline. The output is plain GeoJSON served from the
frontend, so the running map has no dependency on any council's servers — if a
council's ArcGIS is slow or down, the map is unaffected.

    python -m scripts.precompute_council --council hinchinbrook
    python -m scripts.precompute_council --council gold-coast

Two delivery modes, chosen per council by data volume:

    single   one GeoJSON file, fetched once. Fine up to roughly 20,000 features.
    chunked  a grid of GeoJSON chunks plus an index, loaded as the viewport moves.
             Used where one file would be too large to transfer, parse or render.

Feature properties are written in the canonical FloodValueKeys vocabulary, so the
map and the API speak the same language.

Note: Bellingen's dataset joins OpenStreetMap footprints to council flood polygons
and predates this script; see scripts_precompute_bellingen.py. The councils here
publish their own polygons, so no footprint join is needed.
"""

import argparse
import json
import math
import time
from dataclasses import dataclass, field
from pathlib import Path

import httpx

from app.flood.flood_values import (
    FloodValueKeys,
    coerce_measurements,
    is_measurement_key,
)

# Ground sampling is the slow part of a run, so results are cached and reused.
CACHE_DIRECTORY = Path(__file__).parent / ".cache"

FRONTEND_PUBLIC_DIRECTORY = Path(
    r"C:\Users\manoj\Desktop\EmberCheck\floodcheck-frontend\public"
)

USER_AGENT = {"User-Agent": "floodcheck-precompute"}
PAGE_SIZE = 2000
GEOMETRY_PRECISION = 6
REQUEST_TIMEOUT_SECONDS = 180

# Councils here publish no building heights, so extruded features use one nominal
# height. The colour carries the flood information; the height is presentation.
DEFAULT_BUILDING_HEIGHT_M = 6.0

# A feature counts as flooded above this depth; below it the land floods but the
# building is treated as dry. Matches the existing Bellingen dataset.
BUILDING_FLOODED_DEPTH_M = 0.2


@dataclass(frozen=True)
class ElevationSource:
    """Batch ground-level sampling from a state elevation image service."""

    name: str
    get_samples_url: str
    batch_size: int = 100


QUEENSLAND_ELEVATION = ElevationSource(
    name="Queensland DEM",
    get_samples_url=(
        "https://spatial-img.information.qld.gov.au/arcgis/rest/services/"
        "Elevation/QldDem/ImageServer/getSamples"
    ),
)

NEW_SOUTH_WALES_ELEVATION = ElevationSource(
    name="NSW 5 m Elevation",
    get_samples_url=(
        "https://maps.six.nsw.gov.au/arcgis/rest/services/public/"
        "NSW_5M_Elevation/ImageServer/getSamples"
    ),
)


@dataclass(frozen=True)
class SpatialJoinLayer:
    """A polygon layer whose value is read at each building's location.

    Used where a council publishes each flood event as its own independent
    surface, so the layers share no key to join on and can only be related
    geographically. Contrast with ADDITIONAL_EVENT_LAYERS, which joins layers
    that do share a feature id.
    """

    layer_id: int
    source_field: str
    canonical_key: str


@dataclass(frozen=True)
class BuildingFootprintSource:
    """OpenStreetMap building outlines to draw instead of the council's polygons.

    Some councils publish flood data against land parcels or as contour surfaces
    rather than against buildings. Those tile the ground, so extruding them merges
    neighbours into one block. Where OpenStreetMap covers the same area well, real
    footprints are fetched and each takes its flood values from the council data
    beneath it.
    """

    # South, west, north, east. Ignored when an administrative area is given.
    bounding_box: tuple[float, float, float, float] | None = None

    # Preferred where it resolves: a bounding box around a council also sweeps in
    # its neighbours' buildings.
    administrative_area: str | None = None

    default_height_m: float = DEFAULT_BUILDING_HEIGHT_M


@dataclass(frozen=True)
class CouncilDataset:
    """Everything needed to build one council's map data."""

    council_id: str
    label: str
    layer_url: str

    # Council field name -> canonical FloodValueKeys key.
    level_fields: dict

    # The event used to classify a feature as flooded, and for the status colour.
    design_level_key: str

    # Where ground level comes from: a field the council publishes, or a DEM.
    ground_field: str | None = None
    elevation_source: ElevationSource | None = None

    # Extra council fields to carry through for the property panel.
    label_field: str | None = None

    delivery_mode: str = "single"

    # Chunked mode only: the grid is sized so each cell holds roughly this many
    # features, keeping each request small and the rendered set bounded.
    target_features_per_chunk: int = 2500

    where_clause: str = "1=1"
    extra_fields: tuple[str, ...] = field(default_factory=tuple)

    # Douglas-Peucker tolerance in degrees. Land parcels carry far more vertices
    # than the map can use, so they are thinned; 1e-5 is roughly one metre.
    simplify_tolerance_degrees: float = 0.0

    # Set where the council's own polygons are parcels but real building outlines
    # are available from OpenStreetMap.
    footprint_source: BuildingFootprintSource | None = None

    # Set where each flood event is published as its own polygon surface, to be
    # sampled at each building's location rather than joined by a shared id.
    spatial_join_layers: tuple[SpatialJoinLayer, ...] = field(default_factory=tuple)

    def output_fields(self) -> str:
        names = list(self.level_fields)
        if self.ground_field:
            names.append(self.ground_field)
        if self.label_field:
            names.append(self.label_field)
        names.extend(self.extra_fields)
        return ",".join(dict.fromkeys(names))


DATASETS = {
    "hinchinbrook": CouncilDataset(
        council_id="hinchinbrook",
        label="Hinchinbrook Shire Council",
        layer_url=(
            "https://services-ap1.arcgis.com/NjDnGlEZKSqtp6VA/arcgis/rest/services/"
            "Flood_Alert_Public_Model_Layers/FeatureServer/4"
        ),
        # Every event lives on one layer here, so one pass collects them all.
        level_fields={"Q100YH": FloodValueKeys.LEVEL_1_PERCENT_AEP},
        design_level_key=FloodValueKeys.LEVEL_1_PERCENT_AEP,
        elevation_source=QUEENSLAND_ELEVATION,
        label_field="propertyaddress",
        extra_fields=("Q100YI",),
        delivery_mode="single",
        # Cadastral parcels average ~94 vertices each, far more than the map needs.
        simplify_tolerance_degrees=1e-5,
        # The council maps flood levels per parcel, but parcels tile the ground and
        # cannot be extruded into separate buildings. OpenStreetMap covers Ingham
        # well (about 4,400 footprints for 4,487 parcels), so real buildings are
        # drawn instead, each inheriting its parcel's levels.
        footprint_source=BuildingFootprintSource(
            bounding_box=(-18.70, 146.10, -18.60, 146.22),
        ),
    ),
    "tweed": CouncilDataset(
        council_id="tweed",
        label="Tweed Shire Council",
        layer_url=(
            "https://services1.arcgis.com/KURAxOhGWn5RdCPg/arcgis/rest/services/"
            "FloodStudyAdopted2025/FeatureServer/14"
        ),
        # Every value is sampled spatially, so nothing comes from a base layer.
        level_fields={},
        design_level_key=FloodValueKeys.LEVEL_1_PERCENT_AEP,
        elevation_source=NEW_SOUTH_WALES_ELEVATION,
        delivery_mode="single",
        simplify_tolerance_degrees=1e-5,
        # The council maps flood levels as contour surfaces over the ground rather
        # than against buildings, so OpenStreetMap supplies the outlines.
        footprint_source=BuildingFootprintSource(
            bounding_box=(-28.62, 153.17, -28.15, 153.60),
        ),
        # Each event is an independent surface sharing no key with the others, so
        # each is sampled at the building's location.
        spatial_join_layers=(
            SpatialJoinLayer(14, "MAX_LEVEL", FloodValueKeys.LEVEL_1_PERCENT_AEP),
            SpatialJoinLayer(59, "MAX_LEVEL", FloodValueKeys.LEVEL_FLOOD_PLANNING_AREA),
            SpatialJoinLayer(1, "Value", FloodValueKeys.LEVEL_PROBABLE_MAXIMUM_FLOOD),
            SpatialJoinLayer(22, "HAZCAT",
                             FloodValueKeys.HYDRAULIC_CATEGORY_1_PERCENT_AEP),
        ),
    ),
    "gold-coast": CouncilDataset(
        council_id="gold-coast",
        label="City of Gold Coast",
        layer_url=(
            "https://services.arcgis.com/3vStCH7NDoBOZ5zn/arcgis/rest/services/"
            "Designated_Flood_Level_for_Residential_Buildings/FeatureServer/0"
        ),
        level_fields={"FLOODLVLDES": FloodValueKeys.LEVEL_1_PERCENT_AEP},
        design_level_key=FloodValueKeys.LEVEL_1_PERCENT_AEP,
        # The council publishes its own surveyed ground level, so no DEM is needed.
        ground_field="GROUNDCENTRE",
        label_field="HOUSE_ADDRESS",
        extra_fields=("SUBURB",),
        delivery_mode="chunked",
        target_features_per_chunk=3000,
        simplify_tolerance_degrees=5e-6,
    ),
}

# The other event layers for councils that publish one layer per event. Fetched
# after the base pass and joined on the council's own feature id.
ADDITIONAL_EVENT_LAYERS = {
    "hinchinbrook": (
        # (layer id, council field, canonical key)
        (0, "Q5YH", FloodValueKeys.LEVEL_5_YEAR_ARI),
        (1, "Q10YH", FloodValueKeys.LEVEL_10_PERCENT_AEP),
        (2, "Q20YH", FloodValueKeys.LEVEL_5_PERCENT_AEP),
        (3, "Q50YH", FloodValueKeys.LEVEL_2_PERCENT_AEP),
    ),
}
JOIN_FIELD = "OBJECTID"


def create_client() -> httpx.Client:
    return httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS, headers=USER_AGENT)


def perpendicular_distance(point, line_start, line_end) -> float:
    (x, y), (x1, y1), (x2, y2) = point, line_start, line_end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / math.hypot(dx, dy)


def simplify_ring(ring: list, tolerance: float) -> list:
    """Douglas-Peucker, iterative so deep rings cannot overflow the stack."""
    if len(ring) < 3:
        return ring
    keep = [False] * len(ring)
    keep[0] = keep[-1] = True
    segments = [(0, len(ring) - 1)]
    while segments:
        start, end = segments.pop()
        if end <= start + 1:
            continue
        furthest_index, furthest_distance = start, -1.0
        for index in range(start + 1, end):
            distance = perpendicular_distance(ring[index], ring[start], ring[end])
            if distance > furthest_distance:
                furthest_index, furthest_distance = index, distance
        if furthest_distance > tolerance:
            keep[furthest_index] = True
            segments.append((start, furthest_index))
            segments.append((furthest_index, end))
    simplified = [point for point, keep_it in zip(ring, keep) if keep_it]
    # A ring needs at least three distinct points plus the closing point.
    return simplified if len(simplified) >= 4 else ring


def simplify_geometry(geometry: dict, tolerance: float) -> dict:
    if not tolerance or not geometry:
        return geometry
    geometry_type = geometry.get("type")
    coordinates = geometry.get("coordinates") or []
    if geometry_type == "Polygon":
        return {"type": "Polygon",
                "coordinates": [simplify_ring(ring, tolerance) for ring in coordinates]}
    if geometry_type == "MultiPolygon":
        return {"type": "MultiPolygon",
                "coordinates": [[simplify_ring(ring, tolerance) for ring in polygon]
                                for polygon in coordinates]}
    return geometry


def load_cached_spatial_join(council_id: str, canonical_key: str,
                             expected_points: int) -> dict | None:
    path = CACHE_DIRECTORY / f"{council_id}_join_{canonical_key}.json"
    if not path.exists():
        return None
    cached = json.loads(path.read_text(encoding="utf-8"))
    if cached.get("points") != expected_points:
        return None
    print(f"    reused from cache ({len(cached['values'])} points matched)")
    return {int(index): value for index, value in cached["values"].items()}


def save_cached_spatial_join(council_id: str, canonical_key: str,
                             expected_points: int, values: dict) -> None:
    CACHE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    (CACHE_DIRECTORY / f"{council_id}_join_{canonical_key}.json").write_text(
        json.dumps({"points": expected_points, "values": values}), encoding="utf-8")


def load_cached_source_features(council_id: str) -> list | None:
    path = CACHE_DIRECTORY / f"{council_id}_features.json"
    if not path.exists():
        return None
    features = json.loads(path.read_text(encoding="utf-8"))
    print(f"  source features reused from cache ({len(features)})")
    return features


def save_cached_source_features(council_id: str, features: list) -> None:
    CACHE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    (CACHE_DIRECTORY / f"{council_id}_features.json").write_text(
        json.dumps(features, separators=(",", ":")), encoding="utf-8")


def load_cached_ground_levels(council_id: str, expected_count: int) -> list | None:
    path = CACHE_DIRECTORY / f"{council_id}_ground.json"
    if not path.exists():
        return None
    cached = json.loads(path.read_text(encoding="utf-8"))
    if len(cached) != expected_count:
        print(f"  ground cache ignored: {len(cached)} entries, expected {expected_count}")
        return None
    print(f"  ground level reused from cache ({len(cached)} points)")
    return cached


def save_cached_ground_levels(council_id: str, levels: list) -> None:
    CACHE_DIRECTORY.mkdir(parents=True, exist_ok=True)
    (CACHE_DIRECTORY / f"{council_id}_ground.json").write_text(
        json.dumps(levels), encoding="utf-8")


def fetch_all_features(client: httpx.Client, layer_url: str, output_fields: str,
                       where_clause: str, want_geometry: bool = True) -> list[dict]:
    """Page through an ArcGIS layer and return every feature as GeoJSON."""
    features: list[dict] = []
    offset = 0
    while True:
        started = time.time()
        response = client.get(
            f"{layer_url}/query",
            params={
                "where": where_clause,
                "outFields": output_fields,
                "returnGeometry": "true" if want_geometry else "false",
                "outSR": 4326,
                "f": "geojson",
                "geometryPrecision": GEOMETRY_PRECISION,
                "resultOffset": offset,
                "resultRecordCount": PAGE_SIZE,
            },
        )
        response.raise_for_status()
        page = response.json().get("features", [])
        features.extend(page)
        print(f"    offset {offset}: +{len(page)} ({len(features)} total) "
              f"in {time.time() - started:.1f}s", flush=True)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return features


def representative_point(geometry: dict) -> tuple[float, float] | None:
    """A point inside the polygon, good enough for sampling ground level."""
    if not geometry:
        return None
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "MultiPolygon":
        coordinates = coordinates[0] if coordinates else []
    ring = coordinates[0] if coordinates else []
    if not ring:
        return None
    return (
        sum(point[0] for point in ring) / len(ring),
        sum(point[1] for point in ring) / len(ring),
    )


def polygon_area_m2(geometry: dict, latitude: float) -> float:
    """Planar area of the outer ring, adequate at building scale."""
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "MultiPolygon":
        coordinates = coordinates[0] if coordinates else []
    ring = coordinates[0] if coordinates else []
    if len(ring) < 4:
        return 0.0
    metres_per_degree_longitude = 111_320 * math.cos(math.radians(latitude))
    metres_per_degree_latitude = 110_540
    total = 0.0
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        total += (x1 * metres_per_degree_longitude) * (y2 * metres_per_degree_latitude) - (
            x2 * metres_per_degree_longitude
        ) * (y1 * metres_per_degree_latitude)
    return abs(total) / 2


def sample_ground_levels(client: httpx.Client, source: ElevationSource,
                         points: list[tuple[float, float]]) -> list[float | None]:
    """Batch-sample ground level for every point, in order."""
    levels: list[float | None] = [None] * len(points)
    started = time.time()
    for start in range(0, len(points), source.batch_size):
        chunk = points[start:start + source.batch_size]
        geometry = {"points": [[x, y] for x, y in chunk],
                    "spatialReference": {"wkid": 4326}}
        for attempt in range(2):
            try:
                response = client.get(
                    source.get_samples_url,
                    params={"geometry": json.dumps(geometry),
                            "geometryType": "esriGeometryMultipoint",
                            "returnFirstValueOnly": "true", "f": "json"},
                    timeout=120,
                )
                for offset, sample in enumerate(response.json().get("samples", [])):
                    try:
                        levels[start + offset] = round(float(sample.get("value")), 2)
                    except (TypeError, ValueError):
                        pass
                break
            except Exception as error:  # noqa: BLE001
                if attempt:
                    print(f"    elevation batch {start} failed: {str(error)[:70]}")
        if start % (source.batch_size * 10) == 0:
            done = min(start + source.batch_size, len(points))
            print(f"    ground {done}/{len(points)} in {time.time() - started:.0f}s",
                  flush=True)
    return levels


OVERPASS_ENDPOINTS = (
    "https://overpass-api.de/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
)


def build_overpass_query(bounding_box=None, administrative_area: str | None = None) -> str:
    """Buildings within a bounding box, or within a named local government area.

    Prefer the administrative area where one exists: a bounding box around a
    council also sweeps in its neighbours' buildings.
    """
    if administrative_area:
        return (
            f"[out:json][timeout:240];"
            f'area["admin_level"="6"]["name"="{administrative_area}"]->.council;'
            f'way["building"](area.council);out geom;'
        )
    south, west, north, east = bounding_box
    return (
        f"[out:json][timeout:240];"
        f'way["building"]({south},{west},{north},{east});out geom;'
    )


def fetch_openstreetmap_buildings(client: httpx.Client, bounding_box=None,
                                  administrative_area: str | None = None) -> list[dict]:
    """Building outlines with their address tags, as GeoJSON-style features."""
    query = build_overpass_query(bounding_box, administrative_area)
    elements = None
    for endpoint in OVERPASS_ENDPOINTS:
        try:
            response = client.post(endpoint, data={"data": query}, timeout=300)
            if response.status_code == 200 and response.text.lstrip().startswith("{"):
                elements = response.json()["elements"]
                break
            print(f"    overpass {endpoint.split('/')[2]}: HTTP {response.status_code}")
        except Exception as error:  # noqa: BLE001
            print(f"    overpass {endpoint.split('/')[2]}: {type(error).__name__}")
    if elements is None:
        raise RuntimeError("no Overpass endpoint returned building footprints")

    features = []
    for element in elements:
        geometry = element.get("geometry")
        if not geometry or len(geometry) < 4:
            continue
        ring = [[point["lon"], point["lat"]] for point in geometry]
        if ring[0] != ring[-1]:
            ring.append(ring[0])
        features.append({
            "type": "Feature",
            "geometry": {"type": "Polygon", "coordinates": [ring]},
            "properties": {"tags": element.get("tags") or {}},
        })
    return features


def openstreetmap_address(tags: dict) -> str | None:
    """A readable street address from OSM tags, falling back to the place name."""
    number = tags.get("addr:housenumber")
    street = tags.get("addr:street")
    if number and street:
        suburb = tags.get("addr:suburb") or tags.get("addr:city")
        return f"{number} {street}, {suburb}".strip(", ") if suburb else f"{number} {street}"
    return tags.get("name")


def building_height(tags: dict, default_height: float) -> float:
    for key, scale in (("height", 1.0), ("building:levels", 3.1)):
        raw = tags.get(key)
        if not raw:
            continue
        try:
            return float(str(raw).split()[0]) * scale
        except (TypeError, ValueError):
            continue
    return default_height


def point_inside_ring(point, ring) -> bool:
    """Ray casting; `ring` is a closed list of [longitude, latitude] pairs."""
    x, y = point
    inside = False
    for index in range(len(ring) - 1):
        x1, y1 = ring[index]
        x2, y2 = ring[index + 1]
        if (y1 > y) != (y2 > y):
            crossing_x = x1 + (y - y1) / (y2 - y1) * (x2 - x1)
            if x < crossing_x:
                inside = not inside
    return inside


class ParcelIndex:
    """Finds which parcel contains a point, using a coarse grid to stay fast."""

    CELL_SIZE_DEGREES = 0.005  # roughly 500 m

    def __init__(self, parcels: list[dict]):
        self.parcels = parcels
        self.cells: dict[tuple[int, int], list[int]] = {}
        for index, parcel in enumerate(parcels):
            for cell in self.cells_covering(parcel["bounds"]):
                self.cells.setdefault(cell, []).append(index)

    def cells_covering(self, bounds):
        min_lon, min_lat, max_lon, max_lat = bounds
        size = self.CELL_SIZE_DEGREES
        for column in range(int(min_lon / size), int(max_lon / size) + 1):
            for row in range(int(min_lat / size), int(max_lat / size) + 1):
                yield (column, row)

    def find(self, longitude: float, latitude: float) -> dict | None:
        size = self.CELL_SIZE_DEGREES
        for index in self.cells.get((int(longitude / size), int(latitude / size)), ()):
            parcel = self.parcels[index]
            min_lon, min_lat, max_lon, max_lat = parcel["bounds"]
            if not (min_lon <= longitude <= max_lon and min_lat <= latitude <= max_lat):
                continue
            if point_inside_ring((longitude, latitude), parcel["ring"]):
                return parcel
        return None


class PointIndex:
    """A grid of sample points, so a polygon can find the points it may contain.

    Deliberately the inverse of ParcelIndex. Where a council's flood surface runs
    to hundreds of thousands of polygons, indexing the polygons would mean holding
    them all in memory. Indexing the far smaller set of building points instead
    lets the polygons be streamed past and discarded page by page.
    """

    CELL_SIZE_DEGREES = 0.002  # roughly 200 m

    def __init__(self, points: list[tuple[float, float]]):
        self.points = points
        self.cells: dict[tuple[int, int], list[int]] = {}
        for index, (longitude, latitude) in enumerate(points):
            self.cells.setdefault(self.cell_of(longitude, latitude), []).append(index)

    def cell_of(self, longitude: float, latitude: float) -> tuple[int, int]:
        size = self.CELL_SIZE_DEGREES
        return (int(longitude / size), int(latitude / size))

    def candidates_within(self, bounds) -> list[int]:
        min_lon, min_lat, max_lon, max_lat = bounds
        size = self.CELL_SIZE_DEGREES
        found = []
        for column in range(int(min_lon / size), int(max_lon / size) + 1):
            for row in range(int(min_lat / size), int(max_lat / size) + 1):
                found.extend(self.cells.get((column, row), ()))
        return found


def polygon_rings(geometry: dict) -> list:
    coordinates = geometry.get("coordinates") or []
    if geometry.get("type") == "MultiPolygon":
        return [polygon[0] for polygon in coordinates if polygon]
    return [coordinates[0]] if coordinates else []


def sample_layer_at_points(client: httpx.Client, layer_url: str, source_field: str,
                           point_index: PointIndex) -> dict:
    """Value of `source_field` at each indexed point, by streaming the layer.

    Pages are tested and discarded, so peak memory is one page rather than the
    whole surface.
    """
    values: dict[int, object] = {}
    offset = 0
    while True:
        response = client.get(f"{layer_url}/query", params={
            "where": "1=1", "outFields": source_field, "returnGeometry": "true",
            "outSR": 4326, "f": "geojson", "geometryPrecision": GEOMETRY_PRECISION,
            "resultOffset": offset, "resultRecordCount": PAGE_SIZE,
        })
        response.raise_for_status()
        page = response.json().get("features", [])
        for feature in page:
            rings = polygon_rings(feature.get("geometry") or {})
            if not rings:
                continue
            value = (feature.get("properties") or {}).get(source_field)
            if value is None:
                continue
            for ring in rings:
                longitudes = [point[0] for point in ring]
                latitudes = [point[1] for point in ring]
                bounds = (min(longitudes), min(latitudes), max(longitudes), max(latitudes))
                for index in point_index.candidates_within(bounds):
                    if index in values:
                        continue
                    if point_inside_ring(point_index.points[index], ring):
                        values[index] = value
        offset += PAGE_SIZE
        print(f"    {offset:>7} polygons scanned, {len(values)} points matched", flush=True)
        if len(page) < PAGE_SIZE:
            break
    return values


def build_parcel_index(source_features: list[dict]) -> ParcelIndex:
    parcels = []
    for feature in source_features:
        geometry = feature.get("geometry") or {}
        coordinates = geometry.get("coordinates") or []
        if geometry.get("type") == "MultiPolygon":
            coordinates = coordinates[0] if coordinates else []
        ring = coordinates[0] if coordinates else []
        if len(ring) < 4:
            continue
        longitudes = [point[0] for point in ring]
        latitudes = [point[1] for point in ring]
        parcels.append({
            "ring": ring,
            "bounds": (min(longitudes), min(latitudes), max(longitudes), max(latitudes)),
            "properties": feature.get("properties") or {},
        })
    return ParcelIndex(parcels)


def classify_status(design_level: float | None, ground_level: float | None) -> str:
    """not | parcel | building, matching the map's three colours."""
    if design_level is None:
        return "not"
    if ground_level is None:
        return "parcel"
    return "building" if design_level - ground_level > BUILDING_FLOODED_DEPTH_M else "parcel"


def build_output_feature(index: int, source_feature: dict, levels: dict,
                         ground_level: float | None, name: str | None,
                         design_level_key: str, extras: dict,
                         simplify_tolerance: float = 0.0) -> dict:
    geometry = simplify_geometry(source_feature.get("geometry") or {}, simplify_tolerance)
    point = representative_point(geometry)
    latitude = point[1] if point else 0.0
    design_level = levels.get(design_level_key)
    depth = (round(design_level - ground_level, 2)
             if design_level is not None and ground_level is not None else None)
    properties = {
        "id": index,
        "ground_m": ground_level,
        "height_m": DEFAULT_BUILDING_HEIGHT_M,
        "area_m2": round(polygon_area_m2(geometry, latitude), 1),
        "levels": levels,
        "depth_1aep": depth,
        "status": classify_status(design_level, ground_level),
        "name": name,
    }
    properties.update(extras)
    return {"type": "Feature", "geometry": geometry, "properties": properties}


def count_by_status(features: list[dict], level_key: str) -> dict:
    counts = {"not": 0, "parcel": 0, "building": 0}
    for feature in features:
        properties = feature["properties"]
        counts[classify_status(properties["levels"].get(level_key),
                               properties["ground_m"])] += 1
    return counts


def build_counts_by_event(features: list[dict], level_keys: list[str]) -> dict:
    """Status counts per event.

    Only measurements are counted. A council may also publish a category such as
    a hydraulic classification, which has no level to compare against the ground.
    """
    return {key: count_by_status(features, key)
            for key in level_keys if is_measurement_key(key)}


def feature_bounds(feature: dict) -> tuple[float, float, float, float]:
    point = representative_point(feature.get("geometry") or {})
    if not point:
        return (0.0, 0.0, 0.0, 0.0)
    return (point[0], point[1], point[0], point[1])


def write_json(path: Path, payload: dict) -> int:
    path.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, separators=(",", ":"))
    path.write_text(text, encoding="utf-8")
    return len(text)


def write_single_file(dataset: CouncilDataset, features: list[dict],
                      level_keys: list[str], output_directory: Path) -> None:
    size = write_json(output_directory / "buildings.geojson",
                      {"type": "FeatureCollection", "features": features})
    write_json(output_directory / "index.json", {
        "council_id": dataset.council_id,
        "delivery_mode": "single",
        "feature_count": len(features),
        "counts_by_event": build_counts_by_event(features, level_keys),
    })
    print(f"  wrote buildings.geojson: {len(features)} features, {size / 1e6:.1f} MB")


# Guards against a pathologically deep split where many features share a point.
MAX_SUBDIVISION_DEPTH = 9


def subdivide_into_cells(placed_features: list[tuple[dict, tuple[float, float]]],
                         bounds: tuple[float, float, float, float],
                         target_size: int, depth: int = 0) -> list[dict]:
    """Split an area into cells until each holds at most `target_size` features.

    Building density varies enormously across a council, so a uniform grid would
    leave some cells nearly empty and others far too large to fetch at once.
    Splitting only where features are dense keeps every chunk a similar size.
    """
    if len(placed_features) <= target_size or depth >= MAX_SUBDIVISION_DEPTH:
        return [{"bounds": bounds, "features": [f for f, _ in placed_features]}]

    min_lon, min_lat, max_lon, max_lat = bounds
    middle_lon = (min_lon + max_lon) / 2
    middle_lat = (min_lat + max_lat) / 2
    quadrant_bounds = [
        (min_lon, min_lat, middle_lon, middle_lat),
        (middle_lon, min_lat, max_lon, middle_lat),
        (min_lon, middle_lat, middle_lon, max_lat),
        (middle_lon, middle_lat, max_lon, max_lat),
    ]
    quadrants: list[list] = [[], [], [], []]
    for feature, (longitude, latitude) in placed_features:
        index = (1 if longitude >= middle_lon else 0) + (2 if latitude >= middle_lat else 0)
        quadrants[index].append((feature, (longitude, latitude)))

    cells = []
    for quadrant, child_bounds in zip(quadrants, quadrant_bounds):
        if quadrant:
            cells.extend(subdivide_into_cells(quadrant, child_bounds, target_size, depth + 1))
    return cells


def write_chunked(dataset: CouncilDataset, features: list[dict],
                  level_keys: list[str], output_directory: Path) -> None:
    """Split features into local chunks so the map loads only what is in view."""
    placed = [(f, representative_point(f.get("geometry") or {}) or (0.0, 0.0))
              for f in features]
    longitudes = [point[0] for _, point in placed]
    latitudes = [point[1] for _, point in placed]
    overall_bounds = (min(longitudes), min(latitudes), max(longitudes), max(latitudes))

    cells = subdivide_into_cells(placed, overall_bounds, dataset.target_features_per_chunk)

    chunks_directory = output_directory / "chunks"
    if chunks_directory.exists():
        for stale in chunks_directory.glob("*.geojson"):
            stale.unlink()

    chunk_records = []
    total_bytes = 0
    for number, cell in enumerate(cells):
        filename = f"{number}.geojson"
        total_bytes += write_json(chunks_directory / filename,
                                  {"type": "FeatureCollection", "features": cell["features"]})
        chunk_records.append({
            "id": number,
            "count": len(cell["features"]),
            "bounds": [round(value, 6) for value in cell["bounds"]],
            "url": f"/councils/{dataset.council_id}/chunks/{filename}",
        })

    write_json(output_directory / "index.json", {
        "council_id": dataset.council_id,
        "delivery_mode": "chunked",
        "feature_count": len(features),
        "counts_by_event": build_counts_by_event(features, level_keys),
        "bounds": [round(value, 6) for value in overall_bounds],
        "chunks": chunk_records,
    })
    counts = [record["count"] for record in chunk_records]
    print(f"  wrote {len(chunk_records)} chunks, {total_bytes / 1e6:.1f} MB total, "
          f"largest {max(counts)} features, average {sum(counts) // len(counts)}")


def collect_additional_levels(client: httpx.Client, dataset: CouncilDataset) -> dict:
    """Levels from a council's other event layers, keyed by its own feature id."""
    layers = ADDITIONAL_EVENT_LAYERS.get(dataset.council_id, ())
    if not layers:
        return {}
    base_url = dataset.layer_url.rsplit("/", 1)[0]
    by_object_id: dict = {}
    for layer_id, source_field, canonical_key in layers:
        print(f"  event layer {layer_id} ({source_field}):", flush=True)
        rows = fetch_all_features(client, f"{base_url}/{layer_id}",
                                  f"{JOIN_FIELD},{source_field}", dataset.where_clause,
                                  want_geometry=False)
        for row in rows:
            properties = row.get("properties") or {}
            object_id = properties.get(JOIN_FIELD)
            if object_id is None:
                continue
            by_object_id.setdefault(object_id, {})[canonical_key] = properties.get(source_field)
    return by_object_id


def levels_from_properties(dataset: CouncilDataset, properties: dict,
                           additional_levels: dict) -> dict:
    levels = {canonical: properties.get(source_field)
              for source_field, canonical in dataset.level_fields.items()}
    levels.update(additional_levels.get(properties.get(JOIN_FIELD), {}))
    return coerce_measurements(levels)


def build_parcel_features(dataset: CouncilDataset, source_features: list[dict],
                          ground_levels: list, additional_levels: dict) -> list[dict]:
    """Output the council's own polygons, one feature each."""
    features = []
    for index, (source_feature, ground_level) in enumerate(zip(source_features, ground_levels)):
        properties = source_feature.get("properties") or {}
        features.append(build_output_feature(
            index, source_feature,
            levels_from_properties(dataset, properties, additional_levels),
            ground_level,
            properties.get(dataset.label_field) if dataset.label_field else None,
            dataset.design_level_key,
            {name: properties.get(name) for name in dataset.extra_fields},
            dataset.simplify_tolerance_degrees))
    return features


def build_footprint_features(dataset: CouncilDataset, source_features: list[dict],
                             additional_levels: dict) -> list[dict]:
    """Output OpenStreetMap buildings, each carrying its parcel's flood levels.

    Buildings outside every mapped parcel are dropped rather than shown as dry:
    no parcel means the flood study does not cover them, which is unknown risk
    rather than no risk.
    """
    source = dataset.footprint_source
    parcel_index = build_parcel_index(source_features)
    print(f"  indexed {len(parcel_index.parcels)} parcels")

    with create_client() as client:
        print("  fetching OpenStreetMap building footprints:")
        footprints = fetch_openstreetmap_buildings(
            client, bounding_box=source.bounding_box,
            administrative_area=source.administrative_area)
        print(f"    {len(footprints)} footprints")

        matched = []
        for footprint in footprints:
            point = representative_point(footprint["geometry"])
            if not point:
                continue
            parcel = parcel_index.find(point[0], point[1])
            if parcel is None:
                continue
            matched.append((footprint, point, parcel))
        print(f"    {len(matched)} sit inside a mapped parcel "
              f"({len(footprints) - len(matched)} outside the study, dropped)")

        ground_levels = load_cached_ground_levels(
            f"{dataset.council_id}_footprints", len(matched))
        if ground_levels is None and dataset.elevation_source:
            print(f"  sampling ground from {dataset.elevation_source.name}:")
            ground_levels = sample_ground_levels(
                client, dataset.elevation_source, [point for _, point, _ in matched])
            save_cached_ground_levels(f"{dataset.council_id}_footprints", ground_levels)
        elif ground_levels is None:
            ground_levels = [None] * len(matched)

    features = []
    for index, ((footprint, _point, parcel), ground_level) in enumerate(
            zip(matched, ground_levels)):
        parcel_properties = parcel["properties"]
        tags = footprint["properties"]["tags"]
        # Prefer the council's own address, which is authoritative, over the
        # OpenStreetMap tags.
        address = (parcel_properties.get(dataset.label_field)
                   if dataset.label_field else None) or openstreetmap_address(tags)
        feature = build_output_feature(
            index, footprint,
            levels_from_properties(dataset, parcel_properties, additional_levels),
            ground_level, address, dataset.design_level_key,
            {name: parcel_properties.get(name) for name in dataset.extra_fields},
            dataset.simplify_tolerance_degrees)
        feature["properties"]["height_m"] = round(
            building_height(tags, source.default_height_m), 1)
        features.append(feature)
    return features


def build_features_from_spatial_join(dataset: CouncilDataset) -> list[dict]:
    """Output OpenStreetMap buildings, each sampled from the council's surfaces.

    For councils that publish every flood event as its own polygon surface. The
    surfaces share no key, so each is sampled at the building's location.
    """
    source = dataset.footprint_source
    server = dataset.layer_url.rsplit("/", 1)[0]

    with create_client() as client:
        print("  fetching OpenStreetMap building footprints:")
        footprints = fetch_openstreetmap_buildings(
            client, bounding_box=source.bounding_box,
            administrative_area=source.administrative_area)
        print(f"    {len(footprints)} footprints")

        located = []
        for footprint in footprints:
            point = representative_point(footprint["geometry"])
            if point:
                located.append((footprint, point))
        point_index = PointIndex([point for _, point in located])

        sampled: dict[str, dict] = {}
        for join in dataset.spatial_join_layers:
            print(f"  sampling layer {join.layer_id} ({join.source_field}):")
            cached = load_cached_spatial_join(
                dataset.council_id, join.canonical_key, len(located))
            if cached is not None:
                sampled[join.canonical_key] = cached
                continue
            values = sample_layer_at_points(
                client, f"{server}/{join.layer_id}", join.source_field, point_index)
            save_cached_spatial_join(
                dataset.council_id, join.canonical_key, len(located), values)
            sampled[join.canonical_key] = values

        ground_levels = load_cached_ground_levels(
            f"{dataset.council_id}_footprints", len(located))
        if ground_levels is None and dataset.elevation_source:
            print(f"  sampling ground from {dataset.elevation_source.name}:")
            ground_levels = sample_ground_levels(
                client, dataset.elevation_source, [point for _, point in located])
            save_cached_ground_levels(f"{dataset.council_id}_footprints", ground_levels)
        elif ground_levels is None:
            ground_levels = [None] * len(located)

    # Keep only buildings the flood study actually covers. A building with no
    # value is outside the mapped area, which is unknown risk rather than dry.
    design_key = dataset.design_level_key
    features = []
    for index, ((footprint, _point), ground_level) in enumerate(zip(located, ground_levels)):
        levels = coerce_measurements(
            {key: values.get(index) for key, values in sampled.items()})
        if all(value is None for value in levels.values()):
            continue
        tags = footprint["properties"]["tags"]
        feature = build_output_feature(
            len(features), footprint, levels, ground_level,
            openstreetmap_address(tags), design_key, {},
            dataset.simplify_tolerance_degrees)
        feature["properties"]["height_m"] = round(
            building_height(tags, source.default_height_m), 1)
        features.append(feature)

    print(f"  {len(features)} buildings inside the flood study "
          f"({len(located) - len(features)} outside, dropped)")
    return features


def precompute(council_id: str) -> None:
    dataset = DATASETS[council_id]
    output_directory = FRONTEND_PUBLIC_DIRECTORY / "councils" / dataset.council_id
    print(f"\n=== {dataset.label} ({dataset.council_id}) ===")

    level_keys = list(dict.fromkeys(
        list(dataset.level_fields.values())
        + [join.canonical_key for join in dataset.spatial_join_layers]
        + [key for _, _, key in ADDITIONAL_EVENT_LAYERS.get(dataset.council_id, ())]
    ))

    # Councils publishing each event as its own surface need no base layer: the
    # buildings come from OpenStreetMap and every value is sampled beneath them.
    if dataset.spatial_join_layers:
        output_features = build_features_from_spatial_join(dataset)
        if dataset.delivery_mode == "chunked":
            write_chunked(dataset, output_features, level_keys, output_directory)
        else:
            write_single_file(dataset, output_features, level_keys, output_directory)
        print("  counts:", build_counts_by_event(output_features, level_keys)
              .get(dataset.design_level_key))
        return

    with create_client() as client:
        source_features = load_cached_source_features(dataset.council_id)
        if source_features is None:
            print("  base layer:")
            source_features = fetch_all_features(
                client, dataset.layer_url,
                f"{JOIN_FIELD},{dataset.output_fields()}", dataset.where_clause)
            save_cached_source_features(dataset.council_id, source_features)

        additional_levels = collect_additional_levels(client, dataset)

        ground_levels: list[float | None]
        if dataset.ground_field:
            ground_levels = [
                (f.get("properties") or {}).get(dataset.ground_field)
                for f in source_features
            ]
            print(f"  ground level from council field {dataset.ground_field}")
        elif dataset.elevation_source:
            ground_levels = load_cached_ground_levels(dataset.council_id,
                                                      len(source_features))
            if ground_levels is None:
                print(f"  sampling ground from {dataset.elevation_source.name}:")
                points = [representative_point(f.get("geometry") or {}) or (0.0, 0.0)
                          for f in source_features]
                ground_levels = sample_ground_levels(
                    client, dataset.elevation_source, points)
                save_cached_ground_levels(dataset.council_id, ground_levels)
        else:
            ground_levels = [None] * len(source_features)

    if dataset.footprint_source:
        output_features = build_footprint_features(
            dataset, source_features, additional_levels)
    else:
        output_features = build_parcel_features(
            dataset, source_features, ground_levels, additional_levels)

    if dataset.delivery_mode == "chunked":
        write_chunked(dataset, output_features, level_keys, output_directory)
    else:
        write_single_file(dataset, output_features, level_keys, output_directory)

    print("  counts:", build_counts_by_event(output_features, level_keys)
          .get(dataset.design_level_key))


def main() -> None:
    parser = argparse.ArgumentParser(description="Build a council's static map datasets.")
    parser.add_argument("--council", required=True, choices=sorted(DATASETS),
                        help="Which council to build.")
    precompute(parser.parse_args().council)


if __name__ == "__main__":
    main()

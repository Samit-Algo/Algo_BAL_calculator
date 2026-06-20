# This service scans the area around a property for nearby vegetation
# polygons (using SVTM Layer 3, a vector layer), and finds the closest
# hazardous one. This distance feeds into the BAL calculation later.

import math

import httpx
from pyproj import Transformer
from shapely import make_valid
from shapely.geometry import GeometryCollection, MultiPolygon, Polygon, mapping, shape
from shapely.ops import nearest_points, transform as shapely_transform, unary_union

from app.config import settings
from app.services.vegetation_classifier import classify_vegetation

# How long to wait for a response before giving up. The polygon query can be
# slow in densely-vegetated areas, so this is longer than other requests.
REQUEST_TIMEOUT_SECONDS = 20

# How many polygons to request per page. The server caps how many features
# it will return in one go, so very vegetated areas need multiple pages.
PAGE_SIZE = 1000

# Roughly how many metres there are in one degree of latitude. Used to turn
# a metre-based search radius into a degree-based bounding box.
METRES_PER_DEGREE_LATITUDE = 111320

# Converts coordinates from WGS84 (lat/lon, EPSG:4326) to NSW Lambert
# (metres, EPSG:3308) - the same projection we ask SVTM to return polygons in.
_TO_NSW_LAMBERT = Transformer.from_crs("EPSG:4326", "EPSG:3308", always_xy=True)

# The reverse of the above - used to turn the nearest point on a vegetation
# polygon back into lat/lon, so the slope step can look up its elevation.
_TO_WGS84 = Transformer.from_crs("EPSG:3308", "EPSG:4326", always_xy=True)

# The four compass sectors (bearing from the house) we split the assessment
# into, so each side of the property gets its own BAL - matching how AS 3959
# assessors work per-aspect. North wraps around 360/0, so it's handled as a
# special case in _bearing_to_direction below.
#   North = 315-45, East = 45-135, South = 135-225, West = 225-315 degrees.
DIRECTIONS = ("North", "East", "South", "West")

# How many perpendicular transects to run around a drawn site boundary (the
# assessor's T1..Tn). Used in boundary mode only; point mode uses the four
# compass sectors above. Start in the 12-16 range the assessor method uses.
TRANSECT_COUNT = 12


async def find_nearest_vegetation(
    latitude: float,
    longitude: float,
    max_radius_m: int,
    site_polygon: dict | None = None,
) -> dict:
    """
    Search the area around the given point for vegetation polygons, and
    return the nearest one that AS 3959 considers a fire hazard.

    Returns a dict with:
        - vegetation_found (bool): True if a hazardous polygon was found
          within max_radius_m.
        - nearest_distance_m (float | None): distance in metres to the
          nearest hazardous polygon, or None if nothing was found.
        - nearest_svtm_class (str): the SVTM vegetation class of the
          nearest hazardous polygon, or "Not classified" if none found.
        - nearest_as3959_class (str): the AS 3959 class of the nearest
          hazardous polygon, or "Excluded" if none found.
        - nearest_svtm_form (str): the SVTM vegetation formation (vegForm) of
          the nearest hazardous polygon, or "Not classified" if none found.
          This is what the BAL step maps to a PBP formation.
        - nearest_point_latitude (float | None): latitude of the point on the
          nearest polygon closest to the house, or None if none found.
        - nearest_point_longitude (float | None): longitude of that point, or
          None if none found.
        - hazardous_patches (list[dict]): every hazardous polygon found within
          max_radius_m, each as {geometry (GeoJSON lon/lat), distance_m,
          as3959_class, svtm_form, svtm_class, governing}. The patch closest to
          the house has governing=True. Empty when no vegetation is found. This
          is what the map UI draws (see Master Spec section 8).
        - per_direction (dict): one entry per compass sector (North/East/South/
          West), keyed by direction name, each as {direction, vegetation_found,
          nearest_distance_m, nearest_svtm_class, nearest_as3959_class,
          nearest_svtm_form, nearest_point_lat, nearest_point_lon}. Holds the
          NEAREST hazardous patch whose bearing from the house falls in that
          sector, so each side can be rated separately. Directions with no
          hazardous patch get vegetation_found=False. The overall nearest fields
          above remain the single closest patch across all directions.
    """

    features = await _fetch_vegetation_polygons(latitude, longitude, max_radius_m)

    # The geometry we measure vegetation distances FROM. Without a site_polygon
    # this is the single geocoded property point (a degenerate "site"); with one
    # it's the drawn boundary, so distances come from the nearest edge. The scan
    # below is unchanged either way - shapely distance/nearest-point operations
    # work the same for a Point or a Polygon. house_x/house_y are the bearing
    # origin used for compass-sector binning (the point, or the polygon centroid).
    site_geom, house_x, house_y = _build_site_geometry(
        latitude, longitude, site_polygon
    )

    nearest_distance_m = None
    nearest_svtm_class = None
    nearest_as3959_class = None
    nearest_svtm_form = None
    nearest_pct_id = None
    nearest_pct_name = None
    nearest_polygon_part = None

    # Every hazardous polygon within range, collected for the map UI. The one
    # closest to the house is marked governing=True after the loop.
    hazardous_patches = []
    nearest_patch = None

    # The distance to the NEAREST patch the crosswalk could not confidently
    # classify as non-hazardous (Excluded, but flagged manual_review / Low
    # confidence). These never drive the numeric BAL, but if one turns out to be
    # the closest fuel to the site it could be the deciding hazard, so we keep
    # its distance and let the pipeline raise a review flag when warranted
    # (gap-analysis C1; spec safety rules §5 / conservative defaults §11). None
    # when no such uncertain exclusion was found within range.
    low_confidence_excluded_min_distance_m = None

    # The nearest hazardous patch in each compass sector, so each side of the
    # house can be rated separately. Each value is the closest patch's working
    # record (distance, classes, and the 3308 point on it nearest the house),
    # or None if no hazardous patch falls in that sector. Built up in the loop,
    # then turned into the per_direction result after.
    per_direction_best = {direction: None for direction in DIRECTIONS}

    for feature in features:
        attributes = feature["properties"]
        svtm_class = attributes.get("vegClass")

        # Skip vegetation classes that AS 3959 treats as not hazardous
        # (e.g. cleared land, water) - they don't drive the BAL rating.
        classification = classify_vegetation(svtm_class)
        if classification["as3959_class"] == "Excluded":
            # Certain exclusions (water, non-vegetated, confidently non-hazardous)
            # are dropped exactly as before. But when the crosswalk row itself is
            # uncertain about the exclusion - it set manual_review, or rated the
            # call "Low" confidence - the patch must not vanish silently: record
            # how close it sits so the pipeline can flag a review if it's the
            # nearest fuel. It is still NOT added to hazardous_patches, so it
            # never changes the BAL, distance, or which patch governs.
            if classification["manual_review"] or classification["confidence"] == "Low":
                excluded_distance = _patch_distance_to_site(feature["geometry"], site_geom)
                if excluded_distance is not None and excluded_distance <= max_radius_m:
                    if (
                        low_confidence_excluded_min_distance_m is None
                        or excluded_distance < low_confidence_excluded_min_distance_m
                    ):
                        low_confidence_excluded_min_distance_m = round(excluded_distance, 1)
            continue

        polygon_parts = _to_polygon_parts(feature["geometry"])
        if not polygon_parts:
            continue

        closest_part = min(polygon_parts, key=site_geom.distance)
        # The exact point on this patch nearest the site (in 3308 metres) -
        # gives us both the distance and the bearing for sector assignment.
        _, closest_point_3308 = nearest_points(site_geom, closest_part)
        distance_m = site_geom.distance(closest_point_3308)

        # The bounding box we queried is a square, but we only want a true
        # circle of radius max_radius_m, so drop anything further than that.
        if distance_m > max_radius_m:
            continue

        # Bin this patch into its compass sector, and remember it if it's the
        # nearest hazardous patch seen on that side so far.
        direction = _bearing_to_direction(
            _grid_bearing(house_x, house_y, closest_point_3308.x, closest_point_3308.y)
        )
        sector_best = per_direction_best[direction]
        if sector_best is None or distance_m < sector_best["distance_m"]:
            per_direction_best[direction] = {
                "distance_m": distance_m,
                "svtm_class": svtm_class,
                "as3959_class": classification["as3959_class"],
                "svtm_form": attributes.get("vegForm"),
                "point_3308": closest_point_3308,
            }

        # Keep this polygon for the map. Store the whole patch geometry (all
        # parts combined) so the map draws the complete shape, not just the
        # nearest edge. Geometry is reprojected to lon/lat just below.
        # PCTID = the SVTM Plant Community Type id (a vegetation-type id, shared
        # by all patches of the same community); PCTName is its readable name.
        patch = {
            "geometry_3308": unary_union(polygon_parts),
            "distance_m": round(distance_m, 1),
            "as3959_class": classification["as3959_class"],
            "svtm_form": attributes.get("vegForm"),
            "svtm_class": svtm_class,
            "pct_id": attributes.get("PCTID"),
            "pct_name": attributes.get("PCTName"),
            "governing": False,
        }
        hazardous_patches.append(patch)

        if nearest_distance_m is None or distance_m < nearest_distance_m:
            nearest_distance_m = distance_m
            nearest_svtm_class = svtm_class
            nearest_as3959_class = classification["as3959_class"]
            nearest_svtm_form = attributes.get("vegForm")
            nearest_pct_id = attributes.get("PCTID")
            nearest_pct_name = attributes.get("PCTName")
            nearest_polygon_part = closest_part
            nearest_patch = patch

    # Boundary mode only: run perpendicular transects around the drawn site
    # perimeter (T1..Tn), each measuring outward to its nearest hazard - the way
    # an assessor works around the boundary. Built here, while the patches still
    # carry their EPSG:3308 geometry (reprojected away just below). Point mode
    # leaves this None and keeps the four compass sectors untouched.
    transects = None
    if site_polygon is not None:
        transects = _build_transects(
            site_geom, hazardous_patches, max_radius_m, TRANSECT_COUNT
        )

    # Reproject each patch's geometry from NSW Lambert metres (EPSG:3308) back
    # to lon/lat GeoJSON for the frontend, and flag the governing patch.
    for patch in hazardous_patches:
        patch["geometry"] = _polygon_to_wgs84_geojson(patch.pop("geometry_3308"))
    if nearest_patch is not None:
        nearest_patch["governing"] = True

    per_direction = _build_per_direction(per_direction_best)

    if nearest_distance_m is None:
        return {
            "vegetation_found": False,
            "nearest_distance_m": None,
            "nearest_svtm_class": "Not classified",
            "nearest_as3959_class": "Excluded",
            "nearest_svtm_form": "Not classified",
            "nearest_pct_id": None,
            "nearest_pct_name": None,
            "nearest_point_latitude": None,
            "nearest_point_longitude": None,
            "hazardous_patches": [],
            "per_direction": per_direction,
            "transects": transects,
            "low_confidence_excluded_min_distance_m": low_confidence_excluded_min_distance_m,
        }

    # Find the exact point on the nearest polygon's edge closest to the
    # house, then reproject it back to lat/lon for the slope/elevation step.
    _, point_on_polygon = nearest_points(site_geom, nearest_polygon_part)
    nearest_point_longitude, nearest_point_latitude = _TO_WGS84.transform(
        point_on_polygon.x, point_on_polygon.y
    )

    return {
        "vegetation_found": True,
        "nearest_distance_m": round(nearest_distance_m, 1),
        "nearest_svtm_class": nearest_svtm_class,
        "nearest_as3959_class": nearest_as3959_class,
        "nearest_svtm_form": nearest_svtm_form,
        "nearest_pct_id": nearest_pct_id,
        "nearest_pct_name": nearest_pct_name,
        "nearest_point_latitude": nearest_point_latitude,
        "nearest_point_longitude": nearest_point_longitude,
        "hazardous_patches": hazardous_patches,
        "per_direction": per_direction,
        "transects": transects,
        "low_confidence_excluded_min_distance_m": low_confidence_excluded_min_distance_m,
    }


def _build_per_direction(per_direction_best: dict) -> dict:
    """
    Turn the per-sector nearest patches collected during the scan into the
    per_direction result: one entry per compass sector. The nearest point on
    the winning patch is reprojected from NSW Lambert metres (EPSG:3308) back to
    lat/lon so the slope step can look up its elevation. Sectors with no
    hazardous patch get vegetation_found=False (which the BAL step rates
    BAL-LOW for that side).
    """

    per_direction = {}

    for direction in DIRECTIONS:
        best = per_direction_best[direction]

        if best is None:
            per_direction[direction] = {
                "direction": direction,
                "vegetation_found": False,
                "nearest_distance_m": None,
                "nearest_svtm_class": "Not classified",
                "nearest_as3959_class": "Excluded",
                "nearest_svtm_form": "Not classified",
                "nearest_point_lat": None,
                "nearest_point_lon": None,
            }
            continue

        point_lon, point_lat = _TO_WGS84.transform(
            best["point_3308"].x, best["point_3308"].y
        )
        per_direction[direction] = {
            "direction": direction,
            "vegetation_found": True,
            "nearest_distance_m": round(best["distance_m"], 1),
            "nearest_svtm_class": best["svtm_class"],
            "nearest_as3959_class": best["as3959_class"],
            "nearest_svtm_form": best["svtm_form"],
            "nearest_point_lat": point_lat,
            "nearest_point_lon": point_lon,
        }

    return per_direction


def _build_transects(site_geom, hazardous_patches: list, max_radius_m: int, count: int) -> list:
    """
    Run perpendicular transects around the drawn site boundary, each finding the
    nearest hazardous patch lying OUTWARD from its boundary point. Each transect
    is shaped like a _build_per_direction entry - same keys - so the pipeline
    rates it with the exact same per-side logic, and the existing worst-side
    max() picks the governing transect.

    Two kinds of transect, all returned in one list:
      - `count` EVEN transects (T01..Tn), spaced by equal arc length around the
        perimeter - the assessor's T1..Tn walk.
      - one SNAPPED transect per patch (S01..Sk), placed at that patch's exact
        nearest boundary point. The even walk can step over the single closest
        edge-to-hazard point between samples and under-rate a side; the snapped
        transects guarantee that exact worst edge is always measured. They are
        ADDITIONAL to the even ones, so adding them can only keep a side's rating
        the same or make it worse (the worst transect governs), never better.

    All geometry is in NSW Lambert metres (EPSG:3308). This runs before the
    patches' 'geometry_3308' is reprojected away, so it can measure against it.
    Each transect dict adds, on top of the per_direction keys:
        - outward_bearing (deg from grid north) and outward_direction (the
          compass sector that bearing falls in), describing which way it looks.
        - transect_point_lat/lon: the boundary point itself, so the slope step
          can anchor at the perimeter rather than the property centre.
    """

    boundary = site_geom.boundary
    total_length = boundary.length
    centroid = site_geom.centroid
    transects = []

    # Even-spaced transects: sample at the midpoint of each equal arc-length step
    # so points sit on edges rather than bunching at the polygon's corners.
    for i in range(count):
        sample = boundary.interpolate((i + 0.5) / count * total_length)
        outward_bearing = _grid_bearing(centroid.x, centroid.y, sample.x, sample.y)
        best = _nearest_outward_patch(sample, outward_bearing, hazardous_patches, max_radius_m)
        transects.append(
            _transect_record(f"T{i + 1:02d}", sample, outward_bearing, best)
        )

    # Snapped transects: one per patch, at the exact nearest boundary point, so
    # the single closest edge-to-hazard distance is never lost between samples.
    for j, patch in enumerate(hazardous_patches, start=1):
        boundary_point, patch_point = nearest_points(boundary, patch["geometry_3308"])
        distance_m = boundary_point.distance(patch_point)
        if distance_m > max_radius_m:
            continue
        outward_bearing = _grid_bearing(
            centroid.x, centroid.y, boundary_point.x, boundary_point.y
        )
        transects.append(
            _transect_record(
                f"S{j:02d}",
                boundary_point,
                outward_bearing,
                (distance_m, patch_point, patch),
            )
        )

    return transects


def _nearest_outward_patch(sample, outward_bearing, hazardous_patches, max_radius_m):
    """
    From a boundary point, find the nearest hazardous patch lying OUTWARD (within
    90 degrees of the outward bearing), so a transect can't be governed by
    vegetation across the lot. Returns (distance_m, nearest_point_3308, patch),
    or None if nothing hazardous is outward within range.
    """

    best = None
    for patch in hazardous_patches:
        _, nearest_point = nearest_points(sample, patch["geometry_3308"])
        distance_m = sample.distance(nearest_point)
        if distance_m > max_radius_m:
            continue
        bearing_to_patch = _grid_bearing(
            sample.x, sample.y, nearest_point.x, nearest_point.y
        )
        if _angular_difference(bearing_to_patch, outward_bearing) > 90:
            continue
        if best is None or distance_m < best[0]:
            best = (distance_m, nearest_point, patch)
    return best


def _transect_record(label, sample, outward_bearing, best):
    """
    Build one transect dict (per_direction-shaped) for a boundary point. `best`
    is (distance_m, nearest_point_3308, patch) or None when no hazard is in range.
    """

    sample_lon, sample_lat = _TO_WGS84.transform(sample.x, sample.y)
    record = {
        "direction": label,
        "outward_bearing": round(outward_bearing, 1),
        "outward_direction": _bearing_to_direction(outward_bearing),
        "transect_point_lat": sample_lat,
        "transect_point_lon": sample_lon,
    }

    if best is None:
        record.update(
            {
                "vegetation_found": False,
                "nearest_distance_m": None,
                "nearest_svtm_class": "Not classified",
                "nearest_as3959_class": "Excluded",
                "nearest_svtm_form": "Not classified",
                "nearest_point_lat": None,
                "nearest_point_lon": None,
            }
        )
    else:
        distance_m, nearest_point, patch = best
        veg_lon, veg_lat = _TO_WGS84.transform(nearest_point.x, nearest_point.y)
        record.update(
            {
                "vegetation_found": True,
                "nearest_distance_m": round(distance_m, 1),
                "nearest_svtm_class": patch["svtm_class"],
                "nearest_as3959_class": patch["as3959_class"],
                "nearest_svtm_form": patch["svtm_form"],
                "nearest_point_lat": veg_lat,
                "nearest_point_lon": veg_lon,
            }
        )

    return record


def _angular_difference(a: float, b: float) -> float:
    """Smallest absolute difference between two bearings, in [0, 180] degrees."""

    diff = abs(a - b) % 360
    return diff if diff <= 180 else 360 - diff


def _build_site_geometry(latitude: float, longitude: float, site_polygon: dict | None = None):
    """
    Build the "site" geometry that vegetation distances are measured FROM,
    projected into NSW Lambert metres (EPSG:3308) so distances come out in
    metres.

    Without a site_polygon the site is a single point - the geocoded property
    location - so this returns a degenerate point site (the original behaviour).
    With a site_polygon (a GeoJSON Polygon in WGS84 lon/lat, or a Feature
    wrapping one) the site is that drawn boundary, so distances are measured from
    its nearest edge. The scan in find_nearest_vegetation needs no change either
    way, because shapely's .distance() and nearest_points() work the same for a
    Point or a Polygon.

    Returns (site_geom, origin_x, origin_y):
        - site_geom: the EPSG:3308 geometry distances are measured from.
        - origin_x, origin_y: the single point used as the bearing origin for
          binning patches into compass sectors - the geocoded point, or the
          polygon's centroid. Returned separately because a polygon site keeps
          one bearing origin even though its distances come from the whole edge.
    """

    if site_polygon is not None:
        site_geom = _site_polygon_to_3308(site_polygon)
        centroid = site_geom.centroid
        return site_geom, centroid.x, centroid.y

    x, y = _TO_NSW_LAMBERT.transform(longitude, latitude)
    site_geom = shape({"type": "Point", "coordinates": [x, y]})
    return site_geom, x, y


def _site_polygon_to_3308(site_polygon: dict):
    """
    Turn a user-drawn site boundary (GeoJSON Polygon in WGS84 lon/lat, or a
    Feature wrapping one) into a valid shapely polygon in NSW Lambert metres
    (EPSG:3308), the same system the vegetation patches are measured in.
    """

    # Accept either a bare geometry or a Feature with a "geometry" member.
    geometry = site_polygon.get("geometry", site_polygon)
    polygon_wgs84 = shape(geometry)

    if not polygon_wgs84.is_valid:
        polygon_wgs84 = make_valid(polygon_wgs84)

    # always_xy=True means the transformer takes (lon, lat) - the order GeoJSON
    # coordinates already use - so shapely_transform maps them directly.
    return shapely_transform(_TO_NSW_LAMBERT.transform, polygon_wgs84)


def _grid_bearing(x0: float, y0: float, x1: float, y1: float) -> float:
    """
    Bearing (degrees clockwise from grid north, in [0, 360)) from one point to
    another in NSW Lambert metres (EPSG:3308). Grid north in EPSG:3308 is close
    enough to true north for binning patches into 90-degree compass sectors.
    """

    return math.degrees(math.atan2(x1 - x0, y1 - y0)) % 360


def _bearing_to_direction(bearing: float) -> str:
    """
    Map a compass bearing to its sector: North = 315-45, East = 45-135,
    South = 135-225, West = 225-315 degrees. North wraps around 0/360.
    """

    if bearing >= 315 or bearing < 45:
        return "North"
    if bearing < 135:
        return "East"
    if bearing < 225:
        return "South"
    return "West"


def _polygon_to_wgs84_geojson(geometry) -> dict:
    """
    Reproject a shapely polygon from NSW Lambert metres (EPSG:3308) back to
    WGS84 lon/lat (EPSG:4326) and return it as a GeoJSON Polygon/MultiPolygon
    dict (coordinates in lon/lat order, as GeoJSON expects).
    """

    geometry_wgs84 = shapely_transform(_TO_WGS84.transform, geometry)
    return mapping(geometry_wgs84)


async def _fetch_vegetation_polygons(latitude: float, longitude: float, max_radius_m: int) -> list:
    """
    Query SVTM Layer 3 for all vegetation polygons inside a bounding box
    around the given point, paging through results if there are more than
    one page's worth.
    """

    # Turn the search radius (metres) into a bounding box (degrees). Longitude
    # degrees get narrower further from the equator, so we adjust using the
    # point's latitude.
    lat_offset = max_radius_m / METRES_PER_DEGREE_LATITUDE
    lon_offset = max_radius_m / (METRES_PER_DEGREE_LATITUDE * math.cos(math.radians(latitude)))

    min_x = longitude - lon_offset
    min_y = latitude - lat_offset
    max_x = longitude + lon_offset
    max_y = latitude + lat_offset

    base_params = {
        "geometry": f"{min_x},{min_y},{max_x},{max_y}",
        "geometryType": "esriGeometryEnvelope",
        "inSR": 4326,
        # Ask for polygons back in NSW Lambert metres, so we can measure
        # distances directly without reprojecting every polygon.
        "outSR": 3308,
        "spatialRel": "esriSpatialRelIntersects",
        # PCTID 0 means "Not classified" (cleared/urban land) - skip it.
        "where": "PCTID<>0",
        "outFields": "vegClass,vegForm,PCTName,PCTID",
        "returnGeometry": "true",
        "orderByFields": "OBJECTID",
        "resultRecordCount": PAGE_SIZE,
        "f": "geojson",
    }

    all_features = []

    async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS) as client:
        offset = 0
        while True:
            params = {**base_params, "resultOffset": offset}
            response = await client.get(settings.SVTM_POLYGON_QUERY_URL, params=params)

            if response.status_code != 200:
                raise RuntimeError(
                    f"SVTM polygon query failed with status "
                    f"{response.status_code}: {response.text}"
                )

            data = response.json()
            page_features = data.get("features", [])
            all_features.extend(page_features)

            # If the server says it had more results than it returned, and we
            # actually got a full page, ask for the next page. Otherwise stop -
            # this is what lets dense bushland (1000+ polygons) load fully.
            if data.get("exceededTransferLimit") and page_features:
                offset += PAGE_SIZE
                continue

            break

    return all_features


def _patch_distance_to_site(geojson_geometry: dict, site_geom) -> float | None:
    """
    Shortest distance (EPSG:3308 metres) from the site geometry to a patch's
    polygon parts, or None if the geometry has no usable polygon. Mirrors the
    hazard-distance measurement so a low-confidence exclusion is compared on the
    exact same footing as the kept hazards.
    """

    polygon_parts = _to_polygon_parts(geojson_geometry)
    if not polygon_parts:
        return None
    closest_part = min(polygon_parts, key=site_geom.distance)
    return site_geom.distance(closest_part)


def _to_polygon_parts(geojson_geometry: dict) -> list:
    """
    Turn a GeoJSON geometry into a list of Polygon/MultiPolygon pieces we can
    measure distances against, fixing invalid geometry and dropping any
    point/line parts that make_valid() can introduce.
    """

    geometry = shape(geojson_geometry)

    if not geometry.is_valid:
        geometry = make_valid(geometry)

    return _flatten_polygonal(geometry)


def _flatten_polygonal(geometry) -> list:
    """Recursively collect only the Polygon/MultiPolygon parts of a geometry."""

    if isinstance(geometry, (Polygon, MultiPolygon)):
        return [geometry]

    if isinstance(geometry, GeometryCollection):
        parts = []
        for part in geometry.geoms:
            parts.extend(_flatten_polygonal(part))
        return parts

    return []

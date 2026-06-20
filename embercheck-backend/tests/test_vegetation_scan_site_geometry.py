# Characterization test for find_nearest_vegetation's output, locking the scan's
# behaviour around the "site geometry" seam (_build_site_geometry). Today the
# site is a single point; a future boundary mode will return a polygon from that
# helper. This test pins distances, directions and the per_direction shape so
# that change can't silently drift the output.
#
# Runs offline: _fetch_vegetation_polygons is stubbed with fixed polygons in
# EPSG:3308 metres (the same SR the real query returns via outSR=3308), placed
# at known metre offsets from the projected site origin.
#
# Run standalone:  .venv/Scripts/python.exe -m tests.test_vegetation_scan_site_geometry
# Or with pytest:  pytest tests/test_vegetation_scan_site_geometry.py

import asyncio

import app.services.vegetation_scan as vegetation_scan
from app.services.vegetation_scan import (
    find_nearest_vegetation,
    _TO_NSW_LAMBERT,
    _TO_WGS84,
)

# A fixed NSW point to assess from. Its EPSG:3308 projection is the site origin
# every offset below is measured against.
SITE_LAT = -33.87
SITE_LON = 151.21
ORIGIN_X, ORIGIN_Y = _TO_NSW_LAMBERT.transform(SITE_LON, SITE_LAT)


def _square(cx, cy, half=5.0):
    """A small square polygon (GeoJSON, EPSG:3308 metres) centred on (cx, cy)."""
    return {
        "type": "Polygon",
        "coordinates": [
            [
                [cx - half, cy - half],
                [cx + half, cy - half],
                [cx + half, cy + half],
                [cx - half, cy + half],
                [cx - half, cy - half],
            ]
        ],
    }


def _feature(geometry, *, veg_class, veg_form, pct_id, pct_name):
    return {
        "type": "Feature",
        "geometry": geometry,
        "properties": {
            "vegClass": veg_class,
            "vegForm": veg_form,
            "PCTID": pct_id,
            "PCTName": pct_name,
        },
    }


# Two hazardous patches (unknown vegClass -> classify_vegetation falls back to
# "Forest"): one ~50 m due EAST, its nearest edge at easting +50 (northing
# spans the origin, so the closest point sits at dy=0 -> East); one ~80 m due
# NORTH, nearest edge at northing +80.
FAKE_FEATURES = [
    _feature(
        _square(ORIGIN_X + 55.0, ORIGIN_Y),  # easting 50..60 -> nearest edge 50
        veg_class="Synthetic Forest A",
        veg_form="Wet Sclerophyll Forest",
        pct_id=1234,
        pct_name="Synthetic PCT A",
    ),
    _feature(
        _square(ORIGIN_X, ORIGIN_Y + 85.0),  # northing 80..90 -> nearest edge 80
        veg_class="Synthetic Forest B",
        veg_form="Wet Sclerophyll Forest",
        pct_id=5678,
        pct_name="Synthetic PCT B",
    ),
]


def _run_scan(features, site_polygon=None):
    """Call find_nearest_vegetation with _fetch_vegetation_polygons stubbed."""

    async def fake_fetch(latitude, longitude, max_radius_m):
        return features

    original = vegetation_scan._fetch_vegetation_polygons
    vegetation_scan._fetch_vegetation_polygons = fake_fetch
    try:
        return asyncio.run(
            find_nearest_vegetation(SITE_LAT, SITE_LON, 150, site_polygon=site_polygon)
        )
    finally:
        vegetation_scan._fetch_vegetation_polygons = original


def _site_square_geojson(half_m):
    """A square site boundary of the given half-width (metres) centred on the
    site origin, returned as a WGS84 GeoJSON Polygon (lon/lat). Built in EPSG:3308
    around ORIGIN, then reprojected back so the scan can reproject it forward -
    a faithful round-trip of what a drawn polygon goes through."""
    corners_3308 = [
        (ORIGIN_X - half_m, ORIGIN_Y - half_m),
        (ORIGIN_X + half_m, ORIGIN_Y - half_m),
        (ORIGIN_X + half_m, ORIGIN_Y + half_m),
        (ORIGIN_X - half_m, ORIGIN_Y + half_m),
        (ORIGIN_X - half_m, ORIGIN_Y - half_m),
    ]
    ring = [list(_TO_WGS84.transform(x, y)) for x, y in corners_3308]
    return {"type": "Polygon", "coordinates": [ring]}


def test_nearest_is_the_east_patch_at_50m():
    """The east patch (50 m) is nearer than the north patch (80 m) and governs."""
    result = _run_scan(FAKE_FEATURES)

    assert result["vegetation_found"] is True
    assert result["nearest_distance_m"] == 50.0
    assert result["nearest_as3959_class"] == "Forest"  # unknown -> Forest fallback
    assert result["nearest_pct_id"] == 1234

    # Both patches are kept for the map; exactly one is the governing (nearest).
    assert len(result["hazardous_patches"]) == 2
    governing = [p for p in result["hazardous_patches"] if p["governing"]]
    assert len(governing) == 1
    assert governing[0]["distance_m"] == 50.0


def test_per_direction_bins_each_patch_to_its_side():
    """East and North each carry their patch; South and West stay empty."""
    per_direction = _run_scan(FAKE_FEATURES)["per_direction"]

    assert per_direction["East"]["vegetation_found"] is True
    assert per_direction["East"]["nearest_distance_m"] == 50.0

    assert per_direction["North"]["vegetation_found"] is True
    assert per_direction["North"]["nearest_distance_m"] == 80.0

    assert per_direction["South"]["vegetation_found"] is False
    assert per_direction["West"]["vegetation_found"] is False


def test_no_features_reports_nothing_found():
    """An empty scan reports no vegetation and an all-empty per_direction."""
    result = _run_scan([])

    assert result["vegetation_found"] is False
    assert result["nearest_distance_m"] is None
    assert result["hazardous_patches"] == []
    assert all(
        not side["vegetation_found"] for side in result["per_direction"].values()
    )


def test_boundary_edge_is_closer_than_the_point():
    """(a) With a drawn site boundary, the distance to the SAME patch is measured
    from the nearest edge, so it is strictly smaller than the point-mode distance.
    A 20 m half-width square moves the east edge 20 m towards the east patch, so
    50 m (point) becomes ~30 m (edge)."""
    point = _run_scan(FAKE_FEATURES)
    boundary = _run_scan(FAKE_FEATURES, site_polygon=_site_square_geojson(20.0))

    # Same governing patch (the east one), measured edge-to-veg instead of
    # point-to-veg -> strictly closer.
    assert boundary["nearest_pct_id"] == point["nearest_pct_id"] == 1234
    assert boundary["nearest_distance_m"] < point["nearest_distance_m"]
    assert abs(boundary["nearest_distance_m"] - 30.0) < 0.5  # 50 - 20 m edge

    # Every side with vegetation is closer from the edge than from the point.
    for direction in ("East", "North"):
        pd_point = point["per_direction"][direction]["nearest_distance_m"]
        pd_edge = boundary["per_direction"][direction]["nearest_distance_m"]
        assert pd_edge < pd_point, direction
    assert abs(boundary["per_direction"]["North"]["nearest_distance_m"] - 60.0) < 0.5


def test_absent_polygon_matches_point_mode():
    """(b) Passing site_polygon=None is byte-identical to the point-mode path -
    the boundary feature is purely additive."""
    explicit_none = _run_scan(FAKE_FEATURES, site_polygon=None)
    default = _run_scan(FAKE_FEATURES)
    assert explicit_none == default


if __name__ == "__main__":
    tests = [
        ("nearest is the east patch at 50 m", test_nearest_is_the_east_patch_at_50m),
        ("per_direction bins each patch to its side", test_per_direction_bins_each_patch_to_its_side),
        ("no features -> nothing found", test_no_features_reports_nothing_found),
        ("boundary edge is closer than the point", test_boundary_edge_is_closer_than_the_point),
        ("absent polygon matches point mode", test_absent_polygon_matches_point_mode),
    ]
    failures = 0
    for name, fn in tests:
        try:
            fn()
            print(f"PASS  {name}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL  {name}: {error}")
    print()
    print("All passed" if failures == 0 else f"{failures} failure(s)")
    raise SystemExit(1 if failures else 0)

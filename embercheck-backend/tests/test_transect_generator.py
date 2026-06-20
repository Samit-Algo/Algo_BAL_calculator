# Unit tests for the perimeter transect generator (_build_transects), used in
# boundary mode to replace the four fixed compass sectors. Works on a simple
# square site so the geometry is easy to reason about: count, even spacing
# around the perimeter, correct OUTWARD normals, and that a patch off one side
# is found by a transect looking that way (and not from across the site).
#
# The generator measures in EPSG:3308 metres but returns sample points as
# WGS84 lon/lat, so the square is built at a real NSW 3308 origin and the
# returned points are reprojected back to 3308 for the geometric checks - which
# also exercises the round-trip.
#
# Run standalone:  .venv/Scripts/python.exe -m tests.test_transect_generator
# Or with pytest:  pytest tests/test_transect_generator.py

from math import cos, radians, sin

from shapely.geometry import Point, box

from app.services.vegetation_scan import (
    _build_transects,
    _angular_difference,
    _TO_NSW_LAMBERT,
)

# A real NSW point, projected to EPSG:3308 metres, as the centre of a 100 m x
# 100 m square site. Real coordinates so the lon/lat round-trip is meaningful.
ORIGIN_X, ORIGIN_Y = _TO_NSW_LAMBERT.transform(150.81667187, -33.98750183)
HALF = 50.0
SITE = box(ORIGIN_X - HALF, ORIGIN_Y - HALF, ORIGIN_X + HALF, ORIGIN_Y + HALF)


def _patch(geometry):
    """A hazardous patch as the scan holds it pre-reprojection: geometry_3308
    plus the class fields _build_transects copies onto each transect."""
    return {
        "geometry_3308": geometry,
        "svtm_class": "Synthetic Forest",
        "as3959_class": "Forest",
        "svtm_form": "Wet Sclerophyll Forest",
    }


# One hazardous patch ~30 m due EAST of the site's east edge (east edge at
# ORIGIN_X+50; patch spans ORIGIN_X+80..+90), centred on the origin's northing.
EAST_PATCH = _patch(box(ORIGIN_X + 80.0, ORIGIN_Y - 5.0, ORIGIN_X + 90.0, ORIGIN_Y + 5.0))


def _sample_3308(transect):
    """Reproject a transect's returned WGS84 sample point back to EPSG:3308."""
    x, y = _TO_NSW_LAMBERT.transform(
        transect["transect_point_lon"], transect["transect_point_lat"]
    )
    return Point(x, y)


def _even(transects):
    """The evenly-spaced transects (T-labelled)."""
    return [t for t in transects if t["direction"].startswith("T")]


def _snapped(transects):
    """The per-patch snapped transects (S-labelled)."""
    return [t for t in transects if t["direction"].startswith("S")]


def test_count_and_labels():
    """`count` even transects labelled T01..Tn, plus one snapped transect per
    in-range patch (here one east patch -> S01)."""
    transects = _build_transects(SITE, [EAST_PATCH], max_radius_m=150, count=12)

    even = _even(transects)
    snapped = _snapped(transects)
    assert [t["direction"] for t in even] == [f"T{i:02d}" for i in range(1, 13)]
    assert [t["direction"] for t in snapped] == ["S01"]
    assert len(transects) == 13


def test_points_lie_on_the_boundary():
    """Every sample point - even and snapped - sits on the site perimeter."""
    transects = _build_transects(SITE, [EAST_PATCH], max_radius_m=150, count=12)

    for t in transects:
        assert SITE.boundary.distance(_sample_3308(t)) < 0.1, t["direction"]


def test_even_spacing_around_the_perimeter():
    """The even transects are evenly spaced by arc length: each sits one 1/count
    step along the 400 m perimeter (~33.3 m), covering all four sides."""
    transects = _even(_build_transects(SITE, [EAST_PATCH], max_radius_m=150, count=12))

    boundary = SITE.boundary
    perimeter = boundary.length  # 400 m
    for i, t in enumerate(transects):
        expected = (i + 0.5) / 12 * perimeter
        assert abs(boundary.project(_sample_3308(t)) - expected) < 0.5, t["direction"]

    assert {t["outward_direction"] for t in transects} == {"North", "East", "South", "West"}


def test_outward_normals_point_out_of_the_polygon():
    """Each transect's outward bearing genuinely leaves the polygon: a 1 m step
    OUT lands outside the site, a 1 m step IN lands inside."""
    transects = _build_transects(SITE, [EAST_PATCH], max_radius_m=150, count=12)

    for t in transects:
        p = _sample_3308(t)
        b = radians(t["outward_bearing"])
        # Grid bearing: dx = sin(b), dy = cos(b).
        out = Point(p.x + sin(b), p.y + cos(b))
        inn = Point(p.x - sin(b), p.y - cos(b))
        assert not SITE.contains(out), f"{t['direction']} outward step stayed inside"
        assert SITE.contains(inn), f"{t['direction']} inward step left the site"


def test_east_patch_found_only_from_the_east_side():
    """The east patch is picked up by east-looking transects (edge-anchored
    distance < the ~80 m centre-to-patch gap) and never by transects looking the
    other way - the outward filter stops a far side measuring across the lot."""
    transects = _build_transects(SITE, [EAST_PATCH], max_radius_m=150, count=12)

    found = [t for t in transects if t["vegetation_found"]]
    assert found, "the east patch should be found by at least one transect"
    for t in found:
        assert _angular_difference(t["outward_bearing"], 90.0) <= 90.0
        assert t["nearest_distance_m"] < 80.0
        assert t["nearest_as3959_class"] == "Forest"

    west = [t for t in transects if _angular_difference(t["outward_bearing"], 270.0) < 45]
    assert west, "sanity: the square has west-facing transects"
    assert all(not t["vegetation_found"] for t in west)


def test_empty_patches_gives_all_unrated_transects():
    """No patches -> no snapped transects, and every even transect reports no
    vegetation (BAL-LOW downstream)."""
    transects = _build_transects(SITE, [], max_radius_m=150, count=12)

    assert len(transects) == 12  # 12 even, 0 snapped
    assert all(t["vegetation_found"] is False for t in transects)
    assert all(t["nearest_distance_m"] is None for t in transects)


def test_snapped_transect_recovers_distance_missed_between_samples():
    """The pin: a patch whose true nearest boundary point (y=+20) sits BETWEEN
    the east even transects (which sit at y=0 and y=+33.3). The even walk steps
    over the closest point and over-reports the distance; the snapped transect
    recovers the exact, closer edge-to-patch distance (~20 m)."""
    # Patch just east of the edge (x=50), centred at northing +20.
    patch = _patch(box(ORIGIN_X + 70.0, ORIGIN_Y + 20.0, ORIGIN_X + 80.0, ORIGIN_Y + 21.0))
    transects = _build_transects(SITE, [patch], max_radius_m=150, count=12)

    snapped = _snapped(transects)
    assert len(snapped) == 1
    snap = snapped[0]
    assert snap["vegetation_found"] is True
    assert snap["outward_direction"] == "East"
    # The exact nearest edge-to-patch distance: edge x=50 to patch x=70 = 20 m.
    assert abs(snap["nearest_distance_m"] - 20.0) < 0.5

    # Every even transect that sees the patch over-reports (it sampled past the
    # nearest point), so the snap is strictly closer than the best even one.
    even_found = [t["nearest_distance_m"] for t in _even(transects) if t["vegetation_found"]]
    assert even_found, "sanity: at least one even transect sees the patch"
    assert snap["nearest_distance_m"] < min(even_found)


if __name__ == "__main__":
    tests = [
        ("count + labels", test_count_and_labels),
        ("points on boundary", test_points_lie_on_the_boundary),
        ("even spacing, all sides", test_even_spacing_around_the_perimeter),
        ("outward normals point out", test_outward_normals_point_out_of_the_polygon),
        ("east patch found only from east", test_east_patch_found_only_from_the_east_side),
        ("empty patches -> all unrated", test_empty_patches_gives_all_unrated_transects),
        ("snapped transect recovers missed distance", test_snapped_transect_recovers_distance_missed_between_samples),
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

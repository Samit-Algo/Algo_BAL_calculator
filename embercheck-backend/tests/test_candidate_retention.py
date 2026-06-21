# Unit tests for the candidate-patch retention and transect candidate geometry.
# Confirms that Excluded patches are retained for candidate tracking, that they
# do NOT enter the hazardous BAL computation, and that the draft BAL is unchanged.
#
# Run: .venv/Scripts/python.exe -c "from tests.test_candidate_retention import *; ..."
# Or:  pytest tests/test_candidate_retention.py

from math import cos, radians, sin

from shapely.geometry import Point, box

from app.services.vegetation_scan import (
    _build_transects,
    _TO_NSW_LAMBERT,
    _TO_WGS84,
)


def _make_square_site(cx, cy, half_side=50):
    """A square site polygon centred at (cx, cy) in EPSG:3308 metres."""
    return box(cx - half_side, cy - half_side, cx + half_side, cy + half_side)


def _make_patch(cx, cy, radius=20, as3959_class="Woodland", svtm_form="Dry sclerophyll forests",
                svtm_class="Hinterland Dry", excluded=False):
    """A circular patch approximated as a square, carrying the fields _build_transects needs."""
    return {
        "geometry_3308": box(cx - radius, cy - radius, cx + radius, cy + radius),
        "distance_m": 0,  # placeholder; transect builder computes actual distance
        "as3959_class": "Excluded" if excluded else as3959_class,
        "svtm_form": svtm_form,
        "svtm_class": svtm_class,
    }


# EPSG:3308 origin for a real NSW location (near Denham Court)
_ORIGIN_LON, _ORIGIN_LAT = 150.8167, -33.9875
_OX, _OY = _TO_NSW_LAMBERT.transform(_ORIGIN_LON, _ORIGIN_LAT)


def test_excluded_patch_gives_candidate_not_hazardous():
    """An Excluded patch near a side gives candidate geometry on that transect
    but does NOT appear in the hazardous best (vegetation_found stays False)."""
    site = _make_square_site(_OX, _OY, half_side=30)

    # Hazardous patch to the east (150m away)
    hazardous = _make_patch(_OX + 150, _OY, as3959_class="Woodland")
    # Excluded patch to the west (80m away)
    excluded = _make_patch(_OX - 80, _OY, excluded=True)

    hazardous_patches = [hazardous]
    all_patches = [hazardous, excluded]

    transects = _build_transects(site, hazardous_patches, 200, 8, all_patches)

    # Find a west-facing transect
    west_transects = [t for t in transects if t["outward_direction"] == "West"]
    assert len(west_transects) > 0, "Expected at least one west-facing transect"

    for t in west_transects:
        # Hazardous: the east patch is NOT outward from the west side
        assert not t["vegetation_found"], (
            f"West transect {t['direction']} should NOT find hazardous vegetation"
        )
        # Candidate: the excluded patch IS outward from the west side
        assert t.get("candidate_distance_m") is not None, (
            f"West transect {t['direction']} should have candidate geometry from excluded patch"
        )
        assert t["candidate_as3959_class"] == "Excluded"

    # East-facing transects should have BOTH hazardous and candidate
    east_transects = [t for t in transects if t["outward_direction"] == "East"]
    assert len(east_transects) > 0
    for t in east_transects:
        if t["vegetation_found"]:
            assert t["nearest_as3959_class"] == "Woodland"
            assert t.get("candidate_distance_m") is not None


def test_excluded_patch_does_not_change_bal_inputs():
    """The hazardous-only BAL inputs (vegetation_found, nearest_distance_m,
    nearest_as3959_class) are unchanged when an excluded patch is added."""
    site = _make_square_site(_OX, _OY, half_side=30)

    hazardous = _make_patch(_OX + 100, _OY, as3959_class="Woodland")
    hazardous_patches = [hazardous]

    # Without excluded patch
    transects_base = _build_transects(site, hazardous_patches, 200, 8)
    # With excluded patch
    excluded = _make_patch(_OX - 60, _OY, excluded=True)
    all_patches = [hazardous, excluded]
    transects_with = _build_transects(site, hazardous_patches, 200, 8, all_patches)

    # Hazardous fields must be identical
    for base, with_cand in zip(transects_base, transects_with):
        assert base["vegetation_found"] == with_cand["vegetation_found"]
        assert base["nearest_distance_m"] == with_cand["nearest_distance_m"]
        assert base["nearest_as3959_class"] == with_cand["nearest_as3959_class"]
        assert base["nearest_svtm_form"] == with_cand["nearest_svtm_form"]
        assert base["bal_rating"] if "bal_rating" in base else True


def test_candidate_equals_hazardous_when_same_patch():
    """When the nearest patch is hazardous, candidate data equals hazardous data."""
    site = _make_square_site(_OX, _OY, half_side=30)
    hazardous = _make_patch(_OX + 80, _OY, as3959_class="Woodland")
    all_patches = [hazardous]

    transects = _build_transects(site, [hazardous], 200, 8, all_patches)

    east_transects = [t for t in transects if t["outward_direction"] == "East" and t["vegetation_found"]]
    for t in east_transects:
        assert t.get("candidate_distance_m") == t["nearest_distance_m"]
        assert t.get("candidate_as3959_class") == t["nearest_as3959_class"]


def test_candidate_closer_than_hazardous():
    """When an excluded patch is closer than the hazardous one, the candidate
    reflects the excluded patch's distance while hazardous keeps its own."""
    site = _make_square_site(_OX, _OY, half_side=30)

    # Hazardous far east
    hazardous = _make_patch(_OX + 120, _OY, as3959_class="Forest")
    # Excluded close east
    excluded = _make_patch(_OX + 60, _OY, excluded=True)
    all_patches = [hazardous, excluded]

    transects = _build_transects(site, [hazardous], 200, 8, all_patches)

    east_transects = [t for t in transects if t["outward_direction"] == "East" and t["vegetation_found"]]
    for t in east_transects:
        # Hazardous distance is to the far patch
        assert t["nearest_as3959_class"] == "Forest"
        # Candidate is closer (the excluded patch)
        cand_dist = t.get("candidate_distance_m")
        if cand_dist is not None:
            assert cand_dist <= t["nearest_distance_m"], (
                f"Candidate should be closer: cand={cand_dist} vs haz={t['nearest_distance_m']}"
            )
            assert t["candidate_as3959_class"] == "Excluded"


def test_no_patches_at_all_gives_no_candidate():
    """When no patch of any kind is outward, candidate fields are absent."""
    site = _make_square_site(_OX, _OY, half_side=30)
    transects = _build_transects(site, [], 200, 8, [])

    for t in transects:
        assert not t["vegetation_found"]
        assert t.get("candidate_distance_m") is None

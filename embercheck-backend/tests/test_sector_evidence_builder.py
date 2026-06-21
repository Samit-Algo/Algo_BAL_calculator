# Unit tests for build_or_merge_sector_evidence — the helper that materialises
# four SectorEvidence entries from a boundary assessment's per_direction array.
#
# Run standalone:  .venv/Scripts/python.exe -m pytest tests/test_sector_evidence_builder.py -v
# Or directly:     .venv/Scripts/python.exe -c "from tests.test_sector_evidence_builder import *; ..."

from datetime import datetime, timezone

from app.cases.service import build_or_merge_sector_evidence
from app.models.case import SectorEvidence, SectorPhoto

COMPASS_SIDES = ("North", "East", "South", "West")


def _make_transect(direction, outward_direction, bal_rating, vegetation_class,
                   distance_m, vegetation_found=True):
    """Build a minimal per_direction transect entry."""
    return {
        "direction": direction,
        "outward_direction": outward_direction,
        "bal_rating": bal_rating,
        "vegetation_class": vegetation_class,
        "distance_m": distance_m,
        "vegetation_found": vegetation_found,
    }


def _make_boundary_assessment(transects):
    return {"per_direction": transects, "bal_rating": "BAL-12.5",
            "governing_direction": "East"}


def test_returns_none_for_no_boundary():
    assert build_or_merge_sector_evidence(None, None) is None
    assert build_or_merge_sector_evidence([], None) is None


def test_four_entries_always():
    ba = _make_boundary_assessment([
        _make_transect("T01", "North", "BAL-LOW", None, None, vegetation_found=False),
        _make_transect("T02", "East", "BAL-12.5", "Woodland", 86.8),
        _make_transect("T03", "South", "BAL-LOW", None, None, vegetation_found=False),
    ])
    result = build_or_merge_sector_evidence(None, ba)
    assert len(result) == 4
    sides = [ev.compass_side for ev in result]
    assert sides == list(COMPASS_SIDES)


def test_governing_transect_picks_worst_bal():
    ba = _make_boundary_assessment([
        _make_transect("T01", "East", "BAL-12.5", "Woodland", 90.0),
        _make_transect("S01", "East", "BAL-19", "Forest", 50.0),
        _make_transect("T02", "East", "BAL-LOW", None, None, vegetation_found=False),
    ])
    result = build_or_merge_sector_evidence(None, ba)
    east = next(ev for ev in result if ev.compass_side == "East")
    assert east.gis_draft_classification == "Forest"


def test_governing_transect_tiebreak_by_distance():
    ba = _make_boundary_assessment([
        _make_transect("T01", "East", "BAL-12.5", "Woodland", 90.0),
        _make_transect("S01", "East", "BAL-12.5", "Grassland", 50.0),
    ])
    result = build_or_merge_sector_evidence(None, ba)
    east = next(ev for ev in result if ev.compass_side == "East")
    assert east.gis_draft_classification == "Grassland"


def test_no_vegetation_gives_none_draft():
    ba = _make_boundary_assessment([
        _make_transect("T01", "West", "BAL-LOW", "Excluded", None, vegetation_found=False),
    ])
    result = build_or_merge_sector_evidence(None, ba)
    west = next(ev for ev in result if ev.compass_side == "West")
    assert west.gis_draft_classification is None


def test_defaults_on_fresh_entry():
    ba = _make_boundary_assessment([])
    result = build_or_merge_sector_evidence(None, ba)
    for ev in result:
        assert ev.photos == []
        assert ev.overrides is None
        assert ev.combined_classification is None
        assert ev.combined_confidence is None
        assert ev.review_flags == []
        assert ev.final_bal is None


def test_merge_preserves_photos_and_overrides():
    """Re-assessment must refresh gis_draft_classification but preserve photos,
    overrides, combined_classification, review_flags, and final_bal."""
    now = datetime.now(timezone.utc)
    dummy_photo = SectorPhoto(file_path="case1/east_1.jpg", captured_at=now)
    existing = [
        SectorEvidence(
            compass_side="North",
            gis_draft_classification="OLD",
        ),
        SectorEvidence(
            compass_side="East",
            gis_draft_classification="OLD",
            photos=[dummy_photo],
            combined_classification="Forest",
            combined_confidence=0.9,
            review_flags=["photo_lowered_class"],
            final_bal="BAL-29",
        ),
        SectorEvidence(compass_side="South"),
        SectorEvidence(compass_side="West"),
    ]

    ba = _make_boundary_assessment([
        _make_transect("T01", "East", "BAL-12.5", "Woodland", 86.8),
        _make_transect("T02", "North", "BAL-LOW", None, None, vegetation_found=False),
    ])

    result = build_or_merge_sector_evidence(existing, ba)
    assert len(result) == 4

    east = next(ev for ev in result if ev.compass_side == "East")
    assert east.gis_draft_classification == "Woodland"
    assert len(east.photos) == 1
    assert east.photos[0].file_path == "case1/east_1.jpg"
    assert east.combined_classification == "Forest"
    assert east.combined_confidence == 0.9
    assert east.review_flags == ["photo_lowered_class"]
    assert east.final_bal == "BAL-29"

    north = next(ev for ev in result if ev.compass_side == "North")
    assert north.gis_draft_classification is None


def test_point_mode_transects_handled():
    """Point mode per_direction entries use direction="North" etc. with no
    outward_direction. The helper should still pick them up."""
    ba = _make_boundary_assessment([
        {"direction": "North", "bal_rating": "BAL-LOW", "vegetation_class": None,
         "distance_m": None, "vegetation_found": False},
        {"direction": "East", "bal_rating": "BAL-12.5", "vegetation_class": "Woodland",
         "distance_m": 86.8, "vegetation_found": True},
        {"direction": "South", "bal_rating": "BAL-LOW", "vegetation_class": None,
         "distance_m": None, "vegetation_found": False},
        {"direction": "West", "bal_rating": "BAL-LOW", "vegetation_class": None,
         "distance_m": None, "vegetation_found": False},
    ])
    result = build_or_merge_sector_evidence(None, ba)
    assert len(result) == 4
    east = next(ev for ev in result if ev.compass_side == "East")
    assert east.gis_draft_classification == "Woodland"

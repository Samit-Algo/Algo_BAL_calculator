# Tests for the photo-driven BAL logic: a confident photo class actually drives
# the rating (via a PBP-formation override), with a safety rule on the direction
# of change. These hit the pure resolve_side_bal function - no network needed.
#
# Run standalone:  .venv/Scripts/python.exe -m tests.test_photo_driven_bal
# Or with pytest:  pytest tests/test_photo_driven_bal.py

from app.services.assessment_pipeline import resolve_side_bal
from app.services.photo_class_mapper import map_photo_class_to_pbp

# A common map baseline for a side with vegetation ~25 m away, flat. The
# veg_form decides the baseline BAL; the photo class can change it.
COMMON = dict(
    fdi=100,
    effective_slope_degrees=0.0,
    distance_m=25.0,
    vegetation_found=True,
    map_class_manual_review=False,
)


def test_mapping_keys_match_pbp_tables():
    """The photo->PBP mapping must use exact, table-resolvable formation keys."""
    from app.data.bal_tables_loader import BAL_TABLES

    flat_100 = BAL_TABLES["100"]["Upslope/Flat"]
    for cls in ["Forest", "Woodland", "Shrubland", "Scrub", "Mallee/Heath",
                "Rainforest", "Grassland"]:
        mapping = map_photo_class_to_pbp(cls)
        assert mapping["override"] is True
        assert mapping["pbp_formation"] in flat_100, f"{cls} -> {mapping['pbp_formation']}"

    assert map_photo_class_to_pbp("low_risk")["pbp_formation"] == "Excluded"
    assert map_photo_class_to_pbp("cant_tell")["override"] is False


def test_raise_grassland_to_forest():
    """RAISE: map=Grassland, photo={Forest, 0.8} -> BAL goes UP, source=photo,
    no extra review flag (raising is always allowed)."""
    result = resolve_side_bal(
        map_veg_form="Grassy Woodland",       # map baseline -> Woodland row
        map_as3959_class="Grassland",
        photo_entry={"class": "Forest", "confidence": 0.8},
        **COMMON,
    )
    # Map baseline for comparison.
    baseline = resolve_side_bal(
        map_veg_form="Grassy Woodland",
        map_as3959_class="Grassland",
        photo_entry=None,
        **COMMON,
    )
    from app.services.assessment_pipeline import BAL_SEVERITY
    assert BAL_SEVERITY[result["bal_rating"]] > BAL_SEVERITY[baseline["bal_rating"]]
    assert result["class_source"] == "photo"
    assert result["vegetation_class"] == "Forest"
    assert result["requires_manual_review"] is False


def test_lower_forest_to_low_risk():
    """LOWER: map=Forest, photo={low_risk, 0.8} -> BAL drops to BAL-LOW,
    source=photo, requires_manual_review=True (a downgrade must be confirmed)."""
    result = resolve_side_bal(
        map_veg_form="Wet Sclerophyll Forest",  # map baseline -> Forest row
        map_as3959_class="Forest",
        photo_entry={"class": "low_risk", "confidence": 0.8},
        **COMMON,
    )
    assert result["bal_rating"] == "BAL-LOW"
    assert result["class_source"] == "photo"
    assert result["requires_manual_review"] is True


def test_low_confidence_ignored():
    """LOW-CONFIDENCE: photo confidence 0.4 -> ignored, map value kept,
    source=map."""
    result = resolve_side_bal(
        map_veg_form="Wet Sclerophyll Forest",
        map_as3959_class="Forest",
        photo_entry={"class": "low_risk", "confidence": 0.4},
        **COMMON,
    )
    baseline = resolve_side_bal(
        map_veg_form="Wet Sclerophyll Forest",
        map_as3959_class="Forest",
        photo_entry=None,
        **COMMON,
    )
    assert result["bal_rating"] == baseline["bal_rating"]
    assert result["class_source"] == "map"
    assert result["vegetation_class"] == "Forest"


def test_cant_tell_ignored_even_at_high_confidence():
    """cant_tell never overrides, regardless of confidence."""
    result = resolve_side_bal(
        map_veg_form="Wet Sclerophyll Forest",
        map_as3959_class="Forest",
        photo_entry={"class": "cant_tell", "confidence": 0.99},
        **COMMON,
    )
    assert result["class_source"] == "map"


if __name__ == "__main__":
    tests = [
        ("mapping keys resolve in PBP tables", test_mapping_keys_match_pbp_tables),
        ("RAISE: Grassland -> Forest (up, no review)", test_raise_grassland_to_forest),
        ("LOWER: Forest -> low_risk (BAL-LOW, review)", test_lower_forest_to_low_risk),
        ("LOW-CONF 0.4 ignored (map kept)", test_low_confidence_ignored),
        ("cant_tell ignored at 0.99", test_cant_tell_ignored_even_at_high_confidence),
    ]
    failures = 0
    for label, fn in tests:
        try:
            fn()
            print(f"PASS  {label}")
        except AssertionError as error:
            failures += 1
            print(f"FAIL  {label}: {error}")
    print("\nAll passed" if not failures else f"\n{failures} failed")

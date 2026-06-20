# Regression tests for the Coastal Swamp Forest BAL under-rating fix.
#
# Bug: vegetation near "Coastal Swamp Forests" was rated BAL-12.5 when it
# should be BAL-29. The SVTM vegForm "Forested Wetlands" maps (via a rule
# flagged requires_pct_override) to the wetland row, but PBP files Coastal
# Swamp Forest under "Forest". calculate_bal now resolves that override using
# the class-level AS 3959 result.
#
# Run standalone:  .venv/Scripts/python.exe -m tests.test_bal_swamp_forest
# Or with pytest:  pytest tests/test_bal_swamp_forest.py

from app.services.bal_calculator import calculate_bal
from app.data.bal_tables_loader import DEFAULT_PBP_FORMATION


def test_swamp_forest_now_rates_bal_29():
    """A) Watanobbi case (the bug) must now return BAL-29 via the Forest row."""
    result = calculate_bal(
        fdi=100,
        veg_form="Forested Wetlands",
        effective_slope_degrees=0.0,
        distance_m=30.9,
        vegetation_found=True,
        as3959_class="Forest",
    )
    assert result["bal_rating"] == "BAL-29"
    assert result["pbp_formation"] == DEFAULT_PBP_FORMATION
    assert result["requires_manual_review"] is True


def test_denham_court_woodland_unchanged():
    """B) Woodland case must stay BAL-12.5 (no override triggered)."""
    result = calculate_bal(
        fdi=100,
        veg_form="Grassy Woodland",
        effective_slope_degrees=1.9,
        distance_m=86.8,
        vegetation_found=True,
        as3959_class="Woodland",
    )
    assert result["bal_rating"] == "BAL-12.5"


def test_pct_override_unknown_class_fails_safe_to_forest():
    """C) pct_override rule with unknown class -> conservative Forest -> BAL-29."""
    result = calculate_bal(
        fdi=100,
        veg_form="Forested Wetlands",
        effective_slope_degrees=0.0,
        distance_m=30.9,
        vegetation_found=True,
        as3959_class=None,
    )
    assert result["bal_rating"] == "BAL-29"
    assert result["pbp_formation"] == DEFAULT_PBP_FORMATION
    assert result["requires_manual_review"] is True


if __name__ == "__main__":
    tests = [
        ("A) swamp forest -> BAL-29", test_swamp_forest_now_rates_bal_29),
        ("B) woodland unchanged -> BAL-12.5", test_denham_court_woodland_unchanged),
        ("C) override + unknown class -> BAL-29", test_pct_override_unknown_class_fails_safe_to_forest),
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

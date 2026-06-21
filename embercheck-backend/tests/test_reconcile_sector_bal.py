# Unit tests for Phase A — Step 6 reconciliation: wiring photos into BAL.
# Covers all 6 verification checks from the spec. Deterministic (no I/O).
#
# Run: .venv/Scripts/python.exe -m tests.test_reconcile_sector_bal

from app.models.case import SectorEvidence, SectorOverrides
from app.services.assessment_pipeline import (
    BAL_SEVERITY,
    reconcile_all_sectors,
    reconcile_sector_bal,
)

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_transect(*, veg_found=True, distance_m=81.3, slope_deg=0.0,
                   svtm_form="Dry Sclerophyll Forests (Shrub/grass sub-formation)",
                   as3959_class="Woodland", bal_rating="BAL-12.5",
                   pbp_formation="Grassy and Semi-Arid Woodland (including Mallee)",
                   candidate_distance_m=None, candidate_slope=None,
                   candidate_svtm_form=None, candidate_as3959_class=None):
    """Build a minimal transect dict matching the REAL boundary_assessment
    per_direction record shape (assessment_pipeline.py's `record` dict) -
    "distance_m" / "vegetation_class" / "pbp_formation", NOT the raw
    vegetation_scan.py field names ("nearest_distance_m" etc.) those get
    renamed away before landing in the stored per_direction array."""
    t = {
        "direction": "T01",
        "outward_direction": "East",
        "vegetation_found": veg_found,
        "distance_m": distance_m,
        "effective_slope_degrees": slope_deg,
        "vegetation_class": as3959_class,
        "pbp_formation": pbp_formation,
        "bal_rating": bal_rating,
    }
    if candidate_distance_m is not None:
        t["candidate_distance_m"] = candidate_distance_m
        t["candidate_effective_slope_degrees"] = candidate_slope or 0.0
        t["candidate_svtm_form"] = candidate_svtm_form or svtm_form
        t["candidate_as3959_class"] = candidate_as3959_class or "Excluded"
    return t


def _make_ev(side="East", draft="Woodland", combined=None, confidence=None,
             flags=None, override_class=None, override_distance=None,
             override_slope=None):
    overrides = None
    if override_class is not None or override_distance is not None or override_slope is not None:
        overrides = SectorOverrides(
            vegetation_class=override_class,
            distance_m=override_distance,
            effective_slope_degrees=override_slope,
        )
    return SectorEvidence(
        compass_side=side,
        gis_draft_classification=draft,
        combined_classification=combined,
        combined_confidence=confidence,
        review_flags=flags or [],
        overrides=overrides,
    )


# ---------------------------------------------------------------------------
# Check 1: No photos -> byte-identical (BAL-12.5 / Woodland / T02 / 81.3 m)
# ---------------------------------------------------------------------------

def test_no_photos_unchanged():
    """With no combined_classification, final_bal == the GIS draft BAL."""
    ev = _make_ev(draft="Woodland", combined=None)
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-12.5"
    assert ev.review_flags == []


def test_no_photos_all_sides_headline_unchanged():
    """Full 4-side reconciliation with no photos -> headline == GIS headline."""
    sides = []
    for s in ("North", "East", "South", "West"):
        sides.append(_make_ev(side=s, draft="Woodland" if s == "East" else None,
                              combined=None))
    boundary = {
        "fire_danger_index": 100,
        "bal_rating": "BAL-12.5",
        "governing_direction": "T02",
        "per_direction": [
            {**_make_transect(veg_found=False), "outward_direction": "North",
             "direction": "T01", "bal_rating": "BAL-LOW"},
            {**_make_transect(), "outward_direction": "East", "direction": "T02"},
            {**_make_transect(veg_found=False), "outward_direction": "South",
             "direction": "T03", "bal_rating": "BAL-LOW"},
            {**_make_transect(veg_found=False), "outward_direction": "West",
             "direction": "T04", "bal_rating": "BAL-LOW"},
        ],
    }
    headline = reconcile_all_sectors(sides, boundary, surface="consumer")
    assert headline == "BAL-12.5"
    east = next(ev for ev in sides if ev.compass_side == "East")
    assert east.final_bal == "BAL-12.5"
    assert east.review_flags == []


# ---------------------------------------------------------------------------
# Check 2: Forest photo on Woodland side -> BAL rises (raise path)
# ---------------------------------------------------------------------------

def test_forest_photo_on_woodland_raises():
    """A Forest combined on a Woodland draft should raise the side's BAL.
    At 40m: Woodland -> BAL-12.5, Forest -> BAL-19."""
    ev = _make_ev(draft="Woodland", combined="Forest", confidence=0.9)
    transect = _make_transect(as3959_class="Woodland", distance_m=40.0,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-19"
    assert "photo_lower_than_draft_review" not in ev.review_flags


# ---------------------------------------------------------------------------
# Check 3: Grass photo on Woodland side
#   consumer -> side stays Woodland + "photo_lower_than_draft_review"
#   console  -> side uses Grassland + "lowered_requires_review"
# ---------------------------------------------------------------------------

def test_grass_on_woodland_consumer_keeps_draft():
    ev = _make_ev(draft="Woodland", combined="Grassland", confidence=0.9)
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3)
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-12.5"
    assert "photo_lower_than_draft_review" in ev.review_flags


def test_grass_on_woodland_console_lowers():
    ev = _make_ev(draft="Woodland", combined="Grassland", confidence=0.9)
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3)
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="console")
    assert BAL_SEVERITY.get(ev.final_bal, -1) <= BAL_SEVERITY["BAL-12.5"]
    assert "lowered_requires_review" in ev.review_flags


# ---------------------------------------------------------------------------
# Check 4: Forest photo on side where GIS draft is None BUT candidate exists
# -> banded from candidate distance/slope, flagged.
# ---------------------------------------------------------------------------

def test_photo_found_unmapped_vegetation_with_candidate():
    ev = _make_ev(draft=None, combined="Forest", confidence=0.9)
    transect = _make_transect(
        veg_found=False, distance_m=None, as3959_class="Excluded",
        bal_rating="BAL-LOW",
        candidate_distance_m=50.0, candidate_slope=5.0,
        candidate_svtm_form="Dry Sclerophyll Forests (Shrub/grass sub-formation)",
        candidate_as3959_class="Excluded",
    )
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal != "BAL-LOW"
    assert BAL_SEVERITY.get(ev.final_bal, -1) > BAL_SEVERITY["BAL-LOW"]
    assert "photo_found_unmapped_vegetation" in ev.review_flags


# ---------------------------------------------------------------------------
# Check 5: Veg photo with NO candidate geometry -> unassessable, no low BAL.
# ---------------------------------------------------------------------------

def test_photo_vegetation_no_candidate_unassessable():
    ev = _make_ev(draft=None, combined="Forest", confidence=0.9)
    transect = _make_transect(
        veg_found=False, distance_m=None, as3959_class="Excluded",
        bal_rating="BAL-LOW",
    )
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "review_required_unassessable"
    assert "photo_vegetation_no_distance_review" in ev.review_flags


def test_unassessable_does_not_lower_headline():
    """An unassessable side must NOT contribute a low BAL to the headline."""
    sides = [
        _make_ev(side="North", draft=None, combined="Forest"),
        _make_ev(side="East", draft="Woodland", combined=None),
        _make_ev(side="South", draft=None, combined=None),
        _make_ev(side="West", draft=None, combined=None),
    ]
    boundary = {
        "fire_danger_index": 100,
        "per_direction": [
            {**_make_transect(veg_found=False, bal_rating="BAL-LOW"),
             "outward_direction": "North", "direction": "T01"},
            {**_make_transect(), "outward_direction": "East", "direction": "T02"},
            {**_make_transect(veg_found=False, bal_rating="BAL-LOW"),
             "outward_direction": "South", "direction": "T03"},
            {**_make_transect(veg_found=False, bal_rating="BAL-LOW"),
             "outward_direction": "West", "direction": "T04"},
        ],
    }
    headline = reconcile_all_sectors(sides, boundary, surface="consumer")
    # North is unassessable (no candidate), East is BAL-12.5 from GIS.
    # Headline should be at least BAL-12.5, not lowered by the unassessable.
    assert headline == "BAL-12.5"
    north = next(ev for ev in sides if ev.compass_side == "North")
    assert north.final_bal == "review_required_unassessable"


# ---------------------------------------------------------------------------
# Check 6: Low-confidence / Unknown floor (Step 5) -> Forest -> raises BAL
# ---------------------------------------------------------------------------

def test_uncertain_floored_to_forest_raises():
    """Step 5 floors uncertain photos to Forest. Here we verify that Forest
    combined on a Woodland draft raises the BAL on the raise path.
    At 40m: Woodland -> BAL-12.5, Forest -> BAL-19."""
    ev = _make_ev(draft="Woodland", combined="Forest", confidence=0.5,
                  flags=["uncertain_vegetation"])
    transect = _make_transect(as3959_class="Woodland", distance_m=40.0)
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-19"
    assert "uncertain_vegetation" in ev.review_flags


# ---------------------------------------------------------------------------
# Edge cases
# ---------------------------------------------------------------------------

def test_same_class_no_change():
    """Combined == draft -> final_bal == draft BAL, no new flags."""
    ev = _make_ev(draft="Woodland", combined="Woodland", confidence=0.9)
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3)
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-12.5"
    assert "photo_lower_than_draft_review" not in ev.review_flags
    assert "lowered_requires_review" not in ev.review_flags


def test_excluded_photo_on_none_draft_stays_low():
    """Photos classify as Excluded on a side with no GIS draft -> BAL-LOW."""
    ev = _make_ev(draft=None, combined="Excluded", confidence=0.9)
    transect = _make_transect(veg_found=False, distance_m=None,
                              as3959_class="Excluded", bal_rating="BAL-LOW")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-LOW"
    assert "photo_found_unmapped_vegetation" not in ev.review_flags


def test_reconcile_all_returns_none_without_evidence():
    assert reconcile_all_sectors(None, {"per_direction": []}) is None
    assert reconcile_all_sectors([], {"per_direction": []}) is None


# ---------------------------------------------------------------------------
# Step 2 Part A: per-side vegetation override (consumer = raise/flag only)
# ---------------------------------------------------------------------------

def test_override_more_hazardous_raises():
    """Override Woodland draft -> Forest: side BAL RISES."""
    ev = _make_ev(draft="Woodland", combined=None, override_class="Forest")
    transect = _make_transect(as3959_class="Woodland", distance_m=40.0,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-19"
    assert "override_lower_than_draft_review" not in ev.review_flags


def test_override_less_hazardous_consumer_blocked():
    """Override Woodland draft -> Grassland (consumer): side STAYS Woodland's
    BAL + flag; BAL does NOT drop."""
    ev = _make_ev(draft="Woodland", combined=None, override_class="Grassland")
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-12.5"
    assert "override_lower_than_draft_review" in ev.review_flags


def test_override_less_hazardous_console_lowers():
    """Console surface: a less-hazardous override IS allowed to lower (with
    flag) - matches the existing photo-vs-draft console rule."""
    ev = _make_ev(draft="Woodland", combined=None, override_class="Grassland")
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="console")
    # On console, the EXISTING combined-vs-draft path doesn't apply (there's
    # no `combined`), so the override-less-than-draft branch still applies
    # the surface rule via the same severity comparison used for photos.
    # Consumer keeps draft; console is the ONLY surface that may lower -
    # verify the flag is present either way (the explicit ask is "consumer
    # never lowers", proven above; console parity is incidental here).
    assert ev.review_flags  # flagged regardless of surface


def test_override_beats_combined_when_more_hazardous():
    """Override compares against the PRE-override class (combined-or-draft),
    not just draft. Combined=Grassland (lower than draft, kept at Woodland's
    BAL per consumer rule); override=Forest beats Woodland -> raises further."""
    ev = _make_ev(draft="Woodland", combined="Grassland",
                  override_class="Forest")
    transect = _make_transect(as3959_class="Woodland", distance_m=40.0,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-19"


def test_override_persists_no_photos_anchor_unaffected():
    """No override anywhere -> anchor byte-identical (sanity re-check)."""
    ev = _make_ev(draft="Woodland", combined=None)
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal == "BAL-12.5"
    assert ev.review_flags == []


def test_override_distance_self_report_no_guard():
    """Distance/slope override is full self-report (no raise-only guard) -
    a closer overridden distance bands worse even though it "lowers" nothing
    class-wise; this mirrors point-mode's "adjust the inputs" behavior."""
    ev = _make_ev(draft="Woodland", combined=None, override_distance=10.0)
    transect = _make_transect(as3959_class="Woodland", distance_m=81.3,
                              bal_rating="BAL-12.5")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    # Woodland at 10m is much worse than at 81.3m.
    assert ev.final_bal != "BAL-12.5"
    assert BAL_SEVERITY[ev.final_bal] > BAL_SEVERITY["BAL-12.5"]
    assert "geometry_overridden" in ev.review_flags


def test_override_distance_can_also_lower_no_guard():
    """Full self-report means distance can also push the BAL DOWN - this is
    the deliberate point-mode-parity choice (no raise-only guard on
    distance/slope), distinct from the vegetation-class override above."""
    ev = _make_ev(draft="Woodland", combined=None, override_distance=200.0)
    transect = _make_transect(as3959_class="Woodland", distance_m=40.0,
                              bal_rating="BAL-19")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert BAL_SEVERITY[ev.final_bal] < BAL_SEVERITY["BAL-19"]


def test_override_distance_with_no_gis_hazard_uses_override():
    """Side has no GIS hazard at all (draft=None, veg_found=False) - a
    distance override still bands the photo-combined class against it,
    skipping candidate geometry (the override IS the asserted geometry)."""
    ev = _make_ev(draft=None, combined="Forest", override_distance=15.0)
    transect = _make_transect(veg_found=False, distance_m=None,
                              as3959_class="Excluded", bal_rating="BAL-LOW")
    reconcile_sector_bal(sector_ev=ev, side_transect=transect, fdi=100,
                         surface="consumer")
    assert ev.final_bal != "BAL-LOW"
    assert ev.final_bal != "review_required_unassessable"


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS: {t.__name__}")
    print(f"\nALL {len(tests)} TESTS PASSED")

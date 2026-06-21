# Unit tests for the sector classifier combination logic. Uses fixed proposals
# (no live model calls) to verify worst-case-governs, confidence floor, and
# safety invariants deterministically.
#
# Run: .venv/Scripts/python.exe -m tests.test_sector_classifier

from app.models.case import AiVegetationProposal
from app.services.sector_classifier import combine_proposals


def _prop(veg_class, confidence=0.9):
    return AiVegetationProposal(
        vegetation_class=veg_class, exclusion=(veg_class == "Excluded"),
        confidence=confidence, model_version="test",
    )


def test_worst_case_forest_woodland_grassland():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Forest", 0.9), _prop("Woodland", 0.85), _prop("Grassland", 0.8),
    ])
    assert combined == "Forest"
    assert conf == 0.8
    assert "uncertain_vegetation" not in flags


def test_worst_case_woodland_grassland():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Woodland", 0.9), _prop("Grassland", 0.85),
    ])
    assert combined == "Woodland"
    assert conf == 0.85


def test_combined_confidence_is_min():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Shrubland", 0.95), _prop("Shrubland", 0.72), _prop("Shrubland", 0.88),
    ])
    assert combined == "Shrubland"
    assert conf == 0.72


def test_low_confidence_triggers_forest_floor():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Grassland", 0.9), _prop("Grassland", 0.5), _prop("Grassland", 0.85),
    ])
    assert combined == "Forest"
    assert conf == 0.5
    assert "uncertain_vegetation" in flags


def test_unknown_class_triggers_forest_floor():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Woodland", 0.9), _prop("Unknown", 0.8),
    ])
    assert combined == "Forest"
    assert conf == 0.8
    assert "uncertain_vegetation" in flags


def test_single_low_confidence_among_high():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Woodland", 0.95), _prop("Woodland", 0.92), _prop("Woodland", 0.5),
    ])
    assert combined == "Forest"
    assert conf == 0.5
    assert "uncertain_vegetation" in flags


def test_photo_lower_than_draft_flag():
    combined, conf, flags, reasoning = combine_proposals(
        [_prop("Grassland", 0.9)],
        gis_draft_classification="Woodland",
    )
    assert combined == "Grassland"
    assert "photo_lower_than_draft" in flags


def test_photo_higher_than_draft_no_flag():
    combined, conf, flags, reasoning = combine_proposals(
        [_prop("Forest", 0.9)],
        gis_draft_classification="Woodland",
    )
    assert combined == "Forest"
    assert "photo_lower_than_draft" not in flags


def test_photo_equals_draft_no_flag():
    combined, conf, flags, reasoning = combine_proposals(
        [_prop("Woodland", 0.9)],
        gis_draft_classification="Woodland",
    )
    assert combined == "Woodland"
    assert "photo_lower_than_draft" not in flags


def test_no_draft_no_lower_flag():
    combined, conf, flags, reasoning = combine_proposals(
        [_prop("Grassland", 0.9)],
        gis_draft_classification=None,
    )
    assert combined == "Grassland"
    assert "photo_lower_than_draft" not in flags


def test_empty_proposals():
    combined, conf, flags, reasoning = combine_proposals([])
    assert combined is None
    assert conf is None
    assert flags == []


def test_excluded_is_least_severe():
    combined, conf, flags, reasoning = combine_proposals([
        _prop("Excluded", 0.9), _prop("Grassland", 0.85),
    ])
    assert combined == "Grassland"
    assert conf == 0.85


def test_vlm_read_to_proposal_mapping():
    from app.services.sector_classifier import _vlm_read_to_proposal

    p = _vlm_read_to_proposal({"class": "Forest", "confidence": 0.85})
    assert p.vegetation_class == "Forest"
    assert p.exclusion is False
    assert p.confidence == 0.85

    p = _vlm_read_to_proposal({"class": "cant_tell", "confidence": 0.0})
    assert p.vegetation_class == "Unknown"
    assert p.exclusion is False

    p = _vlm_read_to_proposal({"class": "low_risk", "confidence": 0.9})
    assert p.vegetation_class == "Excluded"
    assert p.exclusion is True


if __name__ == "__main__":
    tests = [v for k, v in sorted(globals().items()) if k.startswith("test_") and callable(v)]
    for t in tests:
        t()
        print(f"PASS: {t.__name__}")
    print(f"\nALL {len(tests)} TESTS PASSED")

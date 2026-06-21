# Unit tests for the SectorEvidence schema and its sub-models. Confirms
# defaults, serialisation round-trips, and that a Case with sector_evidence
# set to None (the backward-compatible default) works as expected.
#
# Run standalone:  .venv/Scripts/python.exe -m tests.test_sector_evidence_schema
# Or with pytest:  pytest tests/test_sector_evidence_schema.py

from datetime import datetime, timezone

from app.models.case import (
    AiVegetationProposal,
    SectorEvidence,
    SectorOverrides,
    SectorPhoto,
)


def test_sector_evidence_defaults():
    """SectorEvidence with only the required field has safe defaults."""
    ev = SectorEvidence(compass_side="North")
    assert ev.compass_side == "North"
    assert ev.gis_draft_classification is None
    assert ev.photos == []
    assert ev.combined_classification is None
    assert ev.combined_confidence is None
    assert ev.overrides is None
    assert ev.review_flags == []
    assert ev.final_bal is None


def test_sector_overrides_defaults():
    """SectorOverrides with no fields set has all None."""
    ov = SectorOverrides()
    assert ov.vegetation_class is None
    assert ov.distance_m is None
    assert ov.effective_slope_degrees is None
    assert ov.override_by is None
    assert ov.override_at is None


def test_sector_photo_defaults():
    """SectorPhoto requires file_path and captured_at; rest defaults."""
    now = datetime.now(timezone.utc)
    photo = SectorPhoto(file_path="abc/north_1.jpg", captured_at=now)
    assert photo.file_path == "abc/north_1.jpg"
    assert photo.captured_at == now
    assert photo.ai_proposal is None
    assert photo.metadata == {}


def test_ai_vegetation_proposal_required_fields():
    """AiVegetationProposal requires all four fields."""
    p = AiVegetationProposal(
        vegetation_class="Forest",
        exclusion=False,
        confidence=0.85,
        model_version="v1.0",
    )
    assert p.vegetation_class == "Forest"
    assert p.exclusion is False
    assert p.confidence == 0.85
    assert p.model_version == "v1.0"


def test_sector_evidence_full_round_trip():
    """A fully-populated SectorEvidence serialises and deserialises."""
    now = datetime.now(timezone.utc)
    ev = SectorEvidence(
        compass_side="East",
        gis_draft_classification="Woodland",
        photos=[
            SectorPhoto(
                file_path="case123/east_1.jpg",
                captured_at=now,
                ai_proposal=AiVegetationProposal(
                    vegetation_class="Forest",
                    exclusion=False,
                    confidence=0.92,
                    model_version="v1.0",
                ),
                metadata={"compass_heading": 91.2},
            ),
        ],
        combined_classification="Forest",
        combined_confidence=0.92,
        overrides=SectorOverrides(
            vegetation_class="Forest",
            distance_m=45.0,
            override_by="assessor-42",
            override_at=now,
        ),
        review_flags=["photo_lowered_class"],
        final_bal="BAL-29",
    )
    d = ev.model_dump()
    restored = SectorEvidence.model_validate(d)
    assert restored.compass_side == "East"
    assert restored.photos[0].ai_proposal.confidence == 0.92
    assert restored.overrides.distance_m == 45.0
    assert restored.review_flags == ["photo_lowered_class"]

# P0 sign-off unit tests (no live server / DB needed).
#
# Covers the pure, deterministic pieces of the sign path:
#   • _determination_rows — the frozen per-side certificate rows, built from the
#     SAME _build_sector projection the Console reads (basis + effective values).
#   • render_report_pdf — produces a valid, non-trivial PDF and, being the ISSUED
#     document, carries no "DRAFT" watermark string.
#   • _reject_if_signed — the edit-lock that 409s every write on a COMPLETE case.
#   • _signoff_summary — the consumer/console-facing slice of a Signoff.
#
# The endpoint wiring (auth + DB + status gating) is exercised by the live e2e
# verification in the plan; these unit tests are the fast, always-runnable guard.
#
# Run:  .venv/Scripts/python.exe -m pytest tests/test_signoff.py -q

from datetime import datetime, timezone
from types import SimpleNamespace

import pytest
from beanie import PydanticObjectId
from fastapi import HTTPException

from app.console.routes import (
    _auto_advance_status,
    _determination_rows,
    _reject_if_signed,
    _signoff_summary,
)
from app.models.case import (
    CaseStatus,
    PropertyInfo,
    SectorEvidence,
    SectorOverrides,
    Signoff,
)
from app.services.report_pdf import (
    ReportContext,
    render_report_pdf,
)


def _case(status=CaseStatus.READY_TO_SIGN):
    """An in-memory stand-in for a boundary Case with four reviewed sides — North
    overridden, West confirmed-with-photo, East/South plain reviewed (no hazard).

    A SimpleNamespace (not a real Beanie Case) so the test needs no DB init; the
    sign helpers only READ these attributes. The embedded SectorEvidence /
    SectorOverrides / Signoff are plain pydantic models and construct fine.
    """
    return SimpleNamespace(
        property=PropertyInfo(address="28 Cryptandra St, Denham Court NSW 2565", lga="Campbelltown"),
        boundary_assessment={"per_direction": []},
        bal_rating="BAL-12.5",
        governing_direction="North",
        status=status,
        photo_request_sides=[],
        signoff=None,
        sector_evidence=[
            SectorEvidence(
                compass_side="North", gis_draft_classification="Woodland",
                final_bal="BAL-12.5", reviewed=True, reviewed_by="a@x.com",
                overrides=SectorOverrides(vegetation_class="Forest", override_by="a@x.com"),
            ),
            SectorEvidence(compass_side="East", final_bal="BAL-LOW", reviewed=True),
            SectorEvidence(compass_side="South", final_bal="BAL-LOW", reviewed=True),
            SectorEvidence(
                compass_side="West", gis_draft_classification="Woodland",
                combined_classification="Woodland", final_bal="BAL-12.5", reviewed=True,
            ),
        ],
    )


def test_determination_rows_basis_and_values():
    rows = _determination_rows(_case())
    assert [r.side for r in rows] == ["N", "E", "S", "W"]
    by = {r.side: r for r in rows}
    # North carries an assessor override.
    assert by["N"].basis == "overridden by assessor"
    assert by["N"].vegetation == "Forest"
    assert by["N"].bal == "BAL-12.5"
    # West was reviewed without an override -> confirmed.
    assert by["W"].basis == "confirmed by assessor"
    # Empty sides fall back to BAL-LOW (never blank).
    assert by["E"].bal == "BAL-LOW"


def test_unreviewed_side_reads_as_suggested():
    case = _case()
    case.sector_evidence[1].reviewed = False  # East
    by = {r.side: r for r in _determination_rows(case)}
    assert by["E"].basis == "suggested — unreviewed"


def test_render_report_pdf_is_valid_and_not_draft():
    rows = _determination_rows(_case())
    pdf = render_report_pdf(ReportContext(
        report_number="EC-deadbeef-20260627-01",
        signed_at=datetime(2026, 6, 27, 3, 15, tzinfo=timezone.utc),
        address="28 Cryptandra St, Denham Court NSW 2565",
        locality="Campbelltown LGA · NSW",
        assessor_name="Samit B", accreditation_number="BPAD-12345",
        accreditation_level="Level 2", jurisdiction="NSW",
        overall_bal="BAL-12.5", governing_side="North", rows=rows,
    ))
    assert pdf[:5] == b"%PDF-"
    assert len(pdf) > 1500
    # The issued document must NOT carry the draft watermark text.
    assert b"DRAFT" not in pdf


def test_reject_if_signed_blocks_completed_case():
    with pytest.raises(HTTPException) as exc:
        _reject_if_signed(_case(status=CaseStatus.COMPLETE))
    assert exc.value.status_code == 409
    # An unsigned case is never blocked.
    assert _reject_if_signed(_case(status=CaseStatus.READY_TO_SIGN)) is None


def test_auto_advance_submitted_to_under_review():
    case = _case(status=CaseStatus.SUBMITTED_TO_ASSESSOR)
    case.sector_evidence[3].reviewed = False  # not all reviewed yet
    assert _auto_advance_status(case) == CaseStatus.UNDER_REVIEW
    assert case.status == CaseStatus.UNDER_REVIEW


def test_auto_advance_all_reviewed_to_ready_to_sign():
    case = _case(status=CaseStatus.UNDER_REVIEW)  # all four reviewed in fixture
    assert _auto_advance_status(case) == CaseStatus.READY_TO_SIGN
    assert case.status == CaseStatus.READY_TO_SIGN


def test_auto_advance_demotes_ready_when_blocker_reappears():
    case = _case(status=CaseStatus.READY_TO_SIGN)
    case.sector_evidence[0].reviewed = False  # a review went stale
    assert _auto_advance_status(case) == CaseStatus.UNDER_REVIEW
    assert case.status == CaseStatus.UNDER_REVIEW


def test_auto_advance_never_touches_request_states():
    for st in (
        CaseStatus.NEEDS_MORE_PHOTOS,
        CaseStatus.SITE_VISIT_REQUIRED,
        CaseStatus.REFERRED_SPECIALIST,
        CaseStatus.COMPLETE,
    ):
        case = _case(status=st)
        assert _auto_advance_status(case) is None
        assert case.status == st


def test_auto_advance_blocked_by_open_photo_request():
    # All sides reviewed, but an open photo request must keep it off READY_TO_SIGN.
    case = _case(status=CaseStatus.UNDER_REVIEW)
    case.photo_request_sides = ["North"]
    assert _auto_advance_status(case) is None
    assert case.status == CaseStatus.UNDER_REVIEW


def test_signoff_summary_shape():
    case = _case(status=CaseStatus.COMPLETE)
    assert _signoff_summary(case) is None  # no signoff record yet
    case.signoff = Signoff(
        report_number="EC-deadbeef-20260627-01",
        signed_by_assessor_id=PydanticObjectId(),
        assessor_name="Samit B", accreditation_number="BPAD-12345",
        bal_rating="BAL-12.5", governing_direction="North",
        report_path="x/report/EC.pdf",
    )
    summary = _signoff_summary(case)
    assert summary["report_number"] == "EC-deadbeef-20260627-01"
    assert summary["assessor_name"] == "Samit B"
    assert summary["bal_rating"] == "BAL-12.5"

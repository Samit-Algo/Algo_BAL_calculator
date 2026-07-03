# One-off: generate the report-template cover thumbnails shown on the Report
# preview cards. NOT a live endpoint — run it by hand when a template's cover
# changes:
#
#   .venv/Scripts/python.exe scripts/gen_template_thumbs.py
#
# It reuses the SAME headless-Chromium path as the report PDF (report_pdf_html),
# renders each template with a small hand-built SAMPLE context (representative
# placeholder values — not a real case), and screenshots the cover area. The two
# PNGs are written straight into the Console app's bundled assets.

import sys
from pathlib import Path

# Make the backend package importable when run directly (python scripts/…py).
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from playwright.sync_api import sync_playwright

from app.services.report_pdf_html import _CHANNELS
from app.services.report_render import render_report_html

# Console bundled assets (imported as modules by ReportPreviewScreen.jsx).
_OUT = (
    Path(__file__).resolve().parents[2]
    / "embercheck-console" / "src" / "assets" / "report-thumbs"
)

# Representative placeholder data — deliberately NOT a real case. Only the cover
# fields matter (header, badge, headline BAL, site/report details); lists are empty
# so no map/photos are fetched and the render is instant.
_SAMPLE = {
    "report": {
        "job_number": "EC-SAMPLE", "version": "1",
        "assessment_date": "01 Jan 2026", "generated_date": "01 Jan 2026",
        "status_label": "Under review", "report_number": "", "signed_date": "—",
    },
    "property": {
        "full_address": "12 Sample Street, Example NSW 2000",
        "lga": "EXAMPLE", "state": "NSW",
    },
    "site": {
        "lga": "EXAMPLE", "fdi": 100, "fdi_source": "NSW LGA-to-FDI reference",
        "boundary_mode": "Drawn boundary", "transect_count": 4, "has_map": False,
        "is_40": "", "is_50": "", "is_80": "", "is_100": "✓",
    },
    "result": {
        "headline_bal": "BAL-19", "certified": False, "preliminary": True,
        "uncertain_vegetation": False, "uncertain_count": 0, "transect_count": 4,
        "governing_side": "North", "governing_transect_label": "T01",
        "governing_vegetation": "Woodland", "governing_slope": "1°",
        "governing_distance_m": 30, "value_sources": [],
    },
    "transects": [], "photo_evidence": [], "has_photos": False, "bal_summary": [],
    "assessor": {
        "name": "Sample Assessor", "jurisdiction": "NSW",
        "jurisdiction_label": "NSW accredited assessor",
        "accreditation_number": "BPAD-0000", "accreditation_level": "Level 2",
        "company": "EmberCheck",
    },
}

_TEMPLATE_IDS = ("nsw_certifier", "owner_summary")
# Capture at 2× (retina) so the PNG stays sharp when shown small on the card, and
# clip a tight top band (logo + title + first section) — a clean crop that reads
# clearly at card size, not the whole page squeezed down.
_SCALE = 2
_CLIP = {"x": 0, "y": 0, "width": 820, "height": 430}  # cover top band


def _launch(p):
    for channel in _CHANNELS:
        try:
            return p.chromium.launch(channel=channel, headless=True) if channel else p.chromium.launch(headless=True)
        except Exception:
            continue
    raise RuntimeError("No headless Chromium available (tried Edge, Chrome, bundled).")


def main() -> None:
    _OUT.mkdir(parents=True, exist_ok=True)
    with sync_playwright() as p:
        browser = _launch(p)
        try:
            for tid in _TEMPLATE_IDS:
                html = render_report_html(_SAMPLE, tid)
                page = browser.new_page(
                    viewport={"width": 820, "height": 1160}, device_scale_factor=_SCALE
                )
                page.set_content(html, wait_until="networkidle")
                out = _OUT / f"{tid}.png"
                page.screenshot(path=str(out), clip=_CLIP)  # clip is in CSS px; output is 2×
                page.close()
                print("wrote", out)
        finally:
            browser.close()


if __name__ == "__main__":
    main()

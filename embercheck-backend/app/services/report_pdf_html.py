# HTML → PDF for the BAL report (the single-source workflow).
#
# The report is authored once as HTML (report_template.html, filled by
# render_report_html). This module prints that exact HTML to PDF with a headless
# Chromium (via Playwright), so the downloaded/issued PDF is pixel-faithful to the
# on-screen preview — the assessor's preview, the assessor's download, and the
# end-user's download are all the SAME document and cannot drift.
#
# Chromium is used (not a pure-Python engine) because the report relies on modern
# CSS (flexbox, color-mix, print backgrounds) that only a real browser renders
# faithfully. We prefer an already-installed system browser (Edge/Chrome channel)
# so no separate ~150 MB browser download is required; falling back to Playwright's
# bundled Chromium if one was installed via `playwright install`.
#
# render_report_pdf is SYNC and must be called off the event loop (the callers use
# anyio.to_thread.run_sync) — Playwright's sync API cannot run inside a running
# asyncio loop, but runs fine in a worker thread.

from __future__ import annotations

from playwright.sync_api import sync_playwright

# Launch strategies tried in order: a system Edge, a system Chrome, then whatever
# Playwright bundled. The first that launches wins.
_CHANNELS = ("msedge", "chrome", None)

_PDF_OPTS = dict(
    format="A4",
    print_background=True,
    margin={"top": "12mm", "bottom": "14mm", "left": "12mm", "right": "12mm"},
    prefer_css_page_size=True,
)


class PdfEngineUnavailable(RuntimeError):
    """No headless Chromium (Edge/Chrome channel or bundled) could be launched."""


def render_report_pdf(html: str) -> bytes:
    """Print `html` (a complete self-contained document — images are data URIs)
    to PDF bytes with headless Chromium. Raises PdfEngineUnavailable if no browser
    can be launched. SYNC: call via anyio.to_thread.run_sync from async code."""
    last_error: Exception | None = None
    with sync_playwright() as p:
        for channel in _CHANNELS:
            try:
                browser = (
                    p.chromium.launch(channel=channel, headless=True)
                    if channel
                    else p.chromium.launch(headless=True)
                )
            except Exception as exc:  # this channel isn't present — try the next
                last_error = exc
                continue
            try:
                page = browser.new_page()
                # networkidle is safe because every asset is inlined as a data URI.
                page.set_content(html, wait_until="networkidle")
                return page.pdf(**_PDF_OPTS)
            finally:
                browser.close()
    raise PdfEngineUnavailable(
        "No headless Chromium available (tried Edge, Chrome, bundled). "
        f"Last error: {last_error}"
    )

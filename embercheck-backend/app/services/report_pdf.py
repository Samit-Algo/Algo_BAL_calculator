# Signed BAL determination certificate (P0 sign-off).
#
# Renders the issued PDF an assessor signs, using ReportLab Platypus (pure
# Python, no native deps — deterministic across dev/prod). This module is
# DELIBERATELY import-clean: it knows nothing about routes or Beanie. The caller
# (app/console/routes.py::console_sign_case) assembles a plain `ReportContext`
# from the case + assessor profile and hands it here. That keeps the renderer a
# pure function (context -> bytes), trivially testable, and free of circular
# imports.
#
# This is the ISSUED document, so there is no "DRAFT — NOT A DETERMINATION"
# watermark — BUT the AS 3959 screening disclaimer (spec §17) is mandatory and
# always printed, so the format is never misleading about what it is.

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from io import BytesIO

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import (
    HRFlowable,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# Ember palette (matches the on-screen report doc).
INK = colors.HexColor("#26271F")
INK_SOFT = colors.HexColor("#5F6052")
FOREST = colors.HexColor("#3C4733")
LINE = colors.HexColor("#D8D3C2")
PANEL = colors.HexColor("#F2F0E6")

DISCLAIMER = (
    "This is an indicative bushfire screening result produced under the simplified "
    "procedure of AS 3959 (Method 1). It is not a substitute for a full site "
    "assessment. A formal BAL assessment by a qualified bushfire consultant is "
    "required for development applications and regulatory purposes. A Method 2 "
    "(detailed radiant-heat) assessment may yield a lower BAL for the same property."
)

# The four NSW public datasets the screen draws on (mirrors the on-screen report).
DATA_SOURCES = [
    ("NSW SVTM vegetation mapping", "2019", "5 m"),
    ("LiDAR DEM (terrain / effective slope)", "2022", "1 m"),
    ("NSW cadastre & road reserves", "2024", "±1 m"),
    ("Site photography (per elevation, where supplied)", "on file", "—"),
]


@dataclass
class DeterminationRow:
    """One compass-side row of the issued determination."""

    side: str
    vegetation: str
    slope: str
    distance: str
    bal: str
    basis: str


@dataclass
class ReportContext:
    """Everything the certificate needs — assembled by the sign handler."""

    report_number: str
    signed_at: datetime
    address: str
    locality: str  # "<LGA> LGA · NSW" style line (may be empty)
    assessor_name: str
    accreditation_number: str
    accreditation_level: str
    jurisdiction: str
    overall_bal: str
    governing_side: str
    rows: list[DeterminationRow] = field(default_factory=list)


def _styles() -> dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ec_title", parent=base["Title"], fontSize=18, leading=22,
            textColor=INK, spaceAfter=2, alignment=TA_LEFT,
        ),
        "meta": ParagraphStyle(
            "ec_meta", parent=base["Normal"], fontSize=8.5, leading=12, textColor=INK_SOFT,
        ),
        "label": ParagraphStyle(
            "ec_label", parent=base["Normal"], fontSize=8, leading=11, textColor=FOREST,
            spaceAfter=2, fontName="Helvetica-Bold",
        ),
        "body": ParagraphStyle(
            "ec_body", parent=base["Normal"], fontSize=9.5, leading=14, textColor=INK,
        ),
        "value": ParagraphStyle(
            "ec_value", parent=base["Normal"], fontSize=10.5, leading=14, textColor=INK,
            fontName="Helvetica-Bold",
        ),
        "disclaimer": ParagraphStyle(
            "ec_disc", parent=base["Normal"], fontSize=8, leading=12, textColor=INK_SOFT,
        ),
    }


def _section_label(text: str, st) -> Paragraph:
    return Paragraph(text.upper(), st["label"])


def _data_sources_table(st) -> Table:
    rows = [["Source", "Vintage", "Resolution"]] + [list(r) for r in DATA_SOURCES]
    t = Table(rows, colWidths=[105 * mm, 30 * mm, 30 * mm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("TEXTCOLOR", (0, 0), (-1, 0), INK_SOFT),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("LINEBELOW", (0, 0), (-1, 0), 1, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
    ]))
    return t


def _determination_table(rows: list[DeterminationRow], st) -> Table:
    head = ["Elevation", "Vegetation", "Slope", "Separation", "BAL", "Basis"]
    data = [head] + [
        [r.side, r.vegetation, r.slope, r.distance, r.bal, r.basis] for r in rows
    ]
    t = Table(data, colWidths=[20 * mm, 38 * mm, 24 * mm, 24 * mm, 22 * mm, 37 * mm])
    t.setStyle(TableStyle([
        ("FONT", (0, 0), (-1, 0), "Helvetica-Bold", 7.5),
        ("FONT", (0, 1), (-1, -1), "Helvetica", 8.5),
        ("FONT", (4, 1), (4, -1), "Helvetica-Bold", 8.5),  # BAL column bold
        ("TEXTCOLOR", (0, 0), (-1, 0), INK_SOFT),
        ("TEXTCOLOR", (0, 1), (-1, -1), INK),
        ("TEXTCOLOR", (5, 1), (5, -1), INK_SOFT),
        ("LINEBELOW", (0, 0), (-1, 0), 1, INK),
        ("LINEBELOW", (0, 1), (-1, -2), 0.5, LINE),
        ("TOPPADDING", (0, 0), (-1, -1), 5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return t


def render_report_pdf(ctx: ReportContext) -> bytes:
    """Render the issued determination certificate to PDF bytes."""
    st = _styles()
    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=20 * mm, rightMargin=20 * mm, topMargin=18 * mm, bottomMargin=18 * mm,
        title=f"BAL Determination {ctx.report_number}",
        author="EmberCheck",
    )
    issued = ctx.signed_at.strftime("%d %B %Y")
    flow: list = []

    # Header
    flow.append(Paragraph("Bushfire Attack Level Assessment", st["title"]))
    flow.append(Paragraph(
        f"NSW certifier pack &nbsp;·&nbsp; {ctx.report_number} &nbsp;·&nbsp; Issued {issued}",
        st["meta"],
    ))
    flow.append(Spacer(1, 4))
    flow.append(HRFlowable(width="100%", thickness=1.5, color=INK, spaceAfter=10))

    # Subject site + assessor (two columns)
    subject = [
        _section_label("Subject site", st),
        Paragraph(ctx.address, st["body"]),
        Paragraph(ctx.locality or "NSW", st["meta"]),
    ]
    assessor = [
        _section_label("Assessor", st),
        Paragraph(ctx.assessor_name or "—", st["body"]),
        Paragraph(
            " · ".join(
                p for p in (
                    f"Accreditation {ctx.accreditation_number}" if ctx.accreditation_number else None,
                    ctx.accreditation_level or None,
                    f"{ctx.jurisdiction} accredited assessor" if ctx.jurisdiction else "accredited assessor",
                ) if p
            ),
            st["meta"],
        ),
    ]
    head_tbl = Table([[subject, assessor]], colWidths=[88 * mm, 77 * mm])
    head_tbl.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
    ]))
    flow.append(head_tbl)
    flow.append(Spacer(1, 12))

    # Methodology
    flow.append(_section_label("Methodology", st))
    flow.append(Paragraph(
        "Assessed under the simplified procedure of AS 3959 (Method 1), informed by "
        "the public datasets tabled below and any site photography on file. "
        "Machine-derived values were surfaced with their source and confidence; the "
        "determination below is the signing assessor's own.",
        st["body"],
    ))
    flow.append(Spacer(1, 12))

    # Data sources
    flow.append(_section_label("Data sources", st))
    flow.append(Spacer(1, 4))
    flow.append(_data_sources_table(st))
    flow.append(Spacer(1, 14))

    # Determination by elevation
    flow.append(_section_label("Determination by elevation", st))
    flow.append(Spacer(1, 4))
    flow.append(_determination_table(ctx.rows, st))
    flow.append(Spacer(1, 12))

    # Overall determination band
    overall = Table(
        [[
            Paragraph(
                f"<b>Overall determination</b> — highest applicable elevation"
                f"{f' ({ctx.governing_side})' if ctx.governing_side else ''}",
                st["body"],
            ),
            Paragraph(ctx.overall_bal or "—", st["value"]),
        ]],
        colWidths=[130 * mm, 35 * mm],
    )
    overall.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), PANEL),
        ("BOX", (0, 0), (-1, -1), 0.5, LINE),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
        ("TOPPADDING", (0, 0), (-1, -1), 10),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 10),
        ("LEFTPADDING", (0, 0), (-1, -1), 12),
        ("RIGHTPADDING", (0, 0), (-1, -1), 12),
    ]))
    flow.append(overall)
    flow.append(Spacer(1, 18))

    # Signature block
    flow.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceAfter=10))
    flow.append(_section_label("Signed", st))
    flow.append(Paragraph(ctx.assessor_name or "—", st["value"]))
    flow.append(Paragraph(
        " · ".join(
            p for p in (
                f"Accreditation {ctx.accreditation_number}" if ctx.accreditation_number else None,
                f"Signed {ctx.signed_at.strftime('%d %B %Y, %H:%M UTC')}",
            ) if p
        ),
        st["meta"],
    ))
    flow.append(Spacer(1, 16))

    # Mandatory disclaimer (§17)
    flow.append(HRFlowable(width="100%", thickness=0.5, color=LINE, spaceAfter=8))
    flow.append(Paragraph(DISCLAIMER, st["disclaimer"]))

    doc.build(flow)
    return buf.getvalue()

# This service bridges an SVTM vegetation formation (vegForm) to the exact
# PBP 2019 formation name used as a column key in the BAL distance tables.

from app.data.bal_tables_loader import DEFAULT_PBP_FORMATION, VEGFORM_BRIDGE_RULES


def map_vegform_to_pbp(veg_form: str) -> dict:
    """
    Look up the PBP formation for an SVTM vegetation formation (vegForm).

    Returns a dict with:
        - pbp_formation (str | None): the PBP formation name, or None if no
          reliable mapping exists for this vegForm.
        - confidence (str)
        - manual_review (bool)
        - requires_pct_override (bool): True when this vegForm groups together
          vegetation that PBP actually splits at the PCT/class level (e.g. the
          "Forested Wetland" formation, whose Coastal Swamp Forest subset
          belongs under "Forest"). The caller must resolve it using a
          finer-grained signal. Defaults to False.
    """

    # Null-safe guard: vegForm can legitimately be None, missing, or empty for a
    # hazardous patch (PCTID <> 0 doesn't guarantee a populated vegForm). Treat
    # an absent/blank formation as "no reliable mapping" and fall back to the
    # worst-case Forest row with manual_review raised - same conservative outcome
    # as an unmatched vegForm below - rather than crashing on `keyword in None`
    # (spec §9: null formation -> Forest + review; §11: conservative defaults).
    if veg_form is None or not str(veg_form).strip():
        return {
            "pbp_formation": DEFAULT_PBP_FORMATION,
            "confidence": "Unknown",
            "manual_review": True,
            "requires_pct_override": False,
        }

    # Rules are already sorted by priority (ascending) - the first rule
    # whose match_keyword appears in veg_form wins.
    for rule in VEGFORM_BRIDGE_RULES:
        if rule["match_keyword"] in veg_form:
            return {
                "pbp_formation": rule["pbp_formation"],
                "confidence": rule["confidence"],
                "manual_review": rule["manual_review"],
                "requires_pct_override": rule.get("requires_pct_override", False),
            }

    # No rule matched at all - fall back to the worst-case Forest formation.
    return {
        "pbp_formation": DEFAULT_PBP_FORMATION,
        "confidence": "Unknown",
        "manual_review": True,
        "requires_pct_override": False,
    }

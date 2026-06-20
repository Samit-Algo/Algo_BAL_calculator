# Read-only batch runner: push a spread of NSW addresses through the live
# /assess pipeline and emit a markdown table + JSON for CSIRO cross-checking.
# Backfills failed geocodes from a spares list until 10 varied runs succeed,
# then always appends the 2 known anchors.

import json
import time

import httpx

BASE_URL = "http://localhost:8000"

FIELDS = [
    "input_address",
    "matched_address",
    "lga",
    "fire_danger_index",
    "as3959_vegetation_class",
    "pbp_formation",
    "nearest_vegetation_distance_m",
    "vegetation_found_within_range",
    "slope_degrees",
    "slope_direction",
    "effective_slope_degrees",
    "bal_rating",
    "requires_manual_review",
]

# 10 varied primaries (bushland fringe, rural/grassland, urban controls), spread
# across LGAs.
PRIMARY = [
    "1 Boronia St, Hazelbrook NSW 2779",        # Blue Mountains - forest fringe
    "100 Grose Vale Rd, Grose Vale NSW 2753",    # Hawkesbury - rural/bushland
    "10 Galston Rd, Hornsby Heights NSW 2077",   # Hornsby - bushland fringe
    "30 Skye Point Rd, Coal Point NSW 2283",     # Lake Macquarie - bushland
    "1 Track St, Vincentia NSW 2540",            # Shoalhaven - coastal forest
    "10 Argyle St, Picton NSW 2571",             # Wollondilly - rural/grassland
    "10 Old South Rd, Mittagong NSW 2575",       # Wingecarribee - rural
    "20 Tweed Valley Way, Murwillumbah NSW 2484",# Tweed - forest/rural
    "1 Martin Place, Sydney NSW 2000",           # dense urban control
    "100 George St, Parramatta NSW 2150",        # dense urban control
]

# Spares used only if a primary fails to geocode / errors.
SPARES = [
    "5 Bias Ave, Bateau Bay NSW 2261",           # Central Coast - coastal
    "100 Cobbitty Rd, Cobbitty NSW 2570",        # Camden - grassland
    "200 Crown St, Wollongong NSW 2500",         # urban control
    "9 Mount Hay Rd, Leura NSW 2780",            # Blue Mountains - bushland
    "5 Junction Rd, Leumeah NSW 2560",           # Campbelltown
    "20 Tuggerah Parade, The Entrance NSW 2261", # Central Coast - wetland edge
]

ANCHORS = [
    "11 Cryptandra St, Denham Court NSW 2565",   # expect BAL-12.5
    "12A Abbey Cl, Watanobbi NSW 2259",          # expect BAL-29 (post-fix)
]


def assess(address):
    """Return (record_dict, None) on success or (None, error_str) on failure.
    Retries on the elevation 503."""
    for attempt in range(3):
        try:
            resp = httpx.post(
                f"{BASE_URL}/assess",
                json={"address": address},
                timeout=40,
            )
        except Exception as exc:  # network / timeout
            if attempt < 2:
                time.sleep(3)
                continue
            return None, f"request error: {exc}"

        if resp.status_code == 200:
            d = resp.json()
            record = {f: d.get(f) for f in FIELDS}
            # The response calls the requested address "address"; surface it as
            # input_address per the cross-check schema.
            record["input_address"] = address
            return record, None

        if resp.status_code == 503:  # elevation cold start - retry
            time.sleep(3)
            continue

        # 404 not found / 400 outside NSW / other - don't retry
        try:
            detail = resp.json().get("detail", resp.text)
        except Exception:
            detail = resp.text
        return None, f"HTTP {resp.status_code}: {detail}"

    return None, "HTTP 503: elevation service unavailable after retries"


def main():
    results = []
    errors = []

    # Fill 10 slots from primaries, backfilling from spares on failure.
    queue = list(PRIMARY)
    spares = list(SPARES)
    while len([r for r in results if r is not None]) < 10 and queue:
        addr = queue.pop(0)
        rec, err = assess(addr)
        if rec:
            results.append(rec)
            print(f"OK    {addr} -> {rec['bal_rating']}")
        else:
            errors.append({"address": addr, "error": err})
            print(f"FAIL  {addr} -> {err}")
            if spares:
                queue.append(spares.pop(0))

    # Always include the 2 anchors.
    for addr in ANCHORS:
        rec, err = assess(addr)
        if rec:
            results.append(rec)
            print(f"OK    {addr} -> {rec['bal_rating']} (anchor)")
        else:
            errors.append({"address": addr, "error": err})
            print(f"FAIL  {addr} -> {err} (anchor)")

    # ---- Markdown table ----
    print("\n\n===== MARKDOWN TABLE =====\n")
    print("| address | LGA | FDI | AS3959 class | distance_m | eff_slope (+dir) | BAL | review? |")
    print("|---|---|---|---|---|---|---|---|")
    for r in results:
        dist = r["nearest_vegetation_distance_m"]
        dist_s = "n/a" if dist is None else f"{dist}"
        eff = f"{r['effective_slope_degrees']}° {r['slope_direction']}"
        review = "yes" if r["requires_manual_review"] else "no"
        print(
            f"| {r['matched_address']} | {r['lga']} | {r['fire_danger_index']} | "
            f"{r['as3959_vegetation_class']} | {dist_s} | {eff} | "
            f"{r['bal_rating']} | {review} |"
        )

    # ---- JSON ----
    print("\n\n===== JSON =====\n")
    print(json.dumps(results, indent=2))

    # ---- Errors ----
    print("\n\n===== ERRORS / REPLACED =====\n")
    print(json.dumps(errors, indent=2) if errors else "none")


if __name__ == "__main__":
    main()

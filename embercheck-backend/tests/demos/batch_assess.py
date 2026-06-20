# Sends a spread of NSW addresses to the running /assess endpoint, and
# prints a summary table + stats. Useful for sanity-checking the whole
# pipeline (FDI, vegetation, slope, BAL) across different regions at once.
#
# Run the server first (from embercheck-backend):
#   ./.venv/Scripts/python.exe -m uvicorn app.main:app --port 8000
# Then run this script:
#   ./.venv/Scripts/python.exe tests/demos/batch_assess.py

import json
from pathlib import Path

import httpx

ASSESS_URL = "http://127.0.0.1:8000/assess"

# How long to wait for one /assess call. Some addresses hit the slow
# elevation service, so this is longer than a normal request timeout.
REQUEST_TIMEOUT_SECONDS = 40

# Where the full raw results get saved for the record.
RESULTS_PATH = Path(__file__).resolve().parent / "batch_results.json"

# Each entry is (primary address, note, fallback address). If the primary
# address fails to geocode, we retry with the fallback (same suburb) so the
# overall spread of regions/FDI still gets covered.
ADDRESSES = [
    ("1 Macquarie St, Parramatta NSW", "dense urban - expect BAL-LOW",
     "Parramatta Square, Parramatta NSW"),
    ("11 Cryptandra St, Denham Court NSW", "suburban, woodland nearby",
     "1 Cryptandra St, Denham Court NSW"),
    ("28 Cryptandra St, Denham Court NSW", "same street, veg farther",
     "20 Cryptandra St, Denham Court NSW"),
    ("22 Bensley Rd, Cobbitty NSW", "rural",
     "100 Bensley Rd, Cobbitty NSW"),
    ("1 Boronia St, Hazelbrook NSW", "Blue Mountains bush edge - expect high",
     "1 Boronia Rd, Bullaburra NSW"),
    ("Govetts Leap Rd, Blackheath NSW", "national park edge",
     "2 Govetts Leap Rd, Blackheath NSW"),
    ("1 Railway Pde, Springwood NSW", "Blue Mountains",
     "1 Macquarie Rd, Springwood NSW"),
    ("1 Walter Rd, Berowra NSW", "bushland metro fringe, Hornsby",
     "1 Pacific Hwy, Berowra NSW"),
    ("1 Parkes St, Helensburgh NSW", "Illawarra bush",
     "1 Walker St, Helensburgh NSW"),
    ("1 Vincent St, Cessnock NSW", "Greater Hunter",
     "1 Wollombi Rd, Cessnock NSW"),
    ("1 River St, Ballina NSW", "Far North Coast - FDI 80",
     "40 River St, Ballina NSW"),
    ("1 Harbour Dr, Coffs Harbour NSW", "North Coast - FDI 80",
     "1 Camperdown St, Coffs Harbour NSW"),
    ("1 Summer St, Orange NSW", "Central Ranges - FDI 80",
     "100 Summer St, Orange NSW"),
    ("1 Argent St, Broken Hill NSW", "Far Western - FDI 80",
     "100 Argent St, Broken Hill NSW"),
    ("1 Kosciuszko Rd, Jindabyne NSW", "Snowy Monaro - alpine region",
     "Kosciuszko Rd, Jindabyne NSW"),
]

# Fields we pull out of each successful /assess response for the summary.
SUMMARY_FIELDS = [
    "matched_address",
    "lga",
    "fire_danger_index",
    "as3959_vegetation_class",
    "pbp_formation",
    "nearest_vegetation_distance_m",
    "slope_direction",
    "effective_slope_degrees",
    "bal_rating",
    "requires_manual_review",
]


def assess_address(client: httpx.Client, address: str) -> dict | None:
    """
    POST one address to /assess. Returns the parsed JSON result on success
    (HTTP 200), or None if the address couldn't be assessed.
    """

    try:
        response = client.post(ASSESS_URL, json={"address": address})
    except httpx.RequestError as error:
        print(f"  request error for '{address}': {error}")
        return None

    if response.status_code != 200:
        print(f"  {response.status_code} for '{address}': {response.text}")
        return None

    return response.json()


def truncate(text: str, width: int) -> str:
    """Shorten text to fit a column, adding '...' if it was cut off."""

    text = str(text)
    if len(text) <= width:
        return text
    return text[: width - 3] + "..."


def main():
    results = []

    for address, note, fallback_address in ADDRESSES:
        print(f"Assessing: {address} ({note})")
        result = assess_address(httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS), address)

        used_address = address
        if result is None:
            print(f"  '{address}' FAILED to geocode - trying fallback '{fallback_address}'")
            result = assess_address(httpx.Client(timeout=REQUEST_TIMEOUT_SECONDS), fallback_address)
            used_address = fallback_address

        if result is None:
            print(f"  '{fallback_address}' also FAILED")
            results.append({
                "requested_address": address,
                "used_address": fallback_address,
                "note": note,
                "status": "FAILED",
            })
            continue

        row = {
            "requested_address": address,
            "used_address": used_address,
            "note": note,
            "status": "OK",
        }
        for field in SUMMARY_FIELDS:
            row[field] = result.get(field)
        results.append(row)

    # Save the full raw results for the record.
    RESULTS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
    print(f"\nSaved full results to {RESULTS_PATH}")

    print_summary_table(results)
    print_stats(results)


def print_summary_table(results: list):
    columns = [
        ("Address", "used_address", 28),
        ("LGA", "lga", 18),
        ("FDI", "fire_danger_index", 4),
        ("AS3959", "as3959_vegetation_class", 10),
        ("PBP Formation", "pbp_formation", 16),
        ("Dist(m)", "nearest_vegetation_distance_m", 8),
        ("Slope Dir", "slope_direction", 10),
        ("EffSlope", "effective_slope_degrees", 8),
        ("BAL", "bal_rating", 8),
        ("Review", "requires_manual_review", 6),
    ]

    print()
    header = " | ".join(title.ljust(width) for title, _, width in columns)
    print(header)
    print("-" * len(header))

    for row in results:
        if row["status"] == "FAILED":
            print(f"{truncate(row['requested_address'], 28).ljust(28)} | FAILED")
            continue

        cells = []
        for _, field, width in columns:
            value = row.get(field)
            cells.append(truncate("" if value is None else value, width).ljust(width))
        print(" | ".join(cells))


def print_stats(results: list):
    ok_results = [row for row in results if row["status"] == "OK"]
    failed_results = [row for row in results if row["status"] == "FAILED"]

    bal_counts = {}
    fdi_counts = {}
    manual_review_count = 0

    for row in ok_results:
        bal = row.get("bal_rating")
        bal_counts[bal] = bal_counts.get(bal, 0) + 1

        fdi = row.get("fire_danger_index")
        fdi_counts[fdi] = fdi_counts.get(fdi, 0) + 1

        if row.get("requires_manual_review"):
            manual_review_count += 1

    print("\nBAL rating counts:")
    for bal_rating in ["BAL-LOW", "BAL-12.5", "BAL-19", "BAL-29", "BAL-40", "BAL-FZ"]:
        if bal_rating in bal_counts:
            print(f"  {bal_rating}: {bal_counts[bal_rating]}")

    print("\nFire Danger Index counts:")
    for fdi in sorted(fdi_counts, reverse=True):
        print(f"  FDI {fdi}: {fdi_counts[fdi]}")

    print(f"\nRequires manual review: {manual_review_count} / {len(ok_results)}")

    print(f"\nFailed addresses: {len(failed_results)}")
    for row in failed_results:
        print(f"  {row['requested_address']} (fallback {row['used_address']} also failed)")


if __name__ == "__main__":
    main()

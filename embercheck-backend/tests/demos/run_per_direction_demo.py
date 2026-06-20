# One-off demo: run the two known addresses through the live pipeline and print
# the per-direction BAL breakdown plus the overall (worst-governs) result.
#
# Run:  .venv/Scripts/python.exe -m tests.demos.run_per_direction_demo

import asyncio

from app.models.assessment import AssessmentRequest
from app.services.assessment_pipeline import run_assessment

ADDRESSES = [
    "11 Cryptandra St, Denham Court NSW 2565",  # expect woodland -> BAL-12.5-ish
    "12A Abbey Cl, Watanobbi NSW 2259",          # expect Coastal Swamp Forest -> BAL-29
]


async def assess(address: str) -> dict | None:
    result = None
    async for kind, payload in run_assessment(AssessmentRequest(address=address)):
        if kind == "error":
            print(f"  ERROR {payload['status_code']}: {payload['detail']}")
            return None
        if kind == "result":
            result = payload
    return result


def print_result(address: str, result: dict) -> None:
    print(f"\n=== {address}")
    print(f"  matched: {result['matched_address']}  (FDI {result['fire_danger_index']})")
    print(f"  OVERALL BAL: {result['bal_rating']}  "
          f"(governing direction: {result['governing_direction']})")
    print(f"  top-level distance={result['nearest_vegetation_distance_m']} m  "
          f"slope={result['effective_slope_degrees']}deg {result['slope_direction']}  "
          f"pbp={result['pbp_formation']}  review={result['requires_manual_review']}")
    print("  per-direction:")
    header = (f"    {'dir':<6} {'found':<6} {'class':<18} {'src':<5} "
              f"{'dist_m':>7} {'eff_slope':>9} {'slope_dir':<10} {'BAL':<9} review")
    print(header)
    for side in result["per_direction"]:
        dist = "-" if side["distance_m"] is None else f"{side['distance_m']:.1f}"
        print(f"    {side['direction']:<6} {str(side['vegetation_found']):<6} "
              f"{str(side['vegetation_class']):<18} {side['class_source']:<5} "
              f"{dist:>7} {side['effective_slope_degrees']:>9} "
              f"{side['slope_direction']:<10} {side['bal_rating']:<9} "
              f"{side['requires_manual_review']}")


async def main() -> None:
    for address in ADDRESSES:
        result = await assess(address)
        if result is not None:
            print_result(address, result)


if __name__ == "__main__":
    asyncio.run(main())

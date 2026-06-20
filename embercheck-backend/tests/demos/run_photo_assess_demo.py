# End-to-end demo for POST /assess/photos: drives the real FastAPI app (real
# NSW map/slope data) with the VLM simulated, so we can see the four photos
# sharpen the per-direction BAL through the full HTTP loop.
#
# Run:  .venv/Scripts/python.exe -m tests.demos.run_photo_assess_demo

import json

from fastapi.testclient import TestClient

import app.services.vegetation_vision as vision
from app.main import app

client = TestClient(app)

# A tiny valid 1x1 JPEG data URL. The VLM is simulated here, so pixels don't
# matter - this just stands in for a real capture photo end to end (and gets
# decoded + written by the storage step).
TINY_JPEG = (
    "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAP//////////////////"
    "////////////////////////////////////////////////////////////2wBDAf//////"
    "////////////////////////////////////////////////////////////////////////"
    "//////wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAAAv/EABQQAQAAAAAA"
    "AAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP"
    "/aAAwDAQACEQMRAD8AfwD/2Q=="
)


def make_photos():
    return [
        {
            "intended_direction": d,
            "image": TINY_JPEG,
            "compass_heading_at_capture": heading,
            "location": {"lat": -33.0, "lng": 151.0, "accuracy_in_metres": 8},
            "captured_at": "2026-06-14T01:23:45.000Z",
            "direction_source": "compass",
            "quality_check_results": [
                {"name": "brightness", "passed": True, "value": 120},
                {"name": "sharpness", "passed": True, "value": 90},
            ],
        }
        for d, heading in [("north", 0), ("east", 90), ("south", 180), ("west", 270)]
    ]


def patch_vlm(reads_by_direction):
    """Simulate the Groq VLM: return a fixed read per direction."""

    async def fake_read(image_data_url, direction):
        r = reads_by_direction.get(
            direction, {"class": "cant_tell", "confidence": 0.0}
        )
        return {
            "direction": direction,
            "class": r["class"],
            "confidence": r["confidence"],
            "condition": r.get("condition"),
            "limits": r.get("limits"),
        }

    vision.read_vegetation = fake_read


def free_screen_bal(address, overrides=None):
    body = {"address": address, **(overrides or {})}
    return client.post("/assess", json=body).json()


def print_sharpened(label, address, reads, sharpened, free_bal):
    print(f"\n{'=' * 78}\n{label}\n{'=' * 78}")
    print(f"address        : {address}")
    print(f"free-screen BAL: {free_bal}")
    print(f"sharpened BAL  : {sharpened['bal_rating']}  "
          f"(governing: {sharpened['governing_direction']})  "
          f"is_sharpened={sharpened.get('is_sharpened')}  id={sharpened.get('assessment_id')}")
    arrow = _change(free_bal, sharpened["bal_rating"])
    print(f"change         : {free_bal} -> {sharpened['bal_rating']}  [{arrow}]")
    print(f"overall review : {sharpened['requires_manual_review']}")
    print("\nsimulated VLM reads per side:")
    for d, r in reads.items():
        print(f"   {d:<6} {r['class']:<10} conf={r['confidence']}")
    print("\nper-direction (sharpened):")
    print(f"   {'dir':<6} {'class':<10} {'src':<5} {'dist_m':>7} {'slope':>6} "
          f"{'BAL':<9} review  why")
    for s in sharpened["per_direction"]:
        dist = "-" if s["distance_m"] is None else f"{s['distance_m']:.1f}"
        read = s.get("photo_read") or {}
        why = read.get("condition") or read.get("limits") or ""
        print(f"   {s['direction']:<6} {str(s['vegetation_class']):<10} "
              f"{s['class_source']:<5} {dist:>7} {s['effective_slope_degrees']:>6} "
              f"{s['bal_rating']:<9} {str(s['requires_manual_review']):<6} {why}")


_ORDER = ["BAL-LOW", "BAL-12.5", "BAL-19", "BAL-29", "BAL-40", "BAL-FZ"]


def _change(before, after):
    if before == after:
        return "same"
    return "UP" if _ORDER.index(after) > _ORDER.index(before) else "DOWN"


def main():
    # ---- RAISE: Denham Court, East map=Woodland(BAL-12.5); photo says Forest --
    raise_reads = {
        "east": {"class": "Forest", "confidence": 0.85,
                 "condition": "dry sclerophyll, dense understorey"},
    }
    patch_vlm(raise_reads)
    addr1 = "11 Cryptandra St, Denham Court NSW 2565"
    # East's vegetation is ~87 m away; at that range Woodland and Forest share a
    # band, so we set the assessor slope (a real existing override) to 18 deg to
    # show the formation change actually crossing a band (BAL-12.5 -> BAL-19).
    overrides1 = {"slope_override": 18}
    free1 = free_screen_bal(addr1, overrides1)["bal_rating"]
    photos = make_photos()
    print("\nREQUEST (example) POST /assess/photos:")
    preview = {"address": addr1, **overrides1, "photos": [
        {**p, "image": p["image"][:42] + "...<jpeg truncated>"} for p in photos]}
    print(json.dumps(preview, indent=2)[:1400])
    resp1 = client.post("/assess/photos",
                        json={"address": addr1, **overrides1, "photos": photos})
    print_sharpened("RAISE - photo Forest over map Woodland (slope 18deg)", addr1,
                    {d: raise_reads.get(d, {"class": "cant_tell", "confidence": 0.0})
                     for d in ["north", "east", "south", "west"]},
                    resp1.json(), free1)

    # ---- LOWER: Watanobbi, South map=Forest(BAL-29); photo says low_risk -------
    lower_reads = {
        "south": {"class": "low_risk", "confidence": 0.85,
                  "condition": "mown grass / managed yard, no real fuel"},
    }
    patch_vlm(lower_reads)
    addr2 = "12A Abbey Cl, Watanobbi NSW 2259"
    free2 = free_screen_bal(addr2)["bal_rating"]
    resp2 = client.post("/assess/photos", json={"address": addr2, "photos": make_photos()})
    print_sharpened("LOWER - photo low_risk over map Forest (downgrade flagged)", addr2,
                    {d: lower_reads.get(d, {"class": "cant_tell", "confidence": 0.0})
                     for d in ["north", "east", "south", "west"]},
                    resp2.json(), free2)

    # ---- RESILIENCE: no API key -> real VLM returns cant_tell -> map kept ------
    import importlib
    importlib.reload(vision)  # restore the real read_vegetation (no key configured)
    # main.py captured read_photos at import; rebind it to the reloaded module's.
    import app.main as main_mod
    main_mod.read_photos = vision.read_photos
    main_mod.build_photo_overrides = vision.build_photo_overrides
    resp3 = client.post("/assess/photos", json={"address": addr2, "photos": make_photos()})
    s3 = resp3.json()
    print(f"\n{'=' * 78}\nRESILIENCE — no GROQ_API_KEY (real VLM), nothing crashes\n{'=' * 78}")
    print(f"sharpened BAL  : {s3['bal_rating']} (governing {s3['governing_direction']})  "
          f"== free-screen {free2}? {s3['bal_rating'] == free2}")
    print("per-side sources:", {s["direction"]: s["class_source"] for s in s3["per_direction"]})
    print("photo_reads classes:", {d: r["class"] for d, r in s3["photo_reads"].items()})


if __name__ == "__main__":
    main()

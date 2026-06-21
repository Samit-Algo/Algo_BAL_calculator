# Two targeted verifications requested after the Step 3 + Step 4 changes:
#
#   A. C1 uncertain-exclusion distance parity — a synthetic patch whose
#      crosswalk row is Excluded + (manual_review or Low confidence) must:
#        1) NOT enter hazardous_patches,
#        2) be tracked by low_confidence_excluded_min_distance_m,
#        3) produce the same distance_m as the old _patch_distance_to_site call
#           (assert equality, don't eyeball),
#        4) raise the review flag in the pipeline.
#
#   B. Cross-user ownership — the two new sector-photo endpoints must reject
#      a valid user whose id doesn't own the case (expect 404, matching the
#      existing case-ownership pattern that never reveals a case exists for
#      someone else).
#
# Run:  .venv/Scripts/python.exe -m tests.test_c1_and_cross_user_auth

import asyncio
import io

import httpx

BASE = "http://127.0.0.1:8000"


# ---------------------------------------------------------------------------
# A. C1 uncertain-exclusion distance parity (unit-level, no network)
# ---------------------------------------------------------------------------

def test_c1_uncertain_exclusion_distance_parity():
    """Synthesise an uncertain-Excluded patch, run it through the refactored
    scan loop, and confirm the distance equals what _patch_distance_to_site
    would have produced.  Also confirm it is NOT in hazardous_patches and IS
    tracked by low_confidence_excluded_min_distance_m."""

    from shapely.geometry import Point, box, mapping
    from shapely.ops import nearest_points

    from app.services.vegetation_scan import (
        _TO_NSW_LAMBERT,
        _patch_distance_to_site,
        _to_polygon_parts,
        find_nearest_vegetation,
    )
    from app.services.vegetation_classifier import classify_vegetation

    # Pick a real NSW point and build geometries in EPSG:3308.
    lon, lat = 150.8167, -33.9875
    site_x, site_y = _TO_NSW_LAMBERT.transform(lon, lat)
    site_geom = Point(site_x, site_y)

    # Build an uncertain-Excluded patch 80 m east of the site.
    patch_geom_3308 = box(site_x + 70, site_y - 10, site_x + 90, site_y + 10)

    # The real SVTM API returns geometry in EPSG:3308 (outSR=3308), so the
    # feature dict carries 3308 coordinates, not WGS84.
    patch_geojson_3308 = mapping(patch_geom_3308)

    # Confirm the crosswalk classifies this as uncertain-Excluded.
    svtm_class = "Alpine Bogs and Fens"
    classification = classify_vegetation(svtm_class)
    assert classification["as3959_class"] == "Excluded"
    assert classification["confidence"] == "Low"
    assert classification["manual_review"] is True
    print(f"  crosswalk: {svtm_class} -> {classification}")

    # --- Old path: _patch_distance_to_site (EPSG:3308 in, 3308 site) ---
    old_distance = _patch_distance_to_site(patch_geojson_3308, site_geom)
    assert old_distance is not None
    old_distance_rounded = round(old_distance, 1)
    print(f"  old _patch_distance_to_site: {old_distance_rounded} m")

    # --- New path: the refactored loop logic (EPSG:3308 in, 3308 site) ---
    polygon_parts = _to_polygon_parts(patch_geojson_3308)
    assert len(polygon_parts) > 0
    closest_part = min(polygon_parts, key=site_geom.distance)
    _, closest_point = nearest_points(site_geom, closest_part)
    new_distance = site_geom.distance(closest_point)
    new_distance_rounded = round(new_distance, 1)
    print(f"  new refactored distance:     {new_distance_rounded} m")

    # THE KEY ASSERTION: both paths produce the identical distance.
    assert old_distance_rounded == new_distance_rounded, (
        f"Distance mismatch: old={old_distance_rounded} vs new={new_distance_rounded}"
    )
    print("  PASS: distances are equal")

    # --- Full integration: run find_nearest_vegetation with fake features ---
    # All fake feature geometry is in EPSG:3308 (matching the real SVTM API).
    hazardous_geom_3308 = box(site_x + 120, site_y - 10, site_x + 140, site_y + 10)
    hazardous_geojson_3308 = mapping(hazardous_geom_3308)

    fake_features = [
        {
            "properties": {"vegClass": "Hinterland Sandstone Dry Sclerophyll Forests",
                           "vegForm": "Dry sclerophyll forests", "PCTID": 1, "PCTName": "Fake Woodland"},
            "geometry": hazardous_geojson_3308,
        },
        {
            "properties": {"vegClass": svtm_class, "vegForm": "Freshwater Wetlands",
                           "PCTID": 2, "PCTName": "Fake Swamp"},
            "geometry": patch_geojson_3308,
        },
    ]

    import app.services.vegetation_scan as vs_mod
    original_fetch = vs_mod._fetch_vegetation_polygons

    async def fake_fetch(*args, **kwargs):
        return fake_features

    vs_mod._fetch_vegetation_polygons = fake_fetch
    try:
        result = asyncio.get_event_loop().run_until_complete(
            find_nearest_vegetation(lat, lon, 200)
        )
    finally:
        vs_mod._fetch_vegetation_polygons = original_fetch

    # 1) The uncertain-Excluded patch must NOT be in hazardous_patches.
    for patch in result["hazardous_patches"]:
        assert patch["as3959_class"] != "Excluded", (
            f"Excluded patch leaked into hazardous_patches: {patch}"
        )
    print("  PASS: uncertain-Excluded patch NOT in hazardous_patches")

    # 2) It MUST be tracked as low_confidence_excluded_min_distance_m.
    lce = result["low_confidence_excluded_min_distance_m"]
    assert lce is not None, "Expected low_confidence_excluded_min_distance_m to be set"
    assert lce == old_distance_rounded, (
        f"C1 tracked distance ({lce}) != old _patch_distance_to_site ({old_distance_rounded})"
    )
    print(f"  PASS: low_confidence_excluded_min_distance_m = {lce} m (matches old path exactly)")

    # The hazardous patch should still be found.
    assert result["vegetation_found"] is True
    print(f"  hazardous nearest: {result['nearest_as3959_class']} at {result['nearest_distance_m']} m")


def test_c1_review_flag_raised_in_pipeline():
    """When an uncertain-Excluded patch is closer than the nearest hazardous
    one, the pipeline must set requires_manual_review and include a review
    reason — this is the C1 safety net."""

    from shapely.geometry import box, mapping

    import app.services.vegetation_scan as vs_mod
    from app.services.assessment_pipeline import run_assessment
    from app.models.assessment import AssessmentRequest

    lon, lat = 150.8167, -33.9875
    site_x, site_y = vs_mod._TO_NSW_LAMBERT.transform(lon, lat)

    # Uncertain-Excluded 50 m away (closer than the hazardous patch).
    uncertain_geom = mapping(box(site_x + 40, site_y - 10, site_x + 60, site_y + 10))
    # Hazardous patch 100 m away.
    hazardous_geom = mapping(box(site_x + 90, site_y - 10, site_x + 110, site_y + 10))

    fake_features = [
        {
            "properties": {"vegClass": "Hinterland Sandstone Dry Sclerophyll Forests",
                           "vegForm": "Dry sclerophyll forests", "PCTID": 1, "PCTName": "X"},
            "geometry": hazardous_geom,
        },
        {
            "properties": {"vegClass": "Alpine Bogs and Fens",
                           "vegForm": "Freshwater Wetlands", "PCTID": 2, "PCTName": "Y"},
            "geometry": uncertain_geom,
        },
    ]

    original_fetch = vs_mod._fetch_vegetation_polygons

    async def fake_fetch(*args, **kwargs):
        return fake_features

    vs_mod._fetch_vegetation_polygons = fake_fetch
    try:
        request = AssessmentRequest(address="11 Cryptandra St, Denham Court NSW 2565")
        result = None

        async def run():
            nonlocal result
            async for kind, payload in run_assessment(request):
                if kind == "result":
                    result = payload

        asyncio.get_event_loop().run_until_complete(run())
    finally:
        vs_mod._fetch_vegetation_polygons = original_fetch

    assert result is not None, "Pipeline did not produce a result"
    assert result["requires_manual_review"] is True, (
        f"Expected requires_manual_review=True, got {result['requires_manual_review']}"
    )
    reasons = result.get("manual_review_reasons", [])
    assert len(reasons) > 0, "Expected manual_review_reasons to be non-empty"
    assert "could not be confidently classified" in reasons[0].lower() or \
           "nearest fuel" in reasons[0].lower(), (
        f"Unexpected review reason: {reasons[0]}"
    )
    print(f"  PASS: review flag raised, reason: {reasons[0][:80]}...")


# ---------------------------------------------------------------------------
# B. Cross-user ownership on sector-photo endpoints (live, requires server)
# ---------------------------------------------------------------------------

def test_cross_user_photo_auth():
    """Create a case as user A, upload a photo, then as user B try to upload
    and read — both must fail with 404 (the ownership check never reveals that
    a case exists for another user)."""

    with httpx.Client(timeout=180, base_url=BASE) as c:
        # Register / login user A
        c.post("/auth/register", json={"email": "userA_test@test.com",
                                       "password": "TestPassA1!", "name": "A"})
        r = c.post("/auth/login", json={"email": "userA_test@test.com",
                                        "password": "TestPassA1!"})
        assert r.status_code == 200, f"Login A failed: {r.status_code}"
        token_a = r.json()["access_token"]
        headers_a = {"Authorization": f"Bearer {token_a}"}

        # Register / login user B
        c.post("/auth/register", json={"email": "userB_test@test.com",
                                       "password": "TestPassB1!", "name": "B"})
        r = c.post("/auth/login", json={"email": "userB_test@test.com",
                                        "password": "TestPassB1!"})
        assert r.status_code == 200, f"Login B failed: {r.status_code}"
        token_b = r.json()["access_token"]
        headers_b = {"Authorization": f"Bearer {token_b}"}

        # User A creates a boundary case
        lat, lon = -33.98750183, 150.81667187
        offset = 0.00015
        polygon = {
            "type": "Polygon",
            "coordinates": [[
                [lon - offset, lat - offset],
                [lon + offset, lat - offset],
                [lon + offset, lat + offset],
                [lon - offset, lat + offset],
                [lon - offset, lat - offset],
            ]],
        }
        r = c.post("/cases", json={"address": "11 Cryptandra St, Denham Court NSW 2565",
                                   "boundary_polygon": polygon}, headers=headers_a)
        assert r.status_code == 201, f"Create case failed: {r.status_code} {r.text}"
        case_id = r.json()["id"]
        print(f"  User A case: {case_id}")

        # User A uploads a photo (should succeed)
        jpeg = bytes([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46,
                      0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01,
                      0x00, 0x01, 0x00, 0x00, 0xFF, 0xD9])
        files_a = [("files", ("a.jpg", io.BytesIO(jpeg), "image/jpeg"))]
        r = c.post(f"/cases/{case_id}/sectors/East/photos",
                   files=files_a, headers=headers_a)
        assert r.status_code == 200, f"User A upload failed: {r.status_code}"
        print(f"  User A upload: {r.status_code} (OK)")

        # --- User B tries to POST a photo to A's case ---
        files_b = [("files", ("b.jpg", io.BytesIO(jpeg), "image/jpeg"))]
        r = c.post(f"/cases/{case_id}/sectors/East/photos",
                   files=files_b, headers=headers_b)
        assert r.status_code == 404, (
            f"Cross-user POST should be 404, got {r.status_code}: {r.text}"
        )
        print(f"  User B POST photo: {r.status_code} (correctly rejected)")

        # --- User B tries to GET A's photo ---
        r = c.get(f"/cases/{case_id}/sectors/East/photos/0", headers=headers_b)
        assert r.status_code == 404, (
            f"Cross-user GET should be 404, got {r.status_code}: {r.text}"
        )
        print(f"  User B GET photo:  {r.status_code} (correctly rejected)")

        # Sanity: User A CAN still read the photo
        r = c.get(f"/cases/{case_id}/sectors/East/photos/0", headers=headers_a)
        assert r.status_code == 200, f"User A GET failed: {r.status_code}"
        print(f"  User A GET photo:  {r.status_code} (still works)")


# ---------------------------------------------------------------------------

if __name__ == "__main__":
    print("=== A1. C1 uncertain-exclusion distance parity ===")
    test_c1_uncertain_exclusion_distance_parity()
    print()
    print("=== A2. C1 review flag raised in pipeline ===")
    test_c1_review_flag_raised_in_pipeline()
    print()
    print("=== B. Cross-user ownership on sector-photo endpoints ===")
    test_cross_user_photo_auth()
    print()
    print("ALL CHECKS PASSED")

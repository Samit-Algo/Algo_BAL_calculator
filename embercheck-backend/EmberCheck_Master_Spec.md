# EmberCheck — Master Specification

**Project:** NSW bushfire BAL (Bushfire Attack Level) screening tool
**This document is the single source of truth and describes what the code actually does.**
If the spec and the code disagree, the **code wins** — update this document to match.

---

## Table of contents
1. Overview & purpose
2. Architecture
3. The assessment pipeline (step by step)
4. The photo feature (sharpened read)
5. Safety rules
6. Manual overrides & reset
7. Internal API (endpoints + shapes)
8. External APIs (consumed)
9. Reference data files
10. Method 1 vs Method 2
11. Conservative defaults (fail-safe)
12. Storage & logging
13. Map UI & geometry
14. Known limitations / TODO
15. Disclaimer

---

## 1. Overview & purpose

EmberCheck takes a NSW street address and returns an **indicative BAL rating**
(BAL-LOW → BAL-FZ) — a **preliminary screening result, not a certified assessment**.
It combines the four inputs AS 3959 / NSW RFS *Planning for Bush Fire Protection
2019* (PBP) use:

1. **Fire Danger Index (FDI)** — fixed regulatory value by LGA (50 / 80 / 100).
2. **Vegetation** — nearest hazardous vegetation on each side of the property.
3. **Distance** — metres from the building to that vegetation.
4. **Slope** — effective slope between the building and the vegetation.

Two things make this build different from a naive single-point screen:

- **Per-direction assessment.** The property is split into four compass sectors
  (N/E/S/W). Each side is rated on its own, and the **worst side governs** the
  overall house BAL — the way an assessor works per-aspect.
- **Optional photo sharpening.** A guided four-photo capture feeds a server-side
  vision model (Groq VLM) that classifies the vegetation on each side. A
  confident photo read can drive that side's BAL, with safety rules on the
  direction of change.

A formal BAL assessment by an accredited consultant is still required for a
development application.

---

## 2. Architecture

| Layer | Stack | Notes |
|---|---|---|
| Backend | FastAPI (Python), `httpx`, `shapely`, `pyproj` | Stateless. Calls live NSW government APIs + reads static JSON reference files. |
| Vision | Groq VLM (OpenAI-compatible chat/vision API) | Server-side only; the key never reaches the browser. |
| Frontend | React + Vite | Talks to the backend over JSON / Server-Sent Events. |
| Persistence | MongoDB via Beanie ODM (PyMongo async client) (Phase 1); local files for photo training-data records + VLM log | `fastapi-users` planned for consumer-account auth. |

The **assessment flow itself is stateless** — state for one assessment lives only
in the request / response, and photo captures are written to disk as
training-data records (§12). Phase 1 adds a MongoDB layer **alongside** it for
consumer accounts and saved assessments, without changing the assessment routes.

**Phase 1 persistence foundation** (`app/core/config.py`, `app/db/mongodb.py`,
`app/models/user.py`, `app/models/case.py`): a PyMongo `AsyncMongoClient`
connects to MongoDB and `init_beanie` registers two documents, wired via
the FastAPI lifespan (DB init is non-fatal — a DB outage never stops the
stateless assessment routes; `GET /db/ping` reports connectivity).
- **User** (`users`): the `fastapi-users` Beanie base user (`email`,
  `hashed_password`, `is_active`, `is_superuser`, `is_verified`) plus `name`,
  `created_at`, `auth_provider` (`"local"`/`"google"`), `google_id`. Auth
  endpoints, token issuance and the `UserManager` are a later step.
- **Case** (`cases`): one user's saved assessment — `user_id` (indexed),
  embedded `PropertyInfo`, the full `/assess` response stored as-is in
  `assessment` (with `bal_rating`/`governing_direction` denormalised for
  listing), `photos[]`, and a `status` workflow enum (indexed).

**Auth backend (Step 2):** `fastapi-users` 15.x with a Beanie adapter
(`app/auth/`). A `UserManager` (`ObjectIDIDMixin`, password ≥ 8) handles signup
and password hashing; a single `JWTStrategy` (HS256, `AUTH_SECRET`) mints/
validates the Bearer access token so the `current_active_user` dependency
guards protected routes. The refresh token is a custom, DB-backed, rotating
credential (§12) — not a JWT. Reset-password / verification token secrets are
wired but not yet exposed as routes.

---

## 3. The assessment pipeline (step by step)

Driven by `app/services/assessment_pipeline.py::run_assessment` — a single async
generator that both `/assess` and `/assess/stream` consume, so the streaming and
non-streaming paths run identical logic.

```
1. Address  → coordinates              (Geoscape Predictive Address)
2. Coords   → LGA                       (NSW Spatial Services boundary)
3. LGA      → Fire Danger Index         (static fdi_nsw.json; default 100)
4. Per-direction vegetation scan        (NSW SVTM vector polygons, 150 m radius)
5. Per-direction slope                  (NSW 5 m Elevation)
6. Per-direction BAL (Method 1)         (static pbp_bal_tables.json + bridges)
7. Worst side governs → overall BAL
```

**Step 4 — per-direction vegetation scan** (`vegetation_scan.py`):
- Fetch every hazardous SVTM polygon within `VEGETATION_SEARCH_RADIUS_METRES`
  (**150 m**) of the house, paging the SVTM layer while `exceededTransferLimit`.
- Compute each patch's bearing from the house and bin it into a compass sector:
  **North 315–45°, East 45–135°, South 135–225°, West 225–315°**.
- For each sector, keep the **nearest** hazardous patch and the point on it
  closest to the house (reprojected to lat/lon for the slope step).
- A sector with no hazardous patch → `vegetation_found = False` (rated BAL-LOW).

**Step 5 — per-direction slope** (`slope_analyzer.py`):
- For each side with vegetation, read ground height at the house and at that
  side's nearest vegetation point (NSW 5 m Elevation `identify`).
- **Effective slope counts only downslope.** If the vegetation sits *below* the
  house (`downslope`), fire runs uphill toward the house → the angle is kept. If
  it sits *above* (`upslope`) or level (`flat`), AS 3959 treats it as **0°**.
  Height differences under `FLAT_HEIGHT_TOLERANCE_METRES` (0.5 m) count as flat.

**Step 6 — per-direction BAL** (`bal_calculator.py`, Method 1 table lookup):
- Map the side's SVTM `vegForm` → PBP formation (`pbp_formation_mapper.py` using
  `vegform_to_pbp_formation.json`).
- Band the distance against `pbp_bal_tables.json[fdi][slope_band][formation]`
  thresholds `[t1..t5]`:
  `d<t1`→FZ, `t1≤d<t2`→40, `t2≤d<t3`→29, `t3≤d<t4`→19, `t4≤d<t5`→12.5, `d≥t5`→LOW.

**Step 7 — worst side governs:** the side with the highest severity
(`BAL-LOW < BAL-12.5 < BAL-19 < BAL-29 < BAL-40 < BAL-FZ`) sets the overall
`bal_rating` and `governing_direction`. The top-level `pbp_formation`, slope and
distance fields report the governing side; `requires_manual_review` is true if
**any** side (or the overall-nearest crosswalk) needs review.

---

## 4. The photo feature (sharpened read)

Guided capture lives in the frontend (`CaptureFlow.jsx`, `lib/capture.js`); the
vision read and re-assessment are server-side.

**Capture (frontend):** four photos, one per compass direction. Each photo carries
`intended_direction`, `compass_heading_at_capture`, `location` (GPS), `captured_at`,
`direction_source` (`compass` | `manual`), `quality_check_results`, and the JPEG
`image` (data URL). The compass overlay aligns the user to each target within
`ALIGN_TOLERANCE` (**±25°**); on-device quality checks reject frames below
brightness 40 or sharpness 55. Before upload, images are downscaled to a long
edge of ~**1600 px** (the VLM doesn't need full resolution).

**Vision read (`vegetation_vision.py`):** each photo is sent to the Groq VLM
(default model `meta-llama/llama-4-scout-17b-16e-instruct`, overridable via
`GROQ_VLM_MODEL`). The prompt asks for strict JSON: `reasoning`, `class`,
`confidence` (0–1), `condition`, `limits`. `class` is one of:
`Forest, Woodland, Shrubland, Scrub, Mallee/Heath, Rainforest, Grassland,
low_risk, cant_tell`. **Resilient:** a missing key, network/HTTP error, or
unparseable / out-of-range answer degrades to a `cant_tell` read — the request
never fails on a bad photo.

**Drive the BAL:** confident reads become `photo_overrides = { direction:
{class, confidence} }`; the same per-direction pipeline re-runs with them. The
photo's class maps to a PBP formation (`photo_class_mapper.py`) that **replaces**
the map's `vegForm`-derived formation for that side. **Distance and slope always
come from the map** — the photo only changes the vegetation type. The endpoint
also returns the raw VLM read per side so the UI can show "why".

---

## 5. Safety rules

These are the safety-critical behaviours. None of them may change without review.

- **Confidence threshold = 0.7** (`PHOTO_CONFIDENCE_THRESHOLD`). Below it, or for
  `cant_tell`, the photo is ignored and the conservative **map** value stands.
- **Raise is free; a downgrade is flagged.** If the photo's BAL is ≥ the map's
  BAL for that side, use it (no extra flag). If the photo's BAL is **lower** than
  the map's, still apply it but set `requires_manual_review = True` — a downgrade
  must be human-confirmed.
- **Coastal Swamp Forest → Forest override.** The SVTM "Forested Wetlands"
  formation maps (via a `requires_pct_override` rule) to the much shorter wetland
  row, which under-rates Coastal Swamp Forest (e.g. BAL-12.5 instead of BAL-29 at
  ~31 m). `bal_calculator.py` resolves this using the class-level AS 3959 result:
  it substitutes the worst-case **Forest** row and flags the result for review.
- **Scrub / Mallee-Heath are conservative + review.** Neither has a dedicated PBP
  row, so both map to the densest available shrub row (**Tall Heath**) and are
  flagged for manual review.
- **Unknown / unmapped vegetation → worst-case Forest + review** (never silently
  dropped, unless it's an explicit "Excluded" formation → BAL-LOW).
- **Photo sees vegetation the map missed.** If a side has no map vegetation (no
  distance) but a confident hazardous photo read, the side is surfaced with the
  photo's class, flagged `needs_distance` + review, and held at BAL-LOW **until a
  distance is supplied** (we never invent a distance).
- **FDI is global** — one regulatory value per property (per LGA), not per side.
- **Effective slope counts only downslope** — upslope/flat = 0° (§3, step 5).
- **Worst side governs** the overall house BAL (§3, step 7).

---

## 6. Manual overrides & reset

Because the map or the AI can mismatch reality, the result page lets a user
override inputs and recompute instantly (`bal_recalculate.py`,
`/assess/recalculate`) — **no map re-scan**:

| Input | Scope | Notes |
|---|---|---|
| Vegetation type | per side | AS 3959 class; re-maps the PBP formation. `low_risk` → BAL-LOW. |
| Distance (m) | per side | Adding one to a `needs_distance` side rates it immediately. |
| Slope | per side | Direction (downslope / upslope / flat) + degrees. Upslope/flat → effective 0°. |
| Fire Danger Index | global | 50 / 80 / 100, or Auto. |

Each effective value = the override when supplied, else the base value. **Reset**
clears all overrides (and FDI), which reproduces the original map/photo result —
i.e. sending no overrides to `/assess/recalculate` returns the baseline.

---

## 7. Internal API (endpoints + shapes)

Base URL is env-driven on the frontend (`VITE_API_BASE_URL`, empty in dev).

### `GET /health`
`→ { "status": "ok" }`

### `GET /db/ping`
Lightweight MongoDB connectivity check (admin `ping`; no data read or exposed).
`→ { "db": "ok" }` · `503` if the database is unreachable.

### Auth & accounts (Phase 1, Step 2)

Email/password consumer accounts via `fastapi-users` + Beanie. **Bearer access
token (JWT) in the `Authorization` header; no cookies.** The JWT is minted and
validated by one `JWTStrategy` (`AUTH_SECRET`, `ACCESS_TOKEN_LIFETIME_SECONDS`).
The refresh token is custom, DB-backed and rotated (see §12). No existing route
is gated yet (that's Step 3).

#### `POST /auth/register`
Signup. Request: `{ email, password, name? }` (password ≥ 8 chars).
`→ 201` `UserRead` `{ id, email, is_active, is_superuser, is_verified, name,
created_at, auth_provider }` — **never** the password hash. `400` on a weak
password or duplicate email.

#### `POST /auth/login`
Request: `{ email, password }`.
`→ { access_token, refresh_token, token_type: "bearer" }`. `400` on bad
credentials (no leak of whether the email exists).

#### `POST /auth/refresh`
Request: `{ refresh_token }`. Validates the token by hash; **rotates** it
(revokes the presented row, issues a new one) and mints a new access token.
`→ { access_token, refresh_token, token_type }`. `401` if the token is unknown,
revoked or expired (so a reused/old token is rejected).

#### `POST /auth/logout`
Requires `Authorization: Bearer <access>`. Request: `{ refresh_token }`. Revokes
that refresh row (idempotent). `→ { "detail": "Logged out." }`. Access tokens are
stateless and simply expire.

#### `GET` / `PATCH /users/me`
fastapi-users self-service, requires a valid access token (`current_active_user`).
`GET → UserRead`; `PATCH` accepts `UserUpdate` (`{ name?, email?, password? }`).
Missing/invalid token → `401`.

### Cases (Phase 1, Step 3a + 5b-i)

The free `/assess` screen stays public; saving a result and running deep analysis
(photos) require login and live inside a **Case** owned by the user. A user can
only touch their own cases — a missing case, a malformed id, or someone else's
case all return the **same 404** (existence is never revealed; no 403).

**Governing vegetation is derived on read** (not stored): `CaseRead`/`CaseSummary`
expose `governing_vegetation` — the `vegetation_class` of the `per_direction`
entry matching `governing_direction` (e.g. "Woodland"), falling back to the
top-level `vegetation_type` then `None`. The stored `assessment` dict is never
mutated or backfilled.

#### `POST /cases`
Requires `current_active_user`. Runs the assessment **server-side via the exact
same pipeline as `/assess`** (boundary mode included) and saves it.
Request (`CaseCreateRequest`): `address` (str, req), `boundary_polygon`
(GeoJSON Polygon/Feature?, mirrors `site_polygon`), `fire_danger_override`,
`slope_override`. `→ 201` `CaseRead` `{ id, status, property, assessment,
bal_rating, governing_direction, governing_vegetation, photos, created_at,
updated_at, submitted_at }`. New cases start `status: DRAFT`. Assessment errors
surface as the same `404/400/503` as `/assess`.

#### `GET /cases`
Requires auth. `→ [CaseSummary]` — the caller's cases, **newest first**
(`updated_at` desc). Light shape (no full assessment dict):
`{ id, address, bal_rating, governing_direction, governing_vegetation, status,
created_at, updated_at, submitted_at }`.

#### `GET /cases/{case_id}`
Requires auth. `→ CaseRead` (incl. `governing_vegetation`, raw `assessment`
intact) for the caller's own case; unknown/malformed id or another user's case
→ `404`.

#### `GET /cases/{case_id}/photos/{direction}`
Requires auth (ownership 404). Streams a stored capture JPEG
(`image/jpeg`) for the resume/dashboard thumbnails, read from the photo_store
file referenced by the case's `CasePhoto.file_path` (the bytes live on disk, not
in MongoDB). Path-traversal guarded. Missing photo/file → `404`. The frontend
fetches it via `apiFetch` (Bearer) and shows it as an object URL.

#### `POST /cases/{case_id}/submit`
Requires auth (ownership 404). Submits a completed case for accredited
assessment — a **status transition only** (no assessor logic yet): sets
`status: SUBMITTED_TO_ASSESSOR` + `submitted_at`, bumps `updated_at`, returns the
updated `CaseRead`. Allowed only from `ANALYSIS_COMPLETE`; a still-`DRAFT` case →
`409` ("complete the photo analysis first"); already submitted → returns current
state (**idempotent**).

### `GET /suggest?q=<text>`
Address autocomplete. `< 3` chars or any upstream error → `[]` (never errors).
`→ [ "<address string>", ... ]`

### `POST /assess`
Run the full per-direction assessment for an address.
Request (`AssessmentRequest`): `address` (str, req), `fire_danger_override`
(int? 50/80/100), `slope_override` (float?), `photo_overrides`
(dict? `{ "<direction>": { "class": str, "confidence": float } }`).
Response: the assessment dict (see **Data fields** below).
Errors: `404` address not found · `400` outside NSW / invalid override · `503`
elevation service unavailable.

### `POST /assess/stream`
Same assessment as Server-Sent Events. Each event is JSON with `type` of
`progress` (`{stage, label, status, detail}`), `error` (`{status_code, detail}`),
or `result` (`{data: <assessment dict>}`).

### `POST /assess/photos`
**Login-only and case-bound** (Step 3a): sharpen a saved case with the four
capture photos. Requires `current_active_user`.
Request (`PhotoAssessmentRequest`): `case_id` (str, **required** — the case to
sharpen; its stored address drives the re-run), `fire_danger_override`,
`slope_override`, `photos` (list of `CapturedPhoto`, §4). `address`/`latitude`/
`longitude` are still accepted for the stored training-data record only.
Flow: load the caller's case (`404` if missing/not owned) → VLM read per photo →
`photo_overrides` → re-run pipeline → save the training-data record → persist the
sharpened result into the case (`assessment`, `bal_rating`,
`governing_direction`, `photos[]`, `status → ANALYSIS_COMPLETE`).
Response: the assessment dict **plus** `per_direction[].photo_read`
(`{class, confidence, condition, limits}`), `photo_reads` (same keyed by
direction), `is_sharpened: true`, `assessment_id`, and `case_id`.
The compute (VLM reads, per-direction re-run, safety rules) is **unchanged** —
it moved to `app/services/photo_assessment.py` and the route now gates + persists.

### `POST /assess/recalculate`
Recompute the BAL from known inputs + manual overrides — stateless, instant.
Request (`RecalcRequest`): `fire_danger_index` (int), `fire_danger_override`
(int?), `per_direction` (list of base side inputs echoed from a prior response),
`overrides` (`{ "<direction>": { distance_m?, effective_slope_degrees?,
vegetation_class? } }`).
Response: `{ fire_danger_index, per_direction[...], bal_rating,
governing_direction, requires_manual_review }`; each side carries `source`
(`map` | `photo` | `override`) and `overridden_fields`.

### Data fields (the assessment dict)

Top level: `address`, `matched_address`, `latitude`, `longitude`, `lga`,
`fire_danger_index`, `vegetation_type`, `svtm_vegetation_class`,
`as3959_vegetation_class`, `vegetation_pct_id`, `vegetation_pct_name`,
`vegetation_confidence`, `vegetation_manual_review`,
`nearest_vegetation_distance_m` (governing side), `vegetation_found_within_range`,
`slope_degrees`, `slope_direction`, `effective_slope_degrees`, `bal_rating`
(worst), `pbp_formation`, `bal_slope_band`, `requires_manual_review`,
`governing_direction`, `per_direction[]`, `geometry` (§13).

Each `per_direction[]` entry: `direction`, `vegetation_class`, `class_source`
(`map` | `photo`), `distance_m`, `effective_slope_degrees`, `slope_direction`,
`bal_rating`, `pbp_formation`, `requires_manual_review`, `needs_distance`,
`vegetation_found` (and, from `/assess/photos`, `photo_read`).

---

## 8. External APIs (consumed)

All NSW government sources are keyless except Geoscape. Groq needs a key.

| Purpose | Endpoint | Auth |
|---|---|---|
| Address → coords (Geoscape Predictive Address) | `api.psma.com.au/v1/predictive/address` | `Authorization: <GEOSCAPE_API_KEY>` (raw key) |
| Coords → LGA | `maps.six.nsw.gov.au/.../NSW_Administrative_Boundaries/MapServer/1/query` | none |
| Vegetation at a point (SVTM identify) | `mapprod3.environment.nsw.gov.au/.../SVTM_NSW_Extant_PCT/MapServer` | none |
| Hazardous polygon scan (SVTM layer 3) | `.../SVTM_NSW_Extant_PCT/MapServer/3/query` (`outSR=3308`, `where=PCTID<>0`, paged) | none |
| Ground height (NSW 5 m Elevation) | `maps.six.nsw.gov.au/.../NSW_5M_Elevation/ImageServer/identify` | none |
| Photo vegetation classification | Groq chat/vision (`GROQ_VLM_URL`) | `Authorization: Bearer <GROQ_API_KEY>` |

The elevation service has slow cold starts; the slope step uses a 30 s timeout
and retries once before surfacing a `503`.

---

## 9. Reference data files (`app/data/`)

| File | Holds | Used by |
|---|---|---|
| `fdi_nsw.json` | `fdi: { <normalised LGA>: 80\|100 }`, 129 LGAs, `default_if_missing: 100` | `fire_danger.py` — LGA → FDI; default 100 when unknown. |
| `pbp_bal_tables.json` | `tables[FDI][slope_band][PBP formation] = [t1..t5]` (metres) | `bal_calculator.py` — the distance-banding lookup (Method 1). |
| `vegform_to_pbp_formation.json` | Priority-ordered rules: SVTM `vegForm` substring → PBP formation (+ `confidence`, `manual_review`, `requires_pct_override`) | `pbp_formation_mapper.py` — bridges SVTM to the BAL table columns. |
| `svtm_as3959_crosswalk.json` | SVTM vegetation class (Layer 1) → AS 3959 class (+ `confidence`, `manual_review`) | `vegetation_classifier.py` — class-level read; resolves the Coastal-Swamp-Forest override. **DRAFT.** |

The `vegform → PBP` and `SVTM → AS 3959` crosswalks are **DRAFT** and need
bushfire/ecology sign-off before certified use. The default PBP formation (the
worst-case fallback) is the **Forest** row.

---

## 10. Method 1 vs Method 2

EmberCheck uses **Method 1** — the conservative AS 3959 / PBP **table lookup**
(formation × slope band × distance). It is deliberately cautious. A professional
**Method 2** site assessment (detailed radiant-heat calculation) **may yield a
lower BAL** for the same property. EmberCheck's output is a screening read meant
to flag risk, not to replace Method 2.

---

## 11. Conservative defaults (fail-safe)

- Unknown / missing LGA → **FDI 100** (worst case).
- Unknown / unmapped vegetation → worst-case **Forest** + `manual_review`.
- Slope steeper than the tables (> 20°) → steepest band + `manual_review`.
- No hazardous vegetation within 150 m on a side → **BAL-LOW** for that side.
- "No reliable mapping" (null formation) ≠ "no vegetation": the former → Forest +
  review; the latter → BAL-LOW.
- Bad / blocked photo → `cant_tell` → keep the conservative map value.
- A photo **downgrade** is always flagged for human confirmation.

---

## 12. Storage & logging

- **Photo training-data records** (`photo_store.py`): each `/assess/photos` call
  writes one folder under `PHOTO_STORAGE_DIR` (`data_store/photo_assessments/<id>/`)
  containing the four JPEGs and `record.json` (context, overall result,
  `per_direction`, `vlm_reads`, photo metadata). Best-effort — a storage failure
  never breaks the response.
- **VLM log** (`vegetation_vision.py`): every vision call appends the request, the
  **raw** model response, and the parsed result to `VLM_LOG_PATH`
  (`logs/vlm.log`) so misclassifications can be inspected.

Both directories are gitignored.

- **Refresh tokens** (`refresh_tokens` collection, Step 2): one row per issued
  refresh token — `user_id` (indexed), `token_hash` (indexed, unique),
  `expires_at`, `revoked`, `created_at`. Only **sha256(raw_token)** is stored;
  the raw token is returned to the client once and never persisted, so a DB read
  can't be replayed as a credential. `/auth/refresh` rotates (revokes the old row,
  issues a new one); `/auth/logout` marks a row revoked.
- **Cases** (`cases` collection, Step 3a + 5b-i): `POST /cases` saves the full
  assessment (`status: DRAFT`); `/assess/photos` updates the case in place with
  the sharpened assessment and a `photos[]` array (`status: ANALYSIS_COMPLETE`);
  `POST /cases/{id}/submit` moves it to `SUBMITTED_TO_ASSESSOR` and stamps
  `submitted_at` (transition only — no assessor-side logic yet). The capture
  JPEGs still live on disk in the photo_store record (above); each
  `CasePhoto.file_path` is the relative `<assessment_id>/<direction>.jpg` location
  there (the bytes are not duplicated into MongoDB).

---

## 13. Map UI & geometry

The backend returns shapes; the frontend (`AssessmentMap.jsx`, Leaflet) draws
them. The `geometry` object (EPSG:4326) contains:
`property_point`, `assessment_ring_m` (100), `search_buffer_m` (150),
`vegetation` (a GeoJSON `FeatureCollection` of all hazardous patches, the nearest
marked `governing`), and `distance_line` (house → the **governing** side's nearest
vegetation point).

---

## 14. Known limitations / TODO

- **Mallee mapping refinement.** The SVTM → AS 3959 crosswalk uses `Mallee/Mulga`,
  the photo classes use `Mallee/Heath`, and both Scrub and Mallee-Heath currently
  collapse onto the **Tall Heath** PBP row (conservative + review). This mapping
  needs a proper review.
- **Grassland vs CSIRO check.** Grassland thresholds and the broader table values
  should be cross-checked against CSIRO / PBP source data (see the batch
  cross-check demo runner).
- **Groq key required for the live VLM.** Without `GROQ_API_KEY` the photo step
  degrades to map values for every side (no sharpening).
- **Coords-only re-runs not wired.** `/assess/photos` requires an `address`
  (the pipeline geocodes it); `latitude`/`longitude` are stored only.
- **Crosswalks are DRAFT** — need bushfire/ecology sign-off before certified use.
- **NSW only** — all data sources are NSW government services.
- **Slope is screening-grade** (house-to-vegetation), not a full AS 3959 effective
  slope; the per-side manual override is provided for correction.
- **Consumer accounts (Phase 1) in progress.** Persistence (MongoDB + Beanie
  models, `/db/ping`), **email/password auth** (signup, login, refresh, logout,
  `/users/me`), **the gate** (Step 3a/3b — login-only, case-bound `/assess/photos`
  + the frontend wiring), and the **dashboard backend** (Step 5b-i — `GET /cases`
  list, `POST /cases/{id}/submit`, governing-vegetation display fix) are in place.
  `/assess` itself stays public. Next: the dashboard frontend (Step 5b-ii),
  Google OAuth (Step 4), and payment.
- **Not yet built:** dashboard frontend, Google/OAuth login, payment, a draggable
  "confirm location" pin, and the **assessor-side review** (the `/submit`
  transition exists; the accredited-assessor workflow does not yet).

---

## 15. Disclaimer

Output is an **indicative screening result**, not a certified BAL assessment.
A formal assessment by a qualified bushfire consultant is required for development
applications and regulatory purposes.

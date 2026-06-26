# EmberCheck — Master Specification

**Project:** NSW bushfire BAL (Bushfire Attack Level) screening tool
**Version:** 2.0 (2026-06-22)
**This document is the single source of truth and describes what the code actually does.**
If the spec and the code disagree, the **code wins** — update this document to match.

> **Core invariant (read this first).** EmberCheck must never show a **false-low** —
> a rating that sits *below* the real risk. Every default, fallback, photo
> combination, and override-reconciliation rule errs on the conservative (higher
> BAL) side. The tool's job is to **propose, never determine**: it surfaces an
> indicative read; only an accredited assessor (the future Console) certifies it,
> and only the assessor may *lower* a rating and sign it.

---

## Changelog

**2.0 (2026-06-22) — Boundary redesign.**
- **Boundary is now site reference AND measurement geometry** (per-side sectors,
  edge distance, slope sampling) — not just a draw-on-map nicety. §2, §13.
- **SVTM/map demoted** from "final vegetation classifier" to **"draft prior."**
  Photos refine **vegetation only**; distance, slope and FDI stay GIS/DEM-derived
  and can never come from a photo. §2, §4, §5.
- **Per-side evidence model** (`sector_evidence`, keyed by compass side N/E/S/W):
  GIS draft → photo-combined → override → final BAL, each layer preserved. §3a.
- **Surface-aware reconciliation.** Consumer surface: a photo/override may only
  **raise or flag**; a *lowering* vegetation change keeps the conservative value
  and sets a review flag (never silently lowered). Console surface (parked):
  lower-with-flag. §5a.
- **Background photo pipeline**: per-side upload returns immediately; VLM
  classification + reconciliation run as a background task; the frontend polls
  `analysis_status`. Stable `photo_id`s; delete-photo recombines. §4, §7.
- **Per-side override + reset endpoints** (vegetation raise-only; distance/slope
  full self-report); per-side reset and page-level "Reset to default." §6, §7.
- **New case lifecycle endpoints**: boundary update, sector photo upload/get/
  delete, per-side override PUT/DELETE, `DELETE /cases/{id}` (ownership-checked
  404 + file cleanup). §7.
- **Google OAuth** (`POST /auth/google`) now implemented (was parked). §7.
- One Case now holds **both** a point/photo read (`assessment`) and a boundary
  read (`boundary_assessment`); the denormalised headline is the **worst of all
  reads**. §3a, §12.

**1.x — Point/address screen + photo sharpening + Phase-1 persistence/auth.**
(History folded into the sections below.)

---

## Table of contents
1. Overview & purpose
2. Architecture
3. The assessment pipeline (step by step)
3a. The boundary flow & per-side evidence
4. The photo feature (point sharpening + per-side boundary photos)
5. Safety rules
5a. Surface-aware reconciliation (the load-bearing rules)
6. Manual overrides & reset
7. Internal API (endpoints + shapes)
8. External APIs (consumed)
9. Reference data files
10. Method 1 vs Method 2
11. Conservative defaults (fail-safe)
12. Storage & logging
13. Map UI & geometry / UX
14. Business model (direction)
15. Known limitations / TODO / parked
16. Regression anchor
17. Disclaimer

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

Three things make this build different from a naive single-point screen:

- **Per-direction assessment.** The property is split into four compass sectors
  (N/E/S/W). Each side is rated on its own, and the **worst side governs** the
  overall house BAL — the way an assessor works per-aspect.
- **A drawn boundary as measurement geometry.** A logged-in user can draw their
  site boundary. The boundary is not decoration — it becomes the **reference
  AND the measurement geometry**: distances are measured from the polygon's
  *edges* (not a centre point), and slope is sampled along each transect. This
  systematically reads closer-to-real than the address point, which under-reads.
- **Optional photo refinement.** Guided photos feed a server-side vision model
  (Groq VLM) that classifies the **vegetation** on each side. A confident photo
  read can refine that side — under strict, surface-aware safety rules on the
  *direction* of change (§5a). **Photos refine vegetation only.** Distance,
  slope and FDI are always GIS/DEM-derived and never come from a photo.

A formal BAL assessment by an accredited consultant is still required for a
development application. Even the boundary+photo output is **indicative,
screening only — not certified.**

---

## 2. Architecture

| Layer | Stack | Notes |
|---|---|---|
| Backend | FastAPI (Python), `httpx`, `shapely`, `pyproj` | Stateless. Calls live NSW government APIs + reads static JSON reference files. |
| Vision | Groq VLM (OpenAI-compatible chat/vision API) | Server-side only; the key never reaches the browser. |
| Frontend | React + Vite | Talks to the backend over JSON / Server-Sent Events. |
| Persistence | MongoDB via Beanie ODM (PyMongo async client) (Phase 1); local files for photo training-data records + VLM log | `fastapi-users` planned for consumer-account auth. |

**The map (SVTM) is a draft prior, not the verdict.** A core architectural shift:
SVTM vegetation polygons used to be the *sole authority* for vegetation
classification. They are now the **draft prior** — the starting point a photo can
refine. What SVTM is **never** demoted from: it (with the DEM and the LGA table)
remains the sole source of **distance, slope and FDI**. A photo cannot move those.
The chain is:

```
GIS draft (SVTM) ──▶ photo-combined (VLM) ──▶ override (assessor/consumer) ──▶ final BAL
   vegetation            vegetation                 vegetation + dist/slope
```

Distance is geometric (`site_geom.distance(...)`), slope is DEM-derived, FDI is
LGA-derived — all three are computed independently of vegetation class and stay
that way at every layer.

The **assessment compute itself is stateless** — state for one assessment lives in
the request / response. Saved work (boundary reads, photos, overrides) is
persisted on a **Case** document in MongoDB. Point-mode photo captures are also
written to disk as training-data records (§12).

**Phase 1 persistence foundation** (`app/core/config.py`, `app/db/mongodb.py`,
`app/models/user.py`, `app/models/case.py`): a PyMongo `AsyncMongoClient`
connects to MongoDB and `init_beanie` registers two documents, wired via
the FastAPI lifespan (DB init is non-fatal — a DB outage never stops the
stateless assessment routes; `GET /db/ping` reports connectivity).
- **User** (`users`): the `fastapi-users` Beanie base user (`email`,
  `hashed_password`, `is_active`, `is_superuser`, `is_verified`) plus `name`,
  `created_at`, `auth_provider` (`"local"`/`"google"`), `google_id`. Auth
  endpoints, token issuance and the `UserManager` are a later step.
- **Case** (`cases`): one user's saved assessment for one property. It holds up
  to **three reads on one document**: the point read + its photo-sharpened form
  (`assessment`), the boundary edge read (`boundary_assessment`), and the
  per-side evidence layer (`sector_evidence`). `user_id` (indexed), embedded
  `PropertyInfo`, `photos[]` (point-mode captures), and a `status` workflow enum
  (indexed). The denormalised headline (`bal_rating` / `governing_direction`) is
  the **worst of all stored reads** — safety: the headline must never sit below
  any read (`worst_read()` in `cases/service.py`). Full shape in §3a.

**Auth backend (Step 2):** `fastapi-users` 15.x with a Beanie adapter
(`app/auth/`). A `UserManager` (`ObjectIDIDMixin`, password ≥ 8) handles signup
and password hashing; a single `JWTStrategy` (HS256, `AUTH_SECRET`) mints/
validates the Bearer access token so the `current_active_user` dependency
guards protected routes. The refresh token is a custom, DB-backed, rotating
credential (§12) — not a JWT. **Google OAuth** is also wired (`POST /auth/google`,
§7): a verified Google ID token is exchanged for EmberCheck's own tokens, creating
the user with `auth_provider: "google"` on first sign-in. Reset-password /
verification token secrets are wired but not yet exposed as routes.

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

## 3a. The boundary flow & per-side evidence

A logged-in user can draw their **site boundary** on the map. The same
`run_assessment` pipeline runs, but with `site_polygon` set, so distances are
measured from the polygon's **edges** and slope is sampled along each transect
(`vegetation_scan.py::_build_site_geometry`, `_build_transects` — 12 even-spaced
`T01..T12` plus snapped `S01..Sk` per patch). The **worst transect governs** the
side; the worst side governs the headline. A boundary read is stored on the Case
in `boundary_assessment` (a full pipeline response dict, stored verbatim),
**separately** from the point read in `assessment`, so the two coexist on one
case instead of overwriting each other.

### The Case document (verified against `models/case.py`)

```
Case (Beanie Document, collection "cases")
├── user_id: PydanticObjectId           # indexed
├── property: PropertyInfo {address, matched_address, latitude, longitude,
│                            lga, boundary_polygon: list}
├── assessment: dict | None             # point read (+ in-place photo sharpening)
├── boundary_assessment: dict | None    # boundary edge read (verbatim pipeline dict)
├── bal_rating: str | None              # WORST of all reads (denormalised headline)
├── governing_direction: str | None     # which side drove the worst read
├── sector_evidence: list[SectorEvidence] | None   # per compass side; None until boundary
├── photos: list[CasePhoto]             # point-mode capture photos
├── status: CaseStatus                  # indexed
└── created_at / updated_at / submitted_at
```

`CaseStatus`: `DRAFT → ANALYSIS_COMPLETE → SUBMITTED_TO_ASSESSOR → UNDER_REVIEW
→ CHANGES_REQUESTED → SITE_VISIT_REQUIRED → REFERRED_SPECIALIST → APPROVED →
COMPLETE` (only the first three transitions are wired today).

### Per-side evidence (`SectorEvidence`, keyed by compass side)

Evidence is anchored to **compass side (North/East/South/West)**, *not* to
transect ids — transect labels regenerate on every run, but the side is stable
across redraws. Each side preserves every classification layer separately:

| Field | Meaning |
|---|---|
| `compass_side` | `"North"` / `"East"` / `"South"` / `"West"` (stable key) |
| `gis_draft_classification` | the side's governing transect's vegetation class (the **draft prior**); `None` if GIS saw no hazard on that side |
| `photos: list[SectorPhoto]` | the photos uploaded for this side |
| `combined_classification` | worst-case-governs across this side's photo proposals (never averaged); `None` until photos analysed |
| `combined_confidence` | **minimum** confidence across the side's photos |
| `combined_reasoning` | the VLM reasoning of whichever proposal *drove* the combined class (so the UI can show "why") |
| `overrides: SectorOverrides \| None` | a manual override layer (below) |
| `review_flags: list[str]` | e.g. `uncertain_vegetation`, `photo_lower_than_draft_review`, `geometry_overridden`, `override_lower_than_draft_review` |
| `final_bal` | the reconciled BAL for this side (override > combined > draft, surface-aware — §5a) |
| `analysis_status` | `pending` → `complete` (or `error`); drives the frontend poll |

`SectorPhoto`: a **stable `photo_id`** (uuid hex, auto-backfilled), `file_path`
(relative, under `PHOTO_STORAGE_DIR`), `captured_at`, `ai_proposal`, `metadata`.

`AiVegetationProposal`: `vegetation_class`, `exclusion` (bool), `confidence`
(0–1), `model_version`, `reasoning` (the VLM's one-sentence "why").

`SectorOverrides`: `vegetation_class`, `distance_m`, `effective_slope_degrees`,
`slope_direction` (`downslope`/`upslope`/`flat`), `override_by`, `override_at`.
**There is no per-side FDI** — FDI is site-level (one value per LGA under
AS 3959); a per-side FDI override was deliberately removed in the redesign.

The four entries are materialised/refreshed by `build_or_merge_sector_evidence`
on every boundary (re)assessment. **MERGE, never overwrite:** re-assessing a
boundary refreshes only `gis_draft_classification`; photos, overrides, combined
fields, flags and `final_bal` are preserved.

---

## 4. The photo feature (point sharpening + per-side boundary photos)

There are **two** photo paths. Both use the same Groq VLM and the same
"propose, never determine" reconciliation; only the plumbing differs.

### 4a. Point-mode sharpening (`CaptureFlow.jsx`, `/assess/photos`)

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

### 4b. Per-side boundary photos (`SectorCameraCapture.jsx`, sector endpoints)

In the boundary flow, photos are attached **per compass side**, asynchronously:

- **Input** is camera capture OR file upload, per side; the frontend's "Take
  photo" is **scoped to the currently selected side** (`SectorCameraCapture.jsx`).
- **Upload returns fast.** `POST /cases/{id}/sectors/{side}/photos` validates
  (JPEG/PNG, ≤ 10 MB), writes the files under
  `PHOTO_STORAGE_DIR/<case_id>/<side>/`, appends `SectorPhoto`s, sets the side's
  `analysis_status: "pending"`, and **returns 200 immediately**.
- **VLM runs in the background.** A `BackgroundTask` (`_run_sector_analysis`)
  classifies each photo via Groq (`sector_classifier.py`, default
  `meta-llama/llama-4-scout-17b-16e-instruct`), combines proposals
  (`combine_proposals`, worst-case-governs), then reconciles the BAL. It saves in
  **two stages** so a reconcile bug can never discard a successful
  classification, and marks the side `"error"` (never silently lost) on failure.
- **The frontend polls** the case until `analysis_status` reaches `complete`
  (or `error`).
- **Multiple photos per side** are combined by `combine_proposals`
  (worst-case-governs; minimum confidence; any low-confidence/`Unknown` photo
  forces **Forest** + `uncertain_vegetation`).
- **Delete by stable `photo_id`** (`DELETE …/photos/{photo_id}`): removes the
  photo + file, **recombines from the remaining proposals (no new VLM call)**,
  re-runs reconcile, and saves. Deleting the **last** photo reverts the side
  fully to the GIS draft (`combined_*` cleared, `analysis_status: None`).

**The boundary photo path never touches distance, slope or FDI** — exactly as
point-mode. It only refines the vegetation class fed into reconciliation (§5a).

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

## 5a. Surface-aware reconciliation (the load-bearing rules)

This is the redesign's most safety-critical code
(`assessment_pipeline.py::reconcile_sector_bal` / `_reconcile_combined_vs_draft`
/ `reconcile_all_sectors`, and `sector_classifier.py::combine_proposals`). It
decides each side's `final_bal` from the layered evidence and rolls up the
headline. **None of it may change without review.**

**Precedence per side:** effective vegetation class = `override` (if set) else
`combined` (photos) else `gis_draft`. Each layer is preserved, never collapsed.

**Worst-case-governs, twice over:**
- Across **photos within a side** — the most severe class wins (`combine_proposals`,
  `CLASS_SEVERITY`); never averaged. Confidence reported is the **minimum**.
- Across **sides for the headline** — the worst `final_bal`
  (`reconcile_all_sectors`), and across **reads** for the case headline
  (`worst_read`: point vs boundary).

**Direction of change is surfaced, never silently applied (the false-low guard):**

| Change | Consumer surface (the only one wired today) | Console surface (parked) |
|---|---|---|
| Photo/override **raises** vegetation | applied — BAL goes up | applied |
| Photo/override **same** severity | no change | no change |
| Photo **lowers** vs draft | **kept conservative** (draft stands); `photo_lower_than_draft_review` flag | uses lower value, `lowered_requires_review` flag |
| Override class **lowers** vs draft/photos | **kept conservative**; `override_lower_than_draft_review` flag | (assessor confirms + signs) |

So on the consumer surface a vegetation change can only **RAISE or FLAG** — a
*lowering* vegetation change leaves the conservative GIS/photo value as the
official indicative BAL and records a review flag. **Only the accredited assessor
(the future Console) actually lowers and signs.**

> **Design-vs-build note.** The redesign docs describe a *lowering* change being
> shown as a **PROVISIONAL** "pending accredited review" value. The current build
> realises that intent more conservatively: it **does not show a provisional
> lowered number at all** on the consumer surface — it keeps the conservative
> value and sets a review flag. There are **no** `provisional_bal` /
> `provisional_reason` fields in the code. Treat "provisional pending review" as
> the *product framing* of the review-flag mechanism, not a stored field.

**Distance / slope override is the one exception to raise-only.** Per-side
`distance_m` / `effective_slope_degrees` overrides are **full self-report with no
guard** — they replace the GIS-measured geometry outright (raise *or* lower),
force `vegetation_found = True`, and set a `geometry_overridden` flag. This is
deliberate parity with the point-mode "adjust the inputs" page. (The unguarded
self-lowering this allows is a known hole tracked in §15.) Distance/slope still
**never come from a photo** — only from an explicit human override.

**Unknown / low-confidence → worst-case Forest + review flag.** Any photo below
the **0.7** confidence threshold, or read as `cant_tell`/`Unknown`, forces the
side's combined class to **Forest** and flags `uncertain_vegetation`
(`combine_proposals`). The conservative value always stands when in doubt.

**Headline only ratchets up, except on explicit reset.** The case `bal_rating`
is raised when a reconcile produces a worse headline; clearing an override
recomputes it from scratch as the worst `final_bal` across all sides (so a
cleared raise can correctly bring the headline back down to the next-worst side —
but never below it).

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

### Per-side overrides & reset (boundary flow, persisted)

In the boundary flow, overrides are **persisted per compass side** on the Case
(`SectorOverrides`) via `PUT /cases/{id}/sectors/{side}/override` (merge: send
only the fields you change). They follow §5a:

| Override | Rule |
|---|---|
| Vegetation class | **Raise-only** on the consumer surface — a lower class is recorded but the conservative value stands + review flag. Allowed classes are validated. |
| Distance (m) | Full self-report (replace), `geometry_overridden` flag. |
| Slope (degrees + direction) | Full self-report (replace); caller resolves effective degrees (0 unless `downslope`). |

The **original GIS draft is never mutated** — it stays the reset baseline.
Resets come in two scopes:
- **Per-side reset** — `DELETE /cases/{id}/sectors/{side}/override` reverts that
  side to photo-combined (if photos exist) else the GIS draft, and recomputes.
- **Page-level "Reset to default"** — the frontend removes **all** photos
  (per-side delete), so every side reverts fully to the GIS draft.

Both recompute `final_bal` and the case headline immediately.

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

#### `POST /auth/google`
Google OAuth sign-in. Request: `{ id_token }` (a Google ID token from the
browser). The backend verifies it against `GOOGLE_CLIENT_ID`
(`google.oauth2.id_token`), requires a verified Google email, then **issues
EmberCheck's own** access + refresh tokens (Google proves identity only).
Creates the user on first sign-in (`auth_provider: "google"`, `google_id` set).
`→ { access_token, refresh_token, token_type: "bearer" }`. `503`
`GOOGLE_AUTH_NOT_CONFIGURED` if no client id; `400` on an invalid/unverified
token.

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
(GeoJSON Polygon/Feature?, mirrors `site_polygon`), `include_point` (bool,
default false), `fire_danger_override`, `slope_override`. A `boundary_polygon`
creates a **boundary-only** case (stored in `boundary_assessment`) and skips the
point run unless `include_point` is set, so a boundary save doesn't double-run the
pipeline; without a polygon it's a point case. `sector_evidence` is materialised
from the boundary read. `→ 201` `CaseRead` (full shape below). New cases start
`status: DRAFT`. The headline is the **worst of both reads**. Assessment errors
surface as the same `404/400/503` as `/assess`.

`CaseRead` shape: `{ id, status, property, assessment, boundary_assessment,
bal_rating, governing_direction, governing_vegetation, photos, sector_evidence,
created_at, updated_at, submitted_at }`.

#### `PUT /cases/{case_id}/boundary`
Requires auth (ownership 404). (Re)assess from a drawn boundary and store it on
the **existing** case in place (so editing a boundary updates the same record).
Request (`BoundaryUpdateRequest`): `boundary_polygon` (GeoJSON, **required**),
`fire_danger_override`, `slope_override`. The point/photo read (`assessment`) and
`photos` are left intact; `sector_evidence` is **merged** (preserves photos/
overrides, refreshes the GIS draft); the headline is recomputed as the worst of
both reads. `→ CaseRead`.

#### `DELETE /cases/{case_id}`
Requires auth (ownership 404). Deletes the caller's own case **and its photo
files**. Embedded sub-records (`sector_evidence`, `photos`) go with the document;
the on-disk JPEGs (boundary sector photos + point-mode captures) are removed
**first** (path-traversal-guarded; a missing file is tolerated and logged) so a
successful delete can never orphan files, and the case's `PHOTO_STORAGE_DIR/<id>`
tree is best-effort removed. `→ 204`.

#### `GET /cases`
Requires auth. `→ [CaseSummary]` — the caller's cases, **newest first**
(`updated_at` desc). Light shape (no full assessment dict):
`{ id, address, bal_rating, governing_direction, governing_vegetation,
has_boundary, status, created_at, updated_at, submitted_at }`. `has_boundary`
badges a saved boundary read without shipping the assessment dict.

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

#### `POST /cases/{case_id}/sectors/{compass_side}/photos`
Requires auth (ownership 404). Upload one or more photos for a compass side
(`North`/`East`/`South`/`West`; `422` otherwise). Accepts `image/jpeg` /
`image/png`, ≤ 10 MB each; writes them under `PHOTO_STORAGE_DIR/<id>/<side>/`,
appends `SectorPhoto`s, sets the side `analysis_status: "pending"`, schedules the
background VLM+reconcile task, and **returns immediately**:
`→ { compass_side, photos[], analysis_status: "pending" }`.

#### `GET /cases/{case_id}/sectors/{compass_side}/photos/{photo_ref}`
Requires auth (ownership 404). Streams a stored sector photo by **stable
`photo_id`** (or integer index, backward-compat). Path-traversal-guarded; missing
→ `404`.

#### `DELETE /cases/{case_id}/sectors/{compass_side}/photos/{photo_id}`
Requires auth (ownership 404). Removes one photo + its file, **recombines from
the remaining proposals (no VLM call)**, re-runs reconcile, saves. Deleting the
last photo reverts the side to its GIS draft. `→ { compass_side, photos[],
combined_classification, combined_confidence, combined_reasoning, review_flags,
final_bal, analysis_status }`.

#### `PUT /cases/{case_id}/sectors/{compass_side}/override`
Requires auth (ownership 404). Set/merge a per-side override (send only the
fields you change). Request (`SectorOverrideRequest`): `vegetation_class?`
(validated against the allowed set; `low_risk` normalised to `Excluded`),
`distance_m?` (≥ 0), `effective_slope_degrees?`, `slope_direction?`
(`downslope`/`upslope`/`flat`). Vegetation follows the **raise-only** rule;
distance/slope are full self-report (§5a, §6). Recomputes `final_bal` + headline,
persists. `→ { compass_side, overrides, combined_classification, review_flags,
final_bal }`. Bad enum/negative distance → `422`.

#### `DELETE /cases/{case_id}/sectors/{compass_side}/override`
Requires auth (ownership 404). Clears the side's override (reverts to
photo-combined else GIS draft), recomputes `final_bal`, and **recomputes the
headline from scratch** as the worst `final_bal` across sides (so clearing a
raise can correctly lower the headline to the next-worst side). `→` same shape as
the PUT.

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

## 13. Map UI & geometry / UX

The backend returns shapes; the frontend (`AssessmentMap.jsx`, Leaflet) draws
them. The `geometry` object (EPSG:4326) contains:
`property_point`, `assessment_ring_m` (100), `search_buffer_m` (150),
`vegetation` (a GeoJSON `FeatureCollection` of all hazardous patches, the nearest
marked `governing`), and `distance_line` (house → the **governing** side's nearest
vegetation point).

### Boundary UX (the two flows)

1. **"Define your site"** — draw the boundary → per-side **GIS draft** rating
   (`BoundaryAssessmentPage.jsx`, `BoundaryResultPanel.jsx`).
2. **"Add evidence per side"** — upload/capture photos per side; each side's
   card shows the GIS draft, the photo proposal, and the reconciled result.

Legend/copy framing matters for the false-low invariant: map vegetation is shown
as a **"draft (refine with photos)"**, *not* as the thing that "drives the
rating." The **user's drawn boundary is a distinct gold dashed outline**
(`#E8C547`, `dashArray 8 6`, no fill) — visually separate from the solid-filled
SVTM vegetation patches and from the white-dashed 100 m assessment ring.

**Resume / redraw uses separation of concerns.** The read-only boundary display
(a `GeoJSON` layer) is rendered separately from the editable `DrawControl`
(Geoman). The Geoman setup effect depends **only on `[map]`** — `initialPolygon`
is read from a ref, not the dependency array — so a re-emit
(parent `setPolygon` → new `initialPolygon` prop) does **not** tear down and
rebuild the draw layer (this avoids the "rebuild storm").

**Other UX:**
- A **themed confirm modal** (`ui/ConfirmModal`) replaces the native `confirm()`
  for destructive actions (per-side reset, "Reset to default", delete property).
- **My Properties / Dashboard** lists saved cases and supports **delete
  property** (→ `DELETE /cases/{id}`).
- The main property page's **boundary card** shows the essentials + a **"View"**
  button. **"Go to accredited assessor"** (`AssessorHandoffCard.jsx`) routes
  through the existing login flow, then lands on an explicit **"not yet
  available"** state — the Console is parked (§15).

---

## 14. Business model (direction)

Not a contract — the current product direction the safety rules serve.

- **Free = address point estimate.** Framed as a **FLOOR that can only rise**: a
  centre-point read systematically *under-reads* versus the real property edges,
  so it must **never** be presented as a safe verdict. ("Screening only — not a
  certified assessment" copy is shown on the entry hero.)
- **Paid / login = boundary + per-side photos + report.** Drawing a boundary,
  attaching photos, and saving a case require login. **Payment is not built yet**
  — these are gated on login for now.
- **Even the paid output stays indicative.** Boundary + photos sharpen the read
  but the result is still "indicative, screening only — not certified." Only an
  accredited assessor (the parked Console) certifies and signs.

---

## 15. Known limitations / TODO / parked

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
- **Consumer accounts (Phase 1).** Persistence (MongoDB + Beanie, `/db/ping`),
  **email/password auth** + **Google OAuth** (`/auth/google`), the login gate,
  the case lifecycle (create / boundary update / sector photos / per-side
  overrides / submit / delete), and the dashboard are in place. `/assess` itself
  stays public.

### Parked / known issues (list, don't fix)

- **Point-mode "$29 four-photo" flow has an unguarded self-lowering override
  hole.** Point-mode distance/slope (and the boundary distance/slope override,
  by parity — §5a) are full self-report with no guard, so a user can self-lower.
  This needs retirement when point-mode is folded into the unified flow.
- **Governing tie-break is list-order.** When two transects/sides share the worst
  band, the first in list order wins; it *should* pick the **closest** within the
  worst band.
- **"One sharpening rating" UX** — the intended end state is a single evolving
  number (address → boundary → photos), not separate screens.
- **PDF report output** — not built.
- **MongoDB Atlas migration** — not done.
- **Assessor Console** — the `/submit` status transition exists, but the
  accredited-assessor workflow (full override of all inputs, lower-with-flag
  reconciliation on the `console` surface, and signing) is **not built**. The
  consumer surface is the only one wired; `reconcile_*(surface="console")` exists
  in code but no route uses it. A draggable "confirm location" pin is also TODO.

---

## 16. Regression anchor

**11 Cryptandra St, Denham Court NSW 2565 → BAL-12.5 / Woodland.**
- **Boundary mode** governs the closest Woodland transect (~`T02`, **~81.3 m**).
- **Point/address mode** governs **~86.8 m East**.

This must stay **byte-identical with no photos / no overrides** after any change
(covered by `tests/test_reconcile_sector_bal.py`,
`tests/test_sector_evidence_builder.py`,
`tests/baselines/denham_court_point_mode.json`). It is the canary for the whole
redesign: every additive step (sector evidence, photos, reconciliation,
overrides) is required to leave the no-evidence path unchanged.

---

## 17. Disclaimer

Output is an **indicative screening result**, not a certified BAL assessment.
A formal assessment by a qualified bushfire consultant is required for development
applications and regulatory purposes.

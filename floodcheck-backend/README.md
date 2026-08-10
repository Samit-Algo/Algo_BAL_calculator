# FloodCheck API (standalone)

A self-contained FastAPI service that returns a flood risk answer for an Australian
coordinate or address, using a confidence-tiered cascade. **Independent of the
EmberCheck backend** — no shared code.

## Tiers

- **A — Council flood study** (high): a registered council's live ArcGIS data →
  real flood level (mAHD), depth, flood planning level and band.
- **B — NSW EPI Flood Planning layer** (medium): a planning designation. New South
  Wales only; skipped elsewhere.
- **C — Terrain screen** (low): low-lying vs elevated, from the state elevation
  model. Available wherever a model reaches.

The resolver returns the highest tier that can answer, always tagged with tier,
confidence and provenance, and never a false "safe". Where a council covers a
location but publishes no flood level for it, the answer falls to a lower tier and
carries a `council_context` note explaining why — an unknown is reported as
unknown, never as "not flood affected".

## Registered councils (Tier A)

| Council | State | Events published | Freeboard | Notes |
|---|---|---|---|---|
| Bellingen Shire Council | NSW | 5 yr ARI, 5% AEP, 1% AEP, FPA, PMF, hydraulic category | 0.5 m | Lower Bellinger & Kalang floodplain only |
| Tweed Shire Council | NSW | 1% AEP (defined flood event), flood planning level, PMF, hydraulic category | **published** | Council publishes its own FPL; levels are contour bands, upper bound used |
| Hinchinbrook Shire Council | QLD | 5 / 10 / 20 / 50 / 100 yr, plus council-computed inundation | 0.5 m | Mapped parcels around Ingham; no PMF |
| City of Gold Coast | QLD | Designated flood level (1% AEP), ground level, surveyed floor level | 0.3 m | Residential buildings; flood level published for ~23% |

**Freeboard.** Most councils publish only a design flood level, and the flood planning
level is that plus a freeboard. Some publish the flood planning level itself; those set
`freeboard_metres=None`, and the published value is used rather than a margin being
assumed. Tweed is the first of these.

**Overlapping coverage.** Coverage is a bounding box, so neighbouring councils overlap —
Tweed and the Gold Coast share one across the state border. Where more than one council
claims a coordinate, each is tried in turn and the first whose study actually holds data
there answers.

`GET /flood/councils` returns this list at runtime.

## Adding a council

Adding a council is a registration, not a code change. Nothing in the resolver, the
assessment maths, or the API needs to be touched.

1. Create `app/flood/providers/councils/<council_name>.py`.
2. Describe the council's layers and map its field names onto the canonical keys in
   `app/flood/flood_values.py`.
3. Export a `PROVIDER` and add it to `COUNCIL_PROVIDERS` in
   `app/flood/providers/registry.py`.

```python
PROVIDER = CouncilProvider(
    name="Example Shire Council",
    state="QLD",
    coverage=GeographicBounds(-18.9, -18.35, 145.9, 146.45),
    flood_data_source=ArcGisFloodSource(
        council_name="Example Shire Council",
        feature_server_url=FEATURE_SERVER_URL,
        layer_mappings=(
            LayerFieldMapping(4, {"Q100YH": FloodValueKeys.LEVEL_1_PERCENT_AEP}),
        ),
    ),
    attribution="Example Shire Council - Flood Study",
    source_url=FEATURE_SERVER_URL,
    freeboard_metres=0.5,
)
```

A council whose data is not on ArcGIS implements `FloodDataSource` instead; the rest
of the registration is identical.

## Layout

```
app/
  geography.py                      GeographicBounds, shared coverage checks
  config.py                         API keys and CORS
  main.py                           FastAPI app
  flood/
    flood_values.py                 canonical flood vocabulary (FloodValueKeys)
    assessment.py                   depth / flood planning level / band maths
    resolver.py                     the A -> B -> C cascade
    routes.py                       HTTP endpoints
    providers/
      flood_data_source.py          FloodDataSource interface, FloodReading
      arcgis_flood_source.py        reads a council's ArcGIS feature server
      council_provider.py           CouncilProvider
      registry.py                   the register of councils
      councils/                     one module per council
    tiers/
      planning_designation.py       Tier B
      terrain_screen.py             Tier C
  services/
    arcgis_feature_service.py       shared ArcGIS point-query client
    elevation.py                    ground level from the covering state DEM
    geocode.py                      address lookup
```

## Elevation models

Ground level comes from whichever state model covers the point. Both return metres
on the Australian Height Datum, the same ruler as the council flood levels, so depth
is a plain subtraction with no datum conversion.

| Model | Coverage |
|---|---|
| NSW 5 m Elevation | New South Wales |
| Queensland Digital Elevation Model | Queensland |

Where a council publishes its own surveyed ground level (Gold Coast does), that is
preferred over the model, and reported as such in `fetched.ground_level_source`.

## Endpoints

- `GET /flood/point?lat=..&lon=..` — assess a coordinate
- `GET /flood/address?q=<address>` — geocode, then assess
- `GET /flood/suggest?q=<partial>` — address autocomplete
- `GET /flood/councils` — registered councils and their data caveats
- `GET /health`

## Run (Windows / PowerShell)

```powershell
cd floodcheck-backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r requirements.txt
copy .env.example .env   # then set GEOSCAPE_API_KEY
.\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8200
```

Docs at http://127.0.0.1:8200/docs

## Config (`.env`)

- `GEOSCAPE_API_KEY` — required for `/flood/address` and `/flood/suggest`.

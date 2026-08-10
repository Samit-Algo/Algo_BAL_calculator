# NoiseCheck API (standalone)

A self-contained FastAPI service returning a noise and air quality answer for a NSW
coordinate or address. **Independent of the EmberCheck and FloodCheck backends** — no
shared code.

## Three reads, graded

Unlike flood, NSW publishes no per-address noise dataset. The three reads differ
sharply in how much they can be trusted, so each carries its own grade:

- **A — Aircraft noise.** Looked up, not calculated. Point-in-polygon against
  published contours: the NSW ePlanning airport noise layer (live ArcGIS) and the
  Department of Defence airfield contours (bundled). Reports **ANEF units, not
  decibels** — a dimensionless annoyance index forecasting a future year.
- **B — Air quality.** Genuinely measured, from the NSW monitoring network's live
  API. But measured at the *nearest station*, not the address. Drops to C past 25 km.
- **C — Road noise.** Modelled from scratch, because nothing exists to look up.
  OpenStreetMap geometry plus a first-order line-source model.

## Confidence rule

The headline grade is governed by the **best** available read, not the worst.

This is deliberately the opposite of EmberCheck's worst-of-all-reads rule. A bushfire
or flood rating is a safety call where the worst read must govern. Environmental
amenity is a completeness question — road noise being modelled does not make a
published aircraft contour less true. Reads that could not answer are listed in
`unanswered` rather than folded into the score, so a gap is never presented as a low
result.

**Missing is never reported as safe.** Three distinct outcomes are kept apart:

| Outcome | Means |
|---|---|
| `covered` | A contour genuinely covers this point |
| `no_data` | Checked successfully; nothing is published here |
| `unavailable` | The upstream failed; we do not know |

That last distinction matters most for aircraft. Before it existed, an ePlanning
timeout at a Sydney address rendered indistinguishably from "no contour here" — an
authoritative-sounding negative produced by a network error.

## Coverage, honestly

The aircraft layer holds **29 polygons statewide** across five planning instruments,
plus 23 bundled Defence polygons covering RAAF Richmond, RAAF Williamtown and HMAS
Albatross. **Sydney (Kingsford Smith) Airport is in neither** — it is Commonwealth
land, so its contours never entered NSW planning law. The busiest flight-path suburbs
in the state return `no_data`.

## Endpoints

| Endpoint | Purpose |
|---|---|
| `GET /noise/point?lat=&lon=` | Assess a coordinate |
| `GET /noise/address?q=` | Geocode an address, then assess it |
| `GET /noise/suggest?q=` | Address autocomplete (returns `[]` on any failure) |
| `GET /noise/method` | How each read works, and its licence |
| `GET /health` | Liveness + which geocoder is active |

`/noise/method` exists so the frontend explainer renders from the backend rather than
from hard-coded copy. Its numbers — search radius, reference levels, station cutoff,
polygon counts — are derived from the same constants the providers use, so tuning one
cannot leave the UI describing behaviour the code no longer has.

## Provenance

Every read returns a `provenance` block with the actual call made, the untouched
response, and a field-by-field map of what the UI shows and where it came from.
Computed values are flagged `CALCULATED`. This is generated per request, so unlike
documentation it cannot drift.

## Run

```bash
cd noisecheck-backend
python -m venv .venv
./.venv/Scripts/python.exe -m pip install -r requirements.txt   # Windows
# source .venv/bin/activate && pip install -r requirements.txt  # macOS/Linux

./.venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8300
```

Docs at http://127.0.0.1:8300/docs. No API keys required.

Set `GEOSCAPE_API_KEY` in `.env` to swap geocoding from Nominatim to the same
Geoscape provider FloodCheck uses. Strongly recommended beyond evaluation: Nominatim
resolves a suburb name to its centre point, and contour edges are sharp enough that
a suburb search can miss a contour a street address inside it would hit.

## Layout

```
app/
├── main.py                     FastAPI app + CORS
├── config.py                   every upstream URL and tunable
├── geo.py                      haversine, point-in-polygon, decibel sum
├── data/
│   └── defence_anef_nsw.geojson    23 contours, generated
├── noise/
│   ├── routes.py               the /noise endpoints
│   ├── resolver.py             runs the three reads, grades the result
│   ├── method.py               served explainer, derived from the constants
│   └── providers/
│       ├── aircraft.py         ePlanning ArcGIS + bundled Defence contours
│       ├── road.py             Overpass + line-source model
│       └── air_quality.py      NSW air quality API
└── services/
    └── geocode.py              Nominatim, or Geoscape when a key is set
scripts/
├── build_defence_anef.py       KML → GeoJSON (run once, output committed)
└── defence_anef_source.kml     4.8 MB national source
```

### Regenerating the Defence contours

```bash
python scripts/build_defence_anef.py
```

The published KML has three defects the script works around, each commented in place:
its `xsi:` prefix is undeclared (malformed XML); base names are misspelled
(`RAAF Base Williamown`, `RAAF Base Albatross`); and the `- Contour N` placemarks are
empty legend stubs — only `- Contour Range N-M` placemarks carry geometry.

## Known limits

- **Road noise is not an acoustic assessment.** Road *class* stands in for traffic
  volume, because OpenStreetMap carries no counts — a road with 40,000 vehicles and
  one with 8,000 score identically. No terrain, buildings or noise walls. A real
  build would use CNOSSOS-EU or CoRTN with AADT from the TfNSW open data API.
- **Public Overpass sheds load**, answering 504 or 429 then succeeding seconds later.
  Retried 3× with backoff. Public mirrors were tested and are unreachable from AU, so
  there is no fallback host.
- **Aircraft contour geometry is fetched per request** and is the slowest call by far
  (~300 KB). A failure on it degrades to "no map geometry", not "no result". A real
  build would serve contours as vector tiles instead.
- **No caching.** Every request hits its upstreams live.

## Attribution

| Source | Licence |
|---|---|
| NSW ePlanning — Airport Noise EPI | CC BY 4.0 |
| Department of Defence — Airfields ANEF | CC BY 3.0 AU |
| NSW Air Quality Monitoring Network (DCCEEW/EPA) | CC BY 4.0 |
| Road geometry © OpenStreetMap contributors | ODbL |

All permit commercial use with attribution. ODbL additionally requires derived road
data be shared alike — relevant if road modelling ships in a product.

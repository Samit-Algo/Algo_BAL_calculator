# FloodCheck Frontend

Vite + React + Tailwind. A single screen: a 3D flood map on the left, address
search and results on the right.

The app holds **no knowledge of any council**. On load it asks the backend
`GET /flood/councils` which councils exist and how to draw each one — where to
centre the map, which datasets to load, how they are delivered, and which flood
events to offer. Registering a council in the backend is all it takes for it to
appear here.

Talks to the standalone **FloodCheck backend** (default `http://127.0.0.1:8200`).

## Councils

| Council | Features | Delivery | 3D capable |
|---|---:|---|---|
| Bellingen Shire NSW | 11,613 buildings | single file | yes |
| Tweed Shire NSW | see `index.json` | single file | yes |
| Hinchinbrook Shire QLD | 2,279 buildings | single file | yes |
| City of Gold Coast QLD | 298,410 properties | chunked | no — land parcels |

Switch council from the header, or search an address — a result in another
council's area switches the map automatically. An address outside every council
keeps the current map and shows the lower-tier result instead.

## Map view modes

A global **Standard / 3D** toggle applies to every council.

3D is only meaningful where a council's polygons are **building footprints**.
Where they are **land parcels**, the polygons tile the ground with shared
boundaries, so extruding them merges neighbours into one continuous block rather
than showing separate buildings. Those councils stay flat in both modes, and the
toggle says why instead of silently ignoring the choice.

The backend states this per council as `geometry_kind` (`building_footprint` or
`land_parcel`) with a derived `supports_3d`. It is a fact about the data, not a
display preference, which is why it lives with the provider.

Hinchinbrook publishes flood levels against parcels, so its precompute joins
OpenStreetMap building footprints to those parcels — each building inherits its
parcel's flood levels, and the council becomes 3D capable. Gold Coast cannot be
treated the same way: OpenStreetMap covers only about 7% of its 298,410
properties, so real outlines are not available and it is drawn flat.

## How map data is delivered

Every dataset is a **static file under `public/councils/<id>/`**, precomputed by
`floodcheck-backend/scripts/precompute_council.py`. Nothing on the map is fetched
from a council's own servers at runtime, so a slow or unavailable council service
cannot affect the app.

- **single** — one `buildings.geojson`, fetched once. Used up to ~20,000 features.
- **chunked** — an `index.json` plus a `chunks/` grid, loaded as the viewport
  moves and cached in memory. Gold Coast's 298,410 buildings are ~258 MB raw and
  far more than MapLibre can render at once, so the area is split into cells,
  subdivided further where buildings are dense. That keeps every chunk a similar
  size (average ~1,100 features) instead of a uniform grid where dense cells would
  be twenty times larger than sparse ones.

Per-council totals for the summary donut come from `index.json`, so the figures
never require downloading geometry.

> **Deployment note:** the Gold Coast chunks are ~219 MB across 261 files, which
> ships with the static build. If that is too large for the target host, either
> restrict the precompute to the flood-mapped part of the LGA or move the chunks
> to object storage and point `buildings_url` at it.

## Layout

```
src/
  lib/
    floodApi.js          backend client (assessments, suggestions, council registry)
    councilDatasets.js   loads single-file and chunked map data, with caching
    floodStatus.js       flood status rules, colours and the map colour expression
    format.js            display formatting; a missing value is never shown as zero
  hooks/
    useCouncils.js       loads the registry and tracks the selected council
    useFloodMap.js       owns the MapLibre instance and keeps it in step
  components/
    Explorer.jsx         composition only
    CouncilSelector.jsx  header council picker
    SearchCard.jsx       address search, autocomplete and event selector
    ResultPanel.jsx      map feature or tiered address result
    MapLegend.jsx        legend, built from the council's actual layers
    StatsDonut.jsx       status summary
    ViewModeToggle.jsx   global Standard / 3D switch
    ui/Primitives.jsx    Card, Eyebrow, KeyValueRow, Badge
```

The map is created once and never rebuilt. Changing council swaps the data on the
existing sources and moves the camera, which keeps switching smooth.

## Adding a council

Nothing in this app changes. Register the council in the backend, run
`python -m scripts.precompute_council --council <id>`, and it appears in the
selector with its own events, legend and datasets.

## Deploy (Cloudflare Pages)

```bash
npm run build
npx wrangler pages deploy dist --project-name floodcheck --branch main
```

Live at https://floodcheck.pages.dev. `VITE_API_BASE` is baked in at build time
from `.env.production`.

Payload: about 222 MB across 273 files, dominated by the Gold Coast chunks. That
clears both Pages limits — 25 MiB per file (largest here is 6.4 MB) and 20,000
files — but it is worth watching as more councils are added. Moving the chunks to
an R2 bucket and pointing `buildings_url` at it is the obvious next step.

**The API is not on Cloudflare.** `floodapi.samitweb.xyz` is a cloudflared tunnel
to a local FastAPI process (`~/.cloudflared/config.yml` maps it to
`localhost:8200`); Workers cannot run FastAPI. The deployed site fetches
`/flood/councils` on load to learn which councils exist, so **the map is blank
whenever that tunnel or the machine behind it is down**. Start the backend and the
tunnel before demoing:

```bash
# terminal 1
cd floodcheck-backend && .\.venv\Scripts\python.exe -m uvicorn app.main:app --port 8200
# terminal 2
cloudflared tunnel run samit-api
```

To make the map survive the API being offline, generate the council registry into
the build and fall back to it in `useCouncils` — every dataset the map draws is
already static, so only address search truly needs the backend.

## Run

```bash
cd floodcheck-frontend
npm install
npm run dev            # http://localhost:5174
```

Start the backend first (see ../floodcheck-backend). Override the API base with
`VITE_API_BASE` if needed:

```bash
VITE_API_BASE=http://127.0.0.1:8200 npm run dev
```

## Stack

Vite · React 19 · Tailwind 3 · MapLibre GL.

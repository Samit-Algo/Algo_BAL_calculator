# NoiseCheck frontend

Single-screen React app: a noise and air quality map with address search and a
graded result panel. Same stack and layout conventions as `floodcheck-frontend`.

## Run

```bash
cd noisecheck-frontend
npm install
npm run dev          # http://localhost:5175
```

Needs `noisecheck-backend` on `:8300`. Override with `VITE_API_BASE`.

## Layout

The screen is one flex column at `100dvh`, with a header and a body that flips
direction at the `md` breakpoint:

- **Desktop** — map fills the left, a 440 px result column scrolls on the right.
- **Mobile** — map is pinned at the top at `42vh`, results scroll beneath it.

```
<div h=100dvh flex-col>
  <header h-11 shrink-0 />
  <div flex-1 min-h-0 flex-col md:flex-row>
    <div shrink-0 h-[42vh] md:h-auto md:flex-1 md:min-h-0>   ← map, never scrolls
    <div flex-1 md:flex-none md:w-[440px] min-h-0 overflow-y-auto>  ← results
  </div>
</div>
```

Four details make that work rather than merely look right:

- `100dvh`, not `100vh` — mobile browser chrome would otherwise crop the panel.
- `min-h-0` on both flex children — without it a flex item refuses to shrink below
  its content and the results column scrolls the page instead of itself.
- A `ResizeObserver` calls `map.resize()`, because the map's container changes height
  on rotate and on chrome show/hide, which a window resize listener misses.
- **The map container is positioned with an inline style, not Tailwind classes.**
  MapLibre adds a `.maplibregl-map` class to whatever element you hand it, and its
  stylesheet declares `position: relative`. That rule has the same specificity as
  Tailwind's `.absolute` but is injected after it, so it wins: the container reverts
  to relative, `inset-0` stops applying, and — since the canvas inside is absolutely
  positioned — the container collapses to **zero height** and the map vanishes with
  no console error. An inline style outranks any stylesheet, so it survives.

The layer chips and legend still render over a collapsed map, so this failure looks
like "the map didn't load" rather than a layout bug. If the map is ever blank, check
the container's computed height first.

The legend is desktop-only: on a phone it would cover the map it describes, and the
same colours are labelled in the result cards anyway.

## Modules

```
src/
├── components/
│   ├── Explorer.jsx        composes the screen; owns search + layer state
│   ├── SearchCard.jsx      address input, autocomplete, worked examples
│   ├── ResultPanel.jsx     one card per read, each with grade and caveat
│   ├── RawDataPanel.jsx    the real API call + untouched response per read
│   ├── MethodPanel.jsx     "How this works", rendered from GET /noise/method
│   ├── MapLegend.jsx       legend, filtered to bands actually on the map
│   ├── LayerToggles.jsx    basemap switch + per-layer visibility
│   └── ui/Primitives.jsx   Card, Eyebrow, ConfidenceBadge, Swatch
├── hooks/
│   └── useNoiseMap.js      owns MapLibre; created once, data swapped per result
└── lib/
    ├── noiseApi.js         API client
    └── noiseScales.js      colour scales shared by map, legend and cards
```

`noiseScales.js` is the single source for colour. The map paints from it and the
legend renders from it, which is what stops the legend describing colours the map is
not drawing.

## Two things the UI deliberately does

**Nothing about the method is hard-coded.** `MethodPanel` renders entirely from
`GET /noise/method`. Search radius, reference levels, station cutoff and coverage
counts all come from the backend, which derives them from the constants the providers
actually use — so tuning one cannot leave the explainer quietly wrong.

**Missing is shown as missing.** A read with no answer renders greyed as "No data"
with its reason, never as a low or safe result. Search `Marrickville NSW 2204` to see
it: under Sydney Airport's flight path, with no published contour anywhere in NSW
planning law.

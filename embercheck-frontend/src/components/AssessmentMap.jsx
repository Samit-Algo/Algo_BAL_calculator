import { useCallback, useEffect, useRef, useState } from 'react'
import {
  MapContainer,
  TileLayer,
  Marker,
  Circle,
  GeoJSON,
  Polyline,
  Tooltip,
  LayersControl,
  LayerGroup,
  useMap,
} from 'react-leaflet'
import L from 'leaflet'
// Leaflet-Geoman: a vanilla Leaflet plugin (no react-leaflet coupling) that adds
// the draw/edit toolbar. The side-effect import extends L.Map with `map.pm`.
import '@geoman-io/leaflet-geoman-free'
import '@geoman-io/leaflet-geoman-free/dist/leaflet-geoman.css'
import { vegColor } from '../lib/bal'
import { buildTransectRows } from '../lib/report'
import { polygonEdgesBySide } from '../lib/geo'

// Vite doesn't resolve Leaflet's default marker image paths, so the pin would
// be invisible. Point the default icon at the bundled image assets instead.
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

// Default view: roughly centred on NSW until a property is assessed.
const NSW_CENTER = [-33.87, 151.21]
const DEFAULT_ZOOM = 6
const NO_VEG_ZOOM = 16
const MAX_FIT_ZOOM = 18

// Roughly metres per degree of latitude, for placing the ring's edge label.
const METRES_PER_DEGREE_LAT = 111320

// Frame the map around the property, the nearest vegetation patch and the
// distance line whenever a new result arrives, so the "what's near you" story
// is always in view.
function FitToResult({ geometry }) {
  const map = useMap()
  useEffect(() => {
    if (!geometry?.property_point) return

    const [lon, lat] = geometry.property_point.coordinates
    const bounds = L.latLngBounds([[lat, lon]])

    const governing = geometry.vegetation?.features?.find(
      (f) => f.properties.governing,
    )
    if (governing) {
      bounds.extend(L.geoJSON(governing).getBounds())
    }
    if (geometry.distance_line) {
      geometry.distance_line.coordinates.forEach(([lo, la]) =>
        bounds.extend([la, lo]),
      )
    }

    // No vegetation in range: bounds is just the house, so use a fixed zoom
    // rather than letting fitBounds zoom all the way in.
    if (!governing && !geometry.distance_line) {
      map.setView([lat, lon], NO_VEG_ZOOM)
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: MAX_FIT_ZOOM })
    }
  }, [map, geometry])
  return null
}

// Keep Leaflet's internal size in sync with the container so tiles don't go
// grey after a layout / breakpoint change.
function InvalidateOnResize() {
  const map = useMap()
  useEffect(() => {
    const handler = () => map.invalidateSize()
    const observer = new ResizeObserver(handler)
    observer.observe(map.getContainer())
    window.addEventListener('resize', handler)
    handler()
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', handler)
    }
  }, [map])
  return null
}

// Leaflet's built-in scale bar (metric), so distances feel real.
function ScaleBar() {
  const map = useMap()
  useEffect(() => {
    const control = L.control.scale({ imperial: false, position: 'bottomleft' })
    control.addTo(map)
    return () => control.remove()
  }, [map])
  return null
}

// Leaflet-Geoman draw control: lets the user trace their own site boundary.
// Attaches to the raw Leaflet map via useMap() (same pattern as FitToResult /
// ScaleBar). Because Geoman is a plain Leaflet plugin, this works unchanged
// under react-leaflet v5 / React 19.
//
// On every draw / vertex-edit / drag it emits the current ring up to the parent
// as a GeoJSON Polygon (WGS84, [lon, lat]); on clear/remove it emits null. Only
// one site boundary is kept at a time. registerClear hands a clear() function up
// so the parent's "Clear" button can reset the drawing.
function DrawControl({ onPolygon, registerClear }) {
  const map = useMap()

  // Keep the latest callbacks in refs so the setup effect runs once per mount -
  // parent re-renders never tear down and rebuild the Geoman controls.
  const onPolygonRef = useRef(onPolygon)
  const registerClearRef = useRef(registerClear)
  useEffect(() => {
    onPolygonRef.current = onPolygon
  }, [onPolygon])
  useEffect(() => {
    registerClearRef.current = registerClear
  }, [registerClear])

  useEffect(() => {
    map.pm.addControls({
      position: 'topleft',
      drawPolygon: true,
      editMode: true,
      dragMode: true,
      removalMode: true,
      // Everything else off - a site boundary is a single polygon.
      drawMarker: false,
      drawPolyline: false,
      drawCircle: false,
      drawCircleMarker: false,
      drawRectangle: false,
      drawText: false,
      rotateMode: false,
      cutPolygon: false,
    })
    map.pm.setGlobalOptions({ snappable: true, snapDistance: 20 })

    const drawnPolygons = () =>
      map.pm.getGeomanLayers().filter((layer) => layer instanceof L.Polygon)

    // Emit the most recent drawn ring as a GeoJSON Polygon (or null if none).
    const emit = () => {
      const polygons = drawnPolygons()
      if (polygons.length === 0) {
        onPolygonRef.current?.(null)
        return
      }
      const feature = polygons[polygons.length - 1].toGeoJSON()
      onPolygonRef.current?.(feature.geometry)
    }

    const handleCreate = (event) => {
      const layer = event.layer
      // Keep a single boundary: drop any earlier polygon.
      drawnPolygons()
        .filter((other) => other !== layer)
        .forEach((other) => other.remove())
      // Re-emit whenever this layer's vertices move or the whole shape is dragged.
      layer.on('pm:edit', emit)
      layer.on('pm:update', emit)
      layer.on('pm:dragend', emit)
      emit()
    }

    map.on('pm:create', handleCreate)
    map.on('pm:remove', emit)

    // Hand a clear() up so the parent's "Clear" button can reset the drawing.
    registerClearRef.current?.(() => {
      drawnPolygons().forEach((layer) => layer.remove())
      onPolygonRef.current?.(null)
    })

    return () => {
      map.off('pm:create', handleCreate)
      map.off('pm:remove', emit)
      drawnPolygons().forEach((layer) => {
        layer.off('pm:edit', emit)
        layer.off('pm:update', emit)
        layer.off('pm:dragend', emit)
        layer.remove()
      })
      map.pm.removeControls()
      registerClearRef.current?.(null)
    }
  }, [map])

  return null
}

// Style each vegetation patch by its AS 3959 class; the governing patch (the
// one that drives the BAL rating) gets a thicker red outline.
function patchStyle(feature) {
  const governing = feature.properties.governing
  return {
    color: governing ? '#C23B22' : '#F3EEDF',
    weight: governing ? 3 : 1,
    opacity: governing ? 1 : 0.7,
    fillColor: vegColor(feature.properties.as3959_class),
    fillOpacity: governing ? 0.6 : 0.4,
  }
}

// Tooltip on each patch.
function onEachPatch(feature, layer) {
  const p = feature.properties
  const pct = p.pct_id != null ? ` · PCT #${p.pct_id}` : ''
  const label = `${p.as3959_class} — ${p.distance_m} m${pct}${
    p.governing ? ' (drives the rating)' : ''
  }`
  layer.bindTooltip(label, { sticky: true })
}

// A small "≈100 m" tag floated at the northern edge of the assessment ring.
function ringLabelIcon() {
  return L.divIcon({
    className: '',
    html:
      '<span style="background:rgba(243,238,223,0.92);color:#3C4733;' +
      'font-size:11px;font-weight:600;padding:1px 6px;border-radius:6px;' +
      'white-space:nowrap;box-shadow:0 1px 2px rgba(0,0,0,0.25)">&#8776;100 m</span>',
    iconSize: [0, 0],
  })
}

// Compact chip text for one transect: id + the numbers that matter. Hazardous
// sides show distance + slope + BAL; no-hazard sides just id + BAL-LOW.
function transectChipLabel(row) {
  if (!row.hasHazard) return `${row.id} · ${row.bal || 'BAL-LOW'}`
  const distance = row.distanceM != null ? `${Math.round(row.distanceM)} m` : '—'
  const slope = row.slopeDegrees != null ? `${row.slopeDegrees}°` : '—'
  return `${row.id} · ${distance} · ${slope} · ${row.bal}`
}

// A BAL-toned chip, anchored at the transect's boundary point and nudged a fixed
// pixel distance OUTWARD (along its bearing) so it sits just outside the edge.
// The governing side gets the heavy red treatment used for the governing patch.
function transectChipIcon(row, highlighted = false) {
  const bearing = ((row.bearing ?? 0) * Math.PI) / 180
  const OFFSET = 28 // px outward from the edge
  const dx = Math.sin(bearing) * OFFSET
  const dy = -Math.cos(bearing) * OFFSET // screen y grows downward

  const governing = row.isGoverning
  // The governing side and the hovered side both get the heavy treatment.
  const emphasised = governing || highlighted
  const border = emphasised ? '2px solid #7A1F1F' : '1px solid rgba(255,255,255,0.85)'
  const shadow = highlighted
    ? '0 0 0 3px rgba(255,255,255,0.9), 0 0 0 5px rgba(122,31,31,0.45), 0 2px 6px rgba(0,0,0,0.5)'
    : governing
      ? '0 0 0 3px rgba(122,31,31,0.30), 0 1px 3px rgba(0,0,0,0.45)'
      : '0 1px 2px rgba(0,0,0,0.35)'
  const scale = highlighted ? 1.15 : 1

  const chip =
    `<span style="display:inline-block;white-space:nowrap;` +
    `padding:${emphasised ? '3px 8px' : '2px 7px'};border-radius:7px;` +
    `background:${row.balColor};color:#fff;` +
    `font-weight:${emphasised ? 800 : 700};font-size:${emphasised ? 12 : 11}px;` +
    `font-family:system-ui,-apple-system,sans-serif;` +
    `border:${border};box-shadow:${shadow}">${transectChipLabel(row)}</span>`

  return L.divIcon({
    className: '',
    // Outer wrapper centres the chip on the point, then nudges it outward.
    html:
      `<div style="transform:translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${scale});` +
      `transition:transform 120ms ease">${chip}</div>`,
    iconSize: [0, 0],
  })
}

// The per-transect chips drawn around the drawn boundary (boundary mode). Only
// transects that carry a boundary point are drawn, so point/address mode (which
// has no transect points) renders nothing here. Non-interactive so the chips
// never intercept clicks or block the draw tool.
// When a side is hovered in the results panel, highlight the actual drawn
// boundary edge(s) facing that compass side: a white casing under a bold ember
// line, drawn over the dashed outline. Mounts/unmounts with the hover, so it's
// unmistakable. The edge->side mapping uses the same binning as the transects.
function BoundaryEdgeHighlight({ siteBoundary, highlightedSide }) {
  if (!siteBoundary || highlightedSide == null) return null
  const edges = polygonEdgesBySide(siteBoundary).filter(
    (edge) => edge.side === highlightedSide,
  )
  if (edges.length === 0) return null
  return (
    <>
      {edges.map((edge, index) => (
        <Polyline
          key={`halo-${index}`}
          positions={edge.latlngs}
          pathOptions={{ color: '#FFFFFF', weight: 9, opacity: 0.9 }}
        />
      ))}
      {edges.map((edge, index) => (
        <Polyline
          key={`edge-${index}`}
          positions={edge.latlngs}
          pathOptions={{ color: '#7A1F1F', weight: 5, opacity: 1 }}
        />
      ))}
    </>
  )
}

function TransectAnnotations({ rows, highlightedSide }) {
  const located = rows.filter((row) => row.pointLat != null && row.pointLon != null)
  if (located.length === 0) return null
  return (
    <>
      {located.map((row) => {
        const highlighted = highlightedSide != null && row.side === highlightedSide
        return (
          <Marker
            key={row.id}
            position={[row.pointLat, row.pointLon]}
            icon={transectChipIcon(row, highlighted)}
            interactive={false}
            keyboard={false}
            zIndexOffset={highlighted ? 1000 : 0}
          />
        )
      })}
    </>
  )
}

// A working compass that reads the device's orientation sensor (magnetometer)
// and rotates the dial so N always points to real-world north as you turn the
// device — like a phone compass. The map itself never rotates (plain Leaflet,
// always north-up), so on a desktop with no sensor this degrades gracefully to a
// static north-up rose, which is still correct for orienting the per-side
// (N/E/S/W) ratings.
//
// iOS 13+ requires an explicit, user-gesture permission grant before any
// orientation events fire, so we show a tappable "Enable" overlay there.
function MapCompass() {
  // heading: degrees clockwise from true north that the device is pointing.
  // null until we get a reading (then we rotate the dial to keep N on north).
  const [heading, setHeading] = useState(null)
  // On iOS the permission API exists and must be invoked from a tap.
  const needsPermission =
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  const [granted, setGranted] = useState(!needsPermission)

  useEffect(() => {
    if (!granted) return

    const handle = (event) => {
      // iOS Safari exposes a ready-made compass heading (degrees from north,
      // clockwise). Elsewhere, absolute orientation gives `alpha` measured
      // counter-clockwise from north, so the heading is 360 - alpha.
      let next = null
      if (typeof event.webkitCompassHeading === 'number') {
        next = event.webkitCompassHeading
      } else if (event.absolute && typeof event.alpha === 'number') {
        next = 360 - event.alpha
      }
      if (next != null && !Number.isNaN(next)) {
        setHeading(((next % 360) + 360) % 360)
      }
    }

    // `deviceorientationabsolute` is the true-north reference where supported;
    // fall back to plain `deviceorientation` (relative) otherwise.
    const eventName =
      'ondeviceorientationabsolute' in window
        ? 'deviceorientationabsolute'
        : 'deviceorientation'
    window.addEventListener(eventName, handle, true)
    return () => window.removeEventListener(eventName, handle, true)
  }, [granted])

  const enable = async () => {
    try {
      const result = await DeviceOrientationEvent.requestPermission()
      if (result === 'granted') setGranted(true)
    } catch {
      // Permission denied / not in a secure context — stay on the static rose.
    }
  }

  // Rotate the whole rose by -heading so the N tip tracks real-world north.
  const rotation = heading == null ? 0 : -heading
  const live = heading != null

  return (
    <div
      className="pointer-events-auto absolute right-3 top-16 z-[500] flex flex-col items-center gap-1 rounded-full bg-ember-cream/95 p-1 shadow-md"
      title={live ? `Heading ${Math.round(heading)}°` : 'North-up compass'}
    >
      <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        role="img"
        style={{
          transform: `rotate(${rotation}deg)`,
          transition: 'transform 120ms linear',
        }}
      >
        <title>{live ? `Compass — heading ${Math.round(heading)}°` : 'North-up compass'}</title>
        <circle cx="24" cy="24" r="22" fill="none" stroke="#3C4733" strokeOpacity="0.25" strokeWidth="1" />
        {/* Needle: red north half, forest south half. */}
        <polygon points="24,6 28,24 24,22 20,24" fill="#C23B22" />
        <polygon points="24,42 28,24 24,26 20,24" fill="#3C4733" />
        {/* Cardinal labels. */}
        <text x="24" y="9" textAnchor="middle" fontSize="8" fontWeight="700" fill="#3C4733">N</text>
        <text x="24" y="46" textAnchor="middle" fontSize="7" fill="#3C4733">S</text>
        <text x="44" y="27" textAnchor="middle" fontSize="7" fill="#3C4733">E</text>
        <text x="4" y="27" textAnchor="middle" fontSize="7" fill="#3C4733">W</text>
      </svg>
      {needsPermission && !granted && (
        <button
          type="button"
          onClick={enable}
          className="rounded-full bg-ember-forest px-2 py-0.5 text-[10px] font-semibold text-ember-cream"
        >
          Enable
        </button>
      )}
    </div>
  )
}

// Colour legend for the vegetation classes present, plus what the ring and the
// red outline mean. Plain English, in a compact corner card.
function MapLegend({ vegetation }) {
  const classes = [
    ...new Set(vegetation.features.map((f) => f.properties.as3959_class)),
  ]

  return (
    <div className="absolute bottom-9 left-3 z-[500] max-w-[200px] rounded-lg bg-ember-cream/95 p-2 text-xs text-ember-forest shadow-md">
      <div className="mb-1 font-semibold">What you're seeing</div>
      <ul className="space-y-1">
        {classes.map((cls) => (
          <li key={cls} className="flex items-center gap-2">
            <span
              className="inline-block h-3 w-3 shrink-0 rounded-sm"
              style={{ backgroundColor: vegColor(cls) }}
            />
            {cls}
          </li>
        ))}
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 shrink-0 rounded-sm border-2 border-[#C23B22]" />
          drives the rating
        </li>
        <li className="flex items-center gap-2">
          <span className="inline-block h-3 w-3 shrink-0 rounded-full border-2 border-dashed border-white bg-transparent" />
          100 m assessment zone
        </li>
      </ul>
    </div>
  )
}

export default function AssessmentMap({
  geometry,
  onPolygon,
  transects,
  governingDirection,
  highlightedSide,
}) {
  // Draw-tool state: whether a site boundary is currently drawn (drives the
  // "Clear" button), and a handle to the DrawControl's clear() function.
  const [hasDrawing, setHasDrawing] = useState(false)
  const clearDrawingRef = useRef(null)

  // Per-transect rows for the on-screen annotation chips (boundary mode). In
  // point/address mode the entries carry no boundary point, so nothing is drawn.
  const transectRows = transects?.length
    ? buildTransectRows({ per_direction: transects, governing_direction: governingDirection })
    : []

  // Forward the drawn polygon to the parent and track whether one exists. Stable
  // identity isn't required (DrawControl reads callbacks via refs), but useMemo-
  // friendly so the effect wiring stays clean.
  const handlePolygon = useCallback(
    (polygon) => {
      setHasDrawing(Boolean(polygon))
      onPolygon?.(polygon)
    },
    [onPolygon],
  )
  const registerClear = useCallback((fn) => {
    clearDrawingRef.current = fn
  }, [])

  // The assessed site boundary echoed back by the backend (boundary mode), so
  // the outline persists in the result view after the drawing layer is gone.
  const siteBoundary = geometry?.site_polygon || null

  // GeoJSON coordinates are [lon, lat]; Leaflet wants [lat, lon].
  let position = null
  if (geometry?.property_point) {
    const [lon, lat] = geometry.property_point.coordinates
    position = [lat, lon]
  }

  const vegetation = geometry?.vegetation
  const hasPatches = vegetation?.features?.length > 0

  // Distance line: GeoJSON is [lon, lat]; Leaflet Polyline wants [lat, lon].
  let distanceLine = null
  if (geometry?.distance_line) {
    distanceLine = geometry.distance_line.coordinates.map(([lon, lat]) => [
      lat,
      lon,
    ])
  }

  const governingDistance = geometry?.vegetation?.features?.find(
    (f) => f.properties.governing,
  )?.properties.distance_m

  // North-edge point of the 100 m ring, for the "≈100 m" tag.
  const ringLabelPoint = position
    ? [
        position[0] + (geometry.assessment_ring_m || 100) / METRES_PER_DEGREE_LAT,
        position[1],
      ]
    : null

  return (
    <div className="flex h-full w-full flex-col">
      <div className="relative isolate flex-1">
        <MapContainer
          center={NSW_CENTER}
          zoom={DEFAULT_ZOOM}
          className="h-full w-full rounded-2xl"
          scrollWheelZoom
        >
          <LayersControl position="topright">
            {/* Base maps */}
            <LayersControl.BaseLayer checked name="Satellite">
              <TileLayer
                attribution="Tiles &copy; Esri"
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              />
            </LayersControl.BaseLayer>
            <LayersControl.BaseLayer name="Street">
              <TileLayer
                attribution="&copy; OpenStreetMap contributors"
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              />
            </LayersControl.BaseLayer>

            {position && (
              <>
                {/* Vegetation patches (toggleable). */}
                {hasPatches && (
                  <LayersControl.Overlay checked name="Vegetation">
                    <GeoJSON
                      key={JSON.stringify(geometry.property_point.coordinates)}
                      data={vegetation}
                      style={patchStyle}
                      onEachFeature={onEachPatch}
                    />
                  </LayersControl.Overlay>
                )}

                {/* 100 m assessment ring: a dark halo under a white dashed line
                    so it reads on any background, plus an edge label. */}
                <LayersControl.Overlay checked name="100 m assessment zone">
                  <LayerGroup>
                    <Circle
                      center={position}
                      radius={geometry.assessment_ring_m}
                      pathOptions={{
                        color: '#000000',
                        weight: 5,
                        opacity: 0.25,
                        fill: false,
                      }}
                    />
                    <Circle
                      center={position}
                      radius={geometry.assessment_ring_m}
                      pathOptions={{
                        color: '#FFFFFF',
                        weight: 2,
                        opacity: 0.95,
                        dashArray: '6 6',
                        fill: false,
                      }}
                    />
                    {ringLabelPoint && (
                      <Marker
                        position={ringLabelPoint}
                        icon={ringLabelIcon()}
                        interactive={false}
                        keyboard={false}
                      />
                    )}
                  </LayerGroup>
                </LayersControl.Overlay>

                {/* Internal 150 m search area - hidden by default, here for
                    anyone who wants to see the raw query radius. */}
                <LayersControl.Overlay name="Search area (150 m)">
                  <Circle
                    center={position}
                    radius={geometry.search_buffer_m}
                    pathOptions={{
                      color: '#C28E3F',
                      weight: 1,
                      opacity: 0.7,
                      fill: false,
                    }}
                  />
                </LayersControl.Overlay>
              </>
            )}
          </LayersControl>

          <InvalidateOnResize />
          <ScaleBar />
          <DrawControl onPolygon={handlePolygon} registerClear={registerClear} />

          {/* The assessed site boundary outline (boundary mode), so it stays
              visible after the interactive drawing layer is gone. */}
          {siteBoundary && (
            <GeoJSON
              key={JSON.stringify(siteBoundary)}
              data={siteBoundary}
              style={{ color: '#F3EEDF', weight: 2, dashArray: '5 5', fill: false }}
            />
          )}

          {/* Hovering a side card highlights that side's drawn boundary edge. */}
          <BoundaryEdgeHighlight
            siteBoundary={siteBoundary}
            highlightedSide={highlightedSide}
          />

          {/* Per-transect BAL chips around the drawn boundary (boundary mode). */}
          <TransectAnnotations rows={transectRows} highlightedSide={highlightedSide} />

          {position && (
            <>
              {/* Line from the house to the nearest vegetation, with a label.
                  Kept always-on (it's the core story, not a toggle). */}
              {distanceLine && (
                <Polyline
                  positions={distanceLine}
                  pathOptions={{ color: '#7A1F1F', weight: 2, dashArray: '6 6' }}
                >
                  <Tooltip permanent direction="center">
                    {`${governingDistance ?? ''} m`}
                  </Tooltip>
                </Polyline>
              )}

              <Marker position={position} />
              <FitToResult geometry={geometry} />
            </>
          )}
        </MapContainer>

        <MapCompass />

        {hasPatches && <MapLegend vegetation={vegetation} />}

        {/* Clear the drawn site boundary. Shown only once something is drawn;
            calls the clear() the DrawControl registered. */}
        {hasDrawing && (
          <button
            type="button"
            onClick={() => clearDrawingRef.current?.()}
            className="absolute bottom-3 right-3 z-[500] rounded-lg bg-ember-cream/95 px-3 py-1.5 text-xs font-semibold text-ember-forest shadow-md hover:bg-ember-cream"
          >
            Clear boundary
          </button>
        )}
      </div>

      {/* Plain-English caption under the map. */}
      <p
        className="mt-3 text-xs leading-relaxed"
        style={{ color: 'var(--ink-soft)' }}
      >
        Dashed circle = ~100 m assessment zone. Vegetation within it affects your
        rating.
      </p>
    </div>
  )
}

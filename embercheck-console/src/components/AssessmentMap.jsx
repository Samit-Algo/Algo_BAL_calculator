// AssessmentMap — a READ-ONLY port of the consumer app's AssessmentMap.jsx.
// Same Leaflet rendering (satellite/street tiles, vegetation patches, 100 m ring,
// 150 m search area, distance line, property pin, drawn boundary outline,
// per-transect BAL chips, edge highlight, compass, legend, scale bar), fed by the
// SAME geometry object the consumer draws from (now surfaced by CONSOLE-B2). The
// only things removed are the editing affordances: the Geoman draw control, the
// "Clear boundary" button, and the onPolygon plumbing — the assessor never edits
// geometry here. Tailwind ember-* classes are replaced with inline styles using
// the console tokens.
import { useEffect, useState } from 'react'
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
import 'leaflet/dist/leaflet.css'
import { vegColor, buildTransectRows, polygonEdgesBySide } from '../lib/mapData'

import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png'
import markerIcon from 'leaflet/dist/images/marker-icon.png'
import markerShadow from 'leaflet/dist/images/marker-shadow.png'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

const NSW_CENTER = [-33.87, 151.21]
const DEFAULT_ZOOM = 6
const NO_VEG_ZOOM = 16
const MAX_FIT_ZOOM = 18
const METRES_PER_DEGREE_LAT = 111320

// Frame the map around the property + nearest vegetation + distance line.
function FitToResult({ geometry }) {
  const map = useMap()
  useEffect(() => {
    if (!geometry?.property_point) return
    const [lon, lat] = geometry.property_point.coordinates
    const bounds = L.latLngBounds([[lat, lon]])
    const governing = geometry.vegetation?.features?.find((f) => f.properties.governing)
    if (governing) bounds.extend(L.geoJSON(governing).getBounds())
    if (geometry.distance_line) {
      geometry.distance_line.coordinates.forEach(([lo, la]) => bounds.extend([la, lo]))
    }
    if (!governing && !geometry.distance_line) {
      map.setView([lat, lon], NO_VEG_ZOOM)
    } else {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: MAX_FIT_ZOOM })
    }
  }, [map, geometry])
  return null
}

// Keep Leaflet's internal size in sync so tiles don't go grey after a layout
// change (the cockpit pane resizes when the panel scrolls / window resizes).
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

function ScaleBar() {
  const map = useMap()
  useEffect(() => {
    const control = L.control.scale({ imperial: false, position: 'bottomleft' })
    control.addTo(map)
    return () => control.remove()
  }, [map])
  return null
}

function patchStyle(feature) {
  const governing = feature.properties.governing
  return {
    color: governing ? '#C23B22' : '#F3EEDF',
    weight: governing ? 2 : 1,
    opacity: governing ? 0.8 : 0.5,
    fillColor: vegColor(feature.properties.as3959_class),
    fillOpacity: governing ? 0.35 : 0.2,
  }
}

function onEachPatch(feature, layer) {
  const p = feature.properties
  const pct = p.pct_id != null ? ` · PCT #${p.pct_id}` : ''
  const label = `${p.as3959_class} — ${p.distance_m} m${pct}${p.governing ? ' (map draft — refine with photos)' : ''}`
  layer.bindTooltip(label, { sticky: true })
}

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

function transectChipLabel(row) {
  if (!row.hasHazard) return `${row.id} · ${row.bal || 'BAL-LOW'}`
  const distance = row.distanceM != null ? `${Math.round(row.distanceM)} m` : '—'
  const slope = row.slopeDegrees != null ? `${row.slopeDegrees}°` : '—'
  return `${row.id} · ${distance} · ${slope} · ${row.bal}`
}

function transectChipIcon(row, highlighted = false) {
  const bearing = ((row.bearing ?? 0) * Math.PI) / 180
  const OFFSET = 28
  const dx = Math.sin(bearing) * OFFSET
  const dy = -Math.cos(bearing) * OFFSET
  const governing = row.isGoverning
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
    html:
      `<div style="transform:translate(-50%,-50%) translate(${dx}px,${dy}px) scale(${scale});` +
      `transition:transform 120ms ease">${chip}</div>`,
    iconSize: [0, 0],
  })
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

// Highlight the drawn boundary edge(s) facing the selected compass side.
function BoundaryEdgeHighlight({ siteBoundary, highlightedSide }) {
  if (!siteBoundary || highlightedSide == null) return null
  const edges = polygonEdgesBySide(siteBoundary).filter((edge) => edge.side === highlightedSide)
  if (edges.length === 0) return null
  return (
    <>
      {edges.map((edge, index) => (
        <Polyline key={`halo-${index}`} positions={edge.latlngs} interactive={false} pathOptions={{ color: '#FFFFFF', weight: 9, opacity: 0.9 }} />
      ))}
      {edges.map((edge, index) => (
        <Polyline key={`edge-${index}`} positions={edge.latlngs} interactive={false} pathOptions={{ color: '#7A1F1F', weight: 5, opacity: 1 }} />
      ))}
    </>
  )
}

// Static north-up compass rose (the consumer's device-orientation version
// degrades to exactly this on desktop, which is where the Console runs).
function MapCompass() {
  return (
    <div
      style={{
        position: 'absolute',
        right: 12,
        top: 64,
        zIndex: 500,
        background: 'rgba(247,242,226,0.95)',
        borderRadius: 99,
        padding: 4,
        boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
      }}
      title="North-up compass"
    >
      <svg width="40" height="40" viewBox="0 0 48 48" role="img">
        <title>North-up compass</title>
        <circle cx="24" cy="24" r="22" fill="none" stroke="#3C4733" strokeOpacity="0.25" strokeWidth="1" />
        <polygon points="24,6 28,24 24,22 20,24" fill="#C23B22" />
        <polygon points="24,42 28,24 24,26 20,24" fill="#3C4733" />
        <text x="24" y="9" textAnchor="middle" fontSize="8" fontWeight="700" fill="#3C4733">N</text>
        <text x="24" y="46" textAnchor="middle" fontSize="7" fill="#3C4733">S</text>
        <text x="44" y="27" textAnchor="middle" fontSize="7" fill="#3C4733">E</text>
        <text x="4" y="27" textAnchor="middle" fontSize="7" fill="#3C4733">W</text>
      </svg>
    </div>
  )
}

function MapLegend({ vegetation, hasBoundary }) {
  const classes = [...new Set(vegetation.features.map((f) => f.properties.as3959_class))]
  const swatch = (style) => ({ display: 'inline-block', height: 12, width: 12, flexShrink: 0, borderRadius: 3, ...style })

  // On phones the legend covered too much of the map, so it collapses to a small
  // "Legend" pill by default and the assessor taps to expand it.
  const mq = '(max-width: 820px)'
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(mq).matches,
  )
  const [open, setOpen] = useState(() =>
    typeof window === 'undefined' ? true : !window.matchMedia(mq).matches,
  )
  useEffect(() => {
    const m = window.matchMedia(mq)
    const onChange = (e) => {
      setIsMobile(e.matches)
      setOpen(!e.matches)
    }
    m.addEventListener('change', onChange)
    return () => m.removeEventListener('change', onChange)
  }, [])

  const shell = {
    position: 'absolute',
    bottom: 34,
    left: 12,
    zIndex: 500,
    borderRadius: 8,
    background: 'rgba(247,242,226,0.95)',
    color: '#3C4733',
    boxShadow: '0 1px 4px rgba(0,0,0,0.2)',
  }

  // Collapsed (mobile): a compact tappable pill that doesn't obscure the map.
  if (isMobile && !open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        style={{ ...shell, display: 'flex', alignItems: 'center', gap: 6, padding: '6px 11px', border: 'none', cursor: 'pointer', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}
      >
        <span style={swatch({ background: vegColor(classes[0]) || '#5e6b4f' })} />
        Legend
      </button>
    )
  }

  return (
    <div style={{ ...shell, maxWidth: 220, padding: 8, fontSize: 12 }}>
      <button
        type="button"
        onClick={() => isMobile && setOpen(false)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 4, padding: 0, border: 'none', background: 'transparent', color: 'inherit', cursor: isMobile ? 'pointer' : 'default', fontSize: 12, fontWeight: 700, fontFamily: 'inherit' }}
      >
        What you’re seeing
        {isMobile && <span style={{ fontSize: 15, lineHeight: 1, opacity: 0.6 }}>×</span>}
      </button>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {hasBoundary && (
          <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={swatch({ border: '2px dashed #E8C547', background: 'transparent' })} />
            Your boundary
          </li>
        )}
        {classes.map((cls) => (
          <li key={cls} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span style={swatch({ background: vegColor(cls) })} />
            {cls}
          </li>
        ))}
        <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={swatch({ border: '2px solid #C23B22' })} />
          map draft (refine with photos)
        </li>
        <li style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={swatch({ borderRadius: 99, border: '2px dashed #fff', background: 'transparent' })} />
          100 m assessment zone
        </li>
      </ul>
    </div>
  )
}

export default function AssessmentMap({ geometry, transects, governingDirection, highlightedSide }) {
  const transectRows = transects?.length ? buildTransectRows(transects, governingDirection) : []

  const rawBoundary = geometry?.site_polygon || null
  const siteBoundary =
    rawBoundary &&
    (rawBoundary.type === 'Polygon' ||
      rawBoundary.type === 'MultiPolygon' ||
      (rawBoundary.type === 'Feature' && rawBoundary.geometry?.type === 'Polygon'))
      ? rawBoundary
      : null

  let position = null
  if (geometry?.property_point) {
    const [lon, lat] = geometry.property_point.coordinates
    position = [lat, lon]
  }

  const vegetation = geometry?.vegetation
  const hasPatches = vegetation?.features?.length > 0

  let distanceLine = null
  if (geometry?.distance_line) {
    distanceLine = geometry.distance_line.coordinates.map(([lon, lat]) => [lat, lon])
  }
  const governingDistance = geometry?.vegetation?.features?.find((f) => f.properties.governing)?.properties.distance_m

  const ringLabelPoint = position
    ? [position[0] + (geometry.assessment_ring_m || 100) / METRES_PER_DEGREE_LAT, position[1]]
    : null

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <MapContainer center={NSW_CENTER} zoom={DEFAULT_ZOOM} style={{ height: '100%', width: '100%' }} scrollWheelZoom>
        <LayersControl position="topright">
          <LayersControl.BaseLayer checked name="Satellite">
            <TileLayer attribution="Tiles &copy; Esri" url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}" />
          </LayersControl.BaseLayer>
          <LayersControl.BaseLayer name="Street">
            <TileLayer attribution="&copy; OpenStreetMap contributors" url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          </LayersControl.BaseLayer>

          {position && (
            <>
              {hasPatches && (
                <LayersControl.Overlay checked name="Vegetation">
                  <GeoJSON
                    key={`veg-${JSON.stringify(geometry.property_point.coordinates)}`}
                    data={vegetation}
                    style={patchStyle}
                    onEachFeature={onEachPatch}
                  />
                </LayersControl.Overlay>
              )}

              <LayersControl.Overlay checked name="100 m assessment zone">
                <LayerGroup>
                  <Circle center={position} radius={geometry.assessment_ring_m} pathOptions={{ color: '#000000', weight: 5, opacity: 0.25, fill: false }} />
                  <Circle center={position} radius={geometry.assessment_ring_m} pathOptions={{ color: '#FFFFFF', weight: 2, opacity: 0.95, dashArray: '6 6', fill: false }} />
                  {ringLabelPoint && <Marker position={ringLabelPoint} icon={ringLabelIcon()} interactive={false} keyboard={false} />}
                </LayerGroup>
              </LayersControl.Overlay>

              <LayersControl.Overlay name="Search area (150 m)">
                <Circle center={position} radius={geometry.search_buffer_m} pathOptions={{ color: '#C28E3F', weight: 1, opacity: 0.7, fill: false }} />
              </LayersControl.Overlay>
            </>
          )}
        </LayersControl>

        <InvalidateOnResize />
        <ScaleBar />

        {siteBoundary && (
          <GeoJSON key={JSON.stringify(siteBoundary)} data={siteBoundary} style={{ color: '#E8C547', weight: 3, opacity: 1, dashArray: '8 6', fill: false }} />
        )}

        <BoundaryEdgeHighlight siteBoundary={siteBoundary} highlightedSide={highlightedSide} />
        <TransectAnnotations rows={transectRows} highlightedSide={highlightedSide} />

        {position && (
          <>
            {distanceLine && (
              <Polyline positions={distanceLine} pathOptions={{ color: '#7A1F1F', weight: 2, dashArray: '6 6' }}>
                <Tooltip permanent direction="center">{`${governingDistance ?? ''} m`}</Tooltip>
              </Polyline>
            )}
            <Marker position={position} keyboard={false} />
            <FitToResult geometry={geometry} />
          </>
        )}
      </MapContainer>

      <MapCompass />
      {hasPatches && <MapLegend vegetation={vegetation} hasBoundary={!!siteBoundary} />}
    </div>
  )
}

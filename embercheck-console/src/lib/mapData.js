// Map data helpers — ported from the consumer app (lib/bal.js vegColor,
// lib/ec.js balIndex/balToneColor, lib/report.js buildTransectRows/toRow,
// lib/geo.js polygonEdgesBySide) so the Console draws the SAME map. Pure data;
// no React, no Leaflet.
import { EC_BAL } from './bal'

// AS 3959 class → fill colour (consumer lib/bal.js VEG_COLORS).
const VEG_COLORS = {
  Forest: '#2F5D34',
  Woodland: '#5C8A3A',
  Shrubland: '#8FA63A',
  Scrub: '#8FA63A',
  Heath: '#A9863A',
  Mallee: '#7A9A4A',
  Rainforest: '#1F5135',
  Grassland: '#C9B458',
}
export function vegColor(as3959Class) {
  return VEG_COLORS[as3959Class] || '#6F8F4A'
}

// BAL rating → spectrum index / tone colour (consumer lib/ec.js).
export function balIndex(rating) {
  if (!rating) return -1
  const id = String(rating).replace(/^BAL-/i, '').toUpperCase()
  return EC_BAL.findIndex((b) => b.id.toUpperCase() === id)
}
export function balToneColor(rating) {
  const i = balIndex(rating)
  return i >= 0 ? EC_BAL[i].color : '#6B7280'
}

// Compass sector → bearing, so rows without an outward_bearing still order.
const SECTOR_BEARING = { North: 0, East: 90, South: 180, West: 270 }

// One transect (per_direction entry) → a map-chip row model (consumer toRow).
function toRow(transect, governingDirection) {
  const hasHazard = Boolean(transect.vegetation_found)
  const side = transect.outward_direction || transect.direction || null
  const bearing =
    transect.outward_bearing ??
    SECTOR_BEARING[transect.outward_direction] ??
    SECTOR_BEARING[transect.direction] ??
    null
  return {
    id: transect.direction,
    side,
    bearing,
    // The boundary sample point this transect was measured from (null when the
    // saved case didn't store it — the chip is simply not drawn then).
    pointLat: transect.transect_point_lat ?? null,
    pointLon: transect.transect_point_lon ?? null,
    distanceM: hasHazard ? (transect.distance_m ?? null) : null,
    slopeDegrees: transect.effective_slope_degrees ?? null,
    bal: transect.bal_rating || null,
    balColor: balToneColor(transect.bal_rating),
    hasHazard,
    isGoverning: transect.direction === governingDirection,
  }
}

// Ordered chip rows from the boundary transects (consumer buildTransectRows).
export function buildTransectRows(perDirection, governingDirection) {
  const transects = perDirection ?? []
  return transects
    .map((t) => toRow(t, governingDirection))
    .sort((a, b) => {
      const ba = a.bearing ?? Number.POSITIVE_INFINITY
      const bb = b.bearing ?? Number.POSITIVE_INFINITY
      if (ba !== bb) return ba - bb
      return String(a.id).localeCompare(String(b.id))
    })
}

// Bearing (deg from north) A→B, both [lon, lat] (consumer lib/geo.js).
function bearing([lon1, lat1], [lon2, lat2]) {
  const toRad = (d) => (d * Math.PI) / 180
  const toDeg = (r) => (r * 180) / Math.PI
  const dLon = toRad(lon2 - lon1)
  const y = Math.sin(dLon) * Math.cos(toRad(lat2))
  const x =
    Math.cos(toRad(lat1)) * Math.sin(toRad(lat2)) -
    Math.sin(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.cos(dLon)
  return (toDeg(Math.atan2(y, x)) + 360) % 360
}

// Bearing → 4-way side, matching the backend's transect binning exactly.
function bearingToSide(deg) {
  if (deg >= 315 || deg < 45) return 'North'
  if (deg < 135) return 'East'
  if (deg < 225) return 'South'
  return 'West'
}

// GeoJSON Polygon (or Feature) → edges tagged with the compass side each faces
// (consumer lib/geo.js polygonEdgesBySide). Each edge: { side, latlngs }.
export function polygonEdgesBySide(polygon) {
  const geometry = polygon?.geometry || polygon
  const ring = geometry?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return []

  const vertices = ring.slice()
  const [fx, fy] = vertices[0]
  const [lx, ly] = vertices[vertices.length - 1]
  if (fx === lx && fy === ly) vertices.pop()
  if (vertices.length < 3) return []

  let cx = 0
  let cy = 0
  for (const [lon, lat] of vertices) {
    cx += lon
    cy += lat
  }
  const centroid = [cx / vertices.length, cy / vertices.length]

  const edges = []
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]
    const b = vertices[(i + 1) % vertices.length]
    const midpoint = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]
    edges.push({
      side: bearingToSide(bearing(centroid, midpoint)),
      latlngs: [
        [a[1], a[0]],
        [b[1], b[0]],
      ],
    })
  }
  return edges
}

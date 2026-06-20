// Geometry helpers for turning the assessment's coordinates into plain-English
// descriptions (e.g. "to the north-west").

const COMPASS = [
  'north',
  'north-east',
  'east',
  'south-east',
  'south',
  'south-west',
  'west',
  'north-west',
]

// Initial bearing (degrees, 0 = north) from point A to point B, both [lon, lat].
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

// Compass direction from the house to the nearest vegetation, derived from the
// distance line ([[house_lon, house_lat], [veg_lon, veg_lat]]). Returns null
// when there's no line (no vegetation in range).
export function directionToVegetation(distanceLine) {
  if (!distanceLine?.coordinates || distanceLine.coordinates.length < 2) {
    return null
  }
  const [house, veg] = distanceLine.coordinates
  const deg = bearing(house, veg)
  const index = Math.round(deg / 45) % 8
  return COMPASS[index]
}

// Map a bearing (degrees from north) to a 4-way compass side, matching the
// backend's transect binning exactly: North 315-45, East 45-135, South 135-225,
// West 225-315.
function bearingToSide(deg) {
  if (deg >= 315 || deg < 45) return 'North'
  if (deg < 135) return 'East'
  if (deg < 225) return 'South'
  return 'West'
}

// Given a GeoJSON Polygon (WGS84 lon/lat, or a Feature wrapping one), return its
// edges, each tagged with the compass side it faces (outward from the polygon
// centroid - the same convention the backend bins transects by). Each edge is
// { side, latlngs: [[lat, lon], [lat, lon]] }, ready for a Leaflet Polyline, so
// hovering a side card can highlight the real drawn edge(s) facing that way.
// Returns [] for anything that isn't a usable polygon ring.
export function polygonEdgesBySide(polygon) {
  const geometry = polygon?.geometry || polygon
  const ring = geometry?.coordinates?.[0]
  if (!Array.isArray(ring) || ring.length < 4) return []

  // Work on the distinct vertices (drop the closing duplicate if present).
  const vertices = ring.slice()
  const [fx, fy] = vertices[0]
  const [lx, ly] = vertices[vertices.length - 1]
  if (fx === lx && fy === ly) vertices.pop()
  if (vertices.length < 3) return []

  // Centroid = mean of the vertices: enough to decide which way each edge faces.
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

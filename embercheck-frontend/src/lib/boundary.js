// Helpers for the login-gated boundary assessment flow.

/** True when an assessment dict was run from a drawn site boundary (its
 *  transects carry outward_direction). Point-mode entries never have this. */
export function isBoundaryAssessment(assessment) {
  return Boolean(assessment?.per_direction?.some((side) => side.outward_direction))
}

/** The saved boundary read on a case, or null. Boundary reads live in their own
 *  `boundary_assessment` field so they coexist with the point/photo read. */
export function caseBoundaryResult(caseRecord) {
  return caseRecord?.boundary_assessment || null
}

/** Whether a case carries a saved boundary read. */
export function caseHasBoundary(caseRecord) {
  return Boolean(caseRecord?.boundary_assessment)
}

/** Turn stored PropertyInfo.boundary_polygon coordinates into a GeoJSON Polygon. */
export function coordsToGeoJSONPolygon(coords) {
  if (!Array.isArray(coords) || coords.length === 0) return null
  return { type: 'Polygon', coordinates: coords }
}

/** Best-effort polygon for edit/resume: the boundary read's echoed ring, then
 *  the case property's stored coordinates. */
export function boundaryPolygonFromCase(caseRecord) {
  const fromBoundary = caseRecord?.boundary_assessment?.geometry?.site_polygon
  if (fromBoundary) return fromBoundary
  return coordsToGeoJSONPolygon(caseRecord?.property?.boundary_polygon)
}

// Shapes the boundary-mode transects into display rows for the BAR-style report
// (the per-transect table now; the annotated map + PDF later). Pure data: no
// React, no map, no async. The backend stays the source of truth for ratings -
// here we only normalize field names, attach a BAL tone colour, order the rows
// around the perimeter, and flag the governing one.

import { balIndex, balToneColor } from './ec'

// Compass sector -> bearing (degrees from north), so rows without an explicit
// outward_bearing (e.g. point-mode N/E/S/W entries) still order around the
// perimeter. Only the four sectors the engine emits are needed.
const SECTOR_BEARING = {
  North: 0,
  East: 90,
  South: 180,
  West: 270,
}

// Turn one transect (a per_direction entry) into a row model for the report.
// Boundary-mode transects carry outward_direction/outward_bearing and a T../S..
// id; point-mode entries (North/East/South/West) are tolerated too, so the same
// table can describe either, though only boundary mode is wired for now.
function toRow(transect, governingDirection) {
  const hasHazard = Boolean(transect.vegetation_found)
  const side = transect.outward_direction || transect.direction || null
  const bearing =
    transect.outward_bearing ??
    SECTOR_BEARING[transect.outward_direction] ??
    SECTOR_BEARING[transect.direction] ??
    null

  return {
    id: transect.direction, // "T03" / "S01" (or "East" in point mode)
    side, // the compass side this transect faces
    bearing, // for ordering around the boundary, and the outward chip nudge
    // The boundary sample point this transect was measured from (null in point
    // mode). The annotated map places this side's chip here, nudged outward.
    pointLat: transect.transect_point_lat ?? null,
    pointLon: transect.transect_point_lon ?? null,
    vegetationClass: hasHazard ? transect.vegetation_class || null : null,
    distanceM: hasHazard ? transect.distance_m ?? null : null,
    slopeDegrees: transect.effective_slope_degrees ?? null,
    slopeDirection: transect.slope_direction || null,
    bal: transect.bal_rating || null,
    balSeverity: balIndex(transect.bal_rating), // -1 unknown, 0 LOW .. 5 FZ
    balColor: balToneColor(transect.bal_rating),
    hasHazard,
    needsDistance: Boolean(transect.needs_distance),
    requiresReview: Boolean(transect.requires_manual_review),
    isGoverning: transect.direction === governingDirection,
  }
}

// Build the ordered list of table rows from an /assess result. Rows read
// clockwise around the perimeter (by outward bearing), ties broken by id so even
// (T..) and snapped (S..) transects stay grouped and the order is stable.
export function buildTransectRows(result) {
  const transects = result?.per_direction ?? []
  const governing = result?.governing_direction ?? null

  return transects
    .map((transect) => toRow(transect, governing))
    .sort((a, b) => {
      const ba = a.bearing ?? Number.POSITIVE_INFINITY
      const bb = b.bearing ?? Number.POSITIVE_INFINITY
      if (ba !== bb) return ba - bb
      return String(a.id).localeCompare(String(b.id))
    })
}

// The governing (worst-side) row, or null if none is flagged.
export function governingRow(rows) {
  return rows.find((row) => row.isGoverning) ?? null
}

// True when the VLM could not identify vegetation in this side's photo (indoor,
// blurry, obstructed, no vegetation - class "cant_tell", or no read at all). The
// photo result must say so honestly rather than silently showing the map's
// fallback vegetation as if the photo had found it. Only meaningful in the photo
// (sharpened) views, where every side carries a photo_read.
export function photoUnreadable(side) {
  return !side?.photo_read || side.photo_read.class === 'cant_tell'
}

// Collapse the transects into one summary per compass side (N/E/S/W) - the way
// a Bushfire Assessment Report reads per aspect. Each side keeps its worst
// (governing) transect as the representative: highest BAL, ties broken by the
// closest distance. Sides read clockwise from north. The dense sampling still
// happens underneath; this is purely how the result is presented.
export function buildSideSummaries(result) {
  const rows = buildTransectRows(result)

  const groups = new Map()
  for (const row of rows) {
    const key = row.side || '—'
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(row)
  }

  const summaries = []
  for (const [side, group] of groups) {
    const representative = group.slice().sort((a, b) => {
      if (b.balSeverity !== a.balSeverity) return b.balSeverity - a.balSeverity
      return (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity)
    })[0]

    summaries.push({
      side,
      bearing: SECTOR_BEARING[side] ?? representative.bearing ?? Number.POSITIVE_INFINITY,
      representative, // the worst transect on this side - drives the card
      transectCount: group.length,
      hazardCount: group.filter((row) => row.hasHazard).length,
      requiresReview: group.some((row) => row.requiresReview),
      isGoverningSide: group.some((row) => row.isGoverning),
    })
  }

  return summaries.sort((a, b) => a.bearing - b.bearing)
}

// Case API (Phase 1, Step 3b-ii). Authenticated calls go through apiFetch so the
// Bearer access token is attached and a 401 triggers a single silent refresh +
// retry. createCase mirrors the current /assess inputs; the backend re-runs the
// SAME assessment server-side and saves it as a DRAFT case.

import { apiFetch } from './auth'
import { plog } from './debug'

// inputs: { address, boundaryPolygon?, fireDangerOverride?, slopeOverride? }
// Returns the created case (CaseRead, incl. id + status). Throws a friendly Error.
export async function createCase({ address, boundaryPolygon, fireDangerOverride, slopeOverride } = {}) {
  const body = { address }
  if (boundaryPolygon) body.boundary_polygon = boundaryPolygon
  if (fireDangerOverride != null) body.fire_danger_override = fireDangerOverride
  if (slopeOverride != null) body.slope_override = slopeOverride

  let response
  try {
    response = await apiFetch('/cases', { method: 'POST', body: JSON.stringify(body) })
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    throw new Error('We couldn’t start your analysis just now. Please try again.')
  }
  return response.json()
}

// Fetch one of the caller's cases by id (used for resume).
export async function getCase(caseId) {
  const response = await apiFetch(`/cases/${caseId}`)
  if (!response.ok) throw new Error('Case not found.')
  return response.json()
}

// Fetch a stored capture photo (JPEG) for a resumed case and return an object
// URL for an <img src>. Goes through apiFetch so the Bearer token is attached
// (you can't put a header on a plain <img>). Returns null if it isn't available.
// Remember to URL.revokeObjectURL(url) when you're done with it.
export async function getCasePhotoURL(caseId, direction) {
  const url = `/cases/${caseId}/photos/${encodeURIComponent(direction)}`
  try {
    const response = await apiFetch(url)
    plog('getCasePhotoURL', direction, '-> status', response.status, 'content-type', response.headers.get('content-type'))
    if (!response.ok) return null
    const blob = await response.blob()
    plog('getCasePhotoURL', direction, '-> blob type', blob.type, 'size', blob.size)
    const objUrl = URL.createObjectURL(blob)
    plog('getCasePhotoURL', direction, '-> objectURL', objUrl)
    return objUrl
  } catch (err) {
    plog('getCasePhotoURL', direction, '-> threw', err?.message)
    return null
  }
}

// The caller's cases, newest first (CaseSummary[]) for the dashboard.
export async function listCases() {
  let response
  try {
    response = await apiFetch('/cases')
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    throw new Error('We couldn’t load your properties just now. Please try again.')
  }
  return response.json()
}

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

// (Re)assess a drawn boundary on an EXISTING case in place (PUT). Used by the
// boundary edit/re-assess flow so an edited polygon updates the same case
// instead of inserting a duplicate. Returns the updated case (CaseRead, incl.
// boundary_assessment). Throws a friendly Error.
export async function updateCaseBoundary(
  caseId,
  { boundaryPolygon, fireDangerOverride, slopeOverride } = {},
) {
  const body = { boundary_polygon: boundaryPolygon }
  if (fireDangerOverride != null) body.fire_danger_override = fireDangerOverride
  if (slopeOverride != null) body.slope_override = slopeOverride

  let response
  try {
    response = await apiFetch(`/cases/${caseId}/boundary`, {
      method: 'PUT',
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('That property record has expired. Please start again.')
    throw new Error('We couldn’t assess your boundary just now. Please try again.')
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

// Upload one or more photos for a compass side on a case. Accepts an array of
// File objects. Returns the updated SectorEvidence for that side.
export async function uploadSectorPhotos(caseId, compassSide, files) {
  const formData = new FormData()
  for (const file of files) formData.append('files', file)

  let response
  try {
    response = await apiFetch(
      `/cases/${caseId}/sectors/${encodeURIComponent(compassSide)}/photos`,
      { method: 'POST', body: formData, headers: { 'Content-Type': undefined } },
    )
  } catch {
    throw new Error('We couldn’t upload your photos. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 413) throw new Error('Image is too large (max 10 MB).')
    if (response.status === 422) {
      const detail = await response.json().then(j => j.detail).catch(() => null)
      throw new Error(detail || 'Invalid file. Please upload a JPEG or PNG image.')
    }
    throw new Error('We couldn’t upload your photos. Please try again.')
  }
  return response.json()
}

// Fetch a stored sector photo and return an object URL for <img src>.
// photoRef can be a photo_id (uuid hex) or a 0-based integer index.
export async function getSectorPhotoURL(caseId, compassSide, photoRef) {
  const url = `/cases/${caseId}/sectors/${encodeURIComponent(compassSide)}/photos/${encodeURIComponent(photoRef)}`
  try {
    const response = await apiFetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    return URL.createObjectURL(blob)
  } catch {
    return null
  }
}

// Delete a sector photo by photo_id. Returns the updated side evidence.
export async function deleteSectorPhoto(caseId, compassSide, photoId) {
  const url = `/cases/${caseId}/sectors/${encodeURIComponent(compassSide)}/photos/${encodeURIComponent(photoId)}`
  let response
  try {
    response = await apiFetch(url, { method: 'DELETE' })
  } catch {
    throw new Error('Could not delete the photo. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('Photo not found.')
    throw new Error('Could not delete the photo. Please try again.')
  }
  return response.json()
}

// Set/merge a per-side override (vegetation_class, distance_m,
// effective_slope_degrees, slope_direction). Send only the fields you're
// changing - others keep their previous value. Returns
// { compass_side, overrides, combined_classification, review_flags, final_bal }.
export async function setSectorOverride(caseId, compassSide, fields) {
  const url = `/cases/${caseId}/sectors/${encodeURIComponent(compassSide)}/override`
  let response
  try {
    response = await apiFetch(url, { method: 'PUT', body: JSON.stringify(fields) })
  } catch {
    throw new Error('We couldn’t save your override. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 422) {
      const detail = await response.json().then(j => j.detail).catch(() => null)
      throw new Error(detail || 'Invalid override value.')
    }
    throw new Error('We couldn’t save your override. Please try again.')
  }
  return response.json()
}

// Reset a side's override back to photo-combined (if photos exist) else the
// GIS draft. Same response shape as setSectorOverride.
export async function clearSectorOverride(caseId, compassSide) {
  const url = `/cases/${caseId}/sectors/${encodeURIComponent(compassSide)}/override`
  let response
  try {
    response = await apiFetch(url, { method: 'DELETE' })
  } catch {
    throw new Error('We couldn’t reset this side. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    throw new Error('We couldn’t reset this side. Please try again.')
  }
  return response.json()
}

// Delete one of the caller's own cases (and its photos on the server). The
// backend ownership-checks and returns 204 on success. Throws a friendly Error
// otherwise (404 = already gone / not yours).
export async function deleteCase(caseId) {
  let response
  try {
    response = await apiFetch(`/cases/${caseId}`, { method: 'DELETE' })
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('That property no longer exists.')
    throw new Error('We couldn’t delete this property. Please try again.')
  }
}

// The approved assessors a consumer may choose for THIS case (Phase 4 —
// state-level match). Returns AssessorSearchResult[] (business name, accreditation
// level, availability). Empty list = none available for the case's state.
export async function listAssessorsForCase(caseId) {
  let response
  try {
    response = await apiFetch(`/cases/${caseId}/assessors`)
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('That property record has expired. Please start again.')
    throw new Error('We couldn’t load assessors just now. Please try again.')
  }
  return response.json()
}

// Submit a case to an accredited assessor (Phase 5). assessorId assigns the case
// to the chosen assessor; omit it to submit unassigned. Returns the updated case
// (CaseRead, incl. status SUBMITTED_TO_ASSESSOR + assigned_assessor_id).
export async function submitCase(caseId, assessorId) {
  const body = assessorId ? { assessor_id: assessorId } : {}
  let response
  try {
    response = await apiFetch(`/cases/${caseId}/submit`, { method: 'POST', body: JSON.stringify(body) })
  } catch {
    throw new Error('We couldn’t reach the server. Please try again.')
  }
  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 400) {
      const detail = await response.json().then((j) => j.detail).catch(() => null)
      throw new Error(typeof detail === 'string' ? detail : 'That assessor isn’t available. Please choose another.')
    }
    if (response.status === 409) throw new Error('This case is already with an assessor.')
    throw new Error('We couldn’t submit your case just now. Please try again.')
  }
  return response.json()
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

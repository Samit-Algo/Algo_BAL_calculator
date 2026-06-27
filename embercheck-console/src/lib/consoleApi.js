// Console API client — wraps /console/* (assessor-gated) on top of the auth
// layer's apiFetch (Bearer auto-attached + one silent refresh on 401).
import { apiFetch } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

export { login, loginWithGoogle, logout } from './auth'

// GET /console/me — the cheap gate check. Returns:
//   { ok: true, me }                     valid assessor token
//   { ok: false, reason: 'forbidden' }   logged in but role != assessor (403)
//   { ok: false, reason: 'unauthorized' }no/expired token (401)
export async function getMe() {
  const response = await apiFetch('/console/me')
  if (response.ok) return { ok: true, me: await response.json() }
  if (response.status === 403) return { ok: false, reason: 'forbidden' }
  if (response.status === 401) return { ok: false, reason: 'unauthorized' }
  return { ok: false, reason: 'error' }
}

// GET /console/worklist?state=<backend ui_state>. `state` is the backend's
// ui_state token (in-review / needs-photos / ready-to-sign / signed / refer) or
// null/undefined for "All". Throws on a non-OK response so the caller can show
// an error state.
export async function getWorklist(state) {
  const qs = state ? `?state=${encodeURIComponent(state)}` : ''
  const response = await apiFetch(`/console/worklist${qs}`)
  if (!response.ok) {
    const err = new Error('Could not load the worklist.')
    err.status = response.status
    throw err
  }
  return response.json()
}

// GET /console/cases/{id} — the full assessor case read (CONSOLE-B2). 404 (out
// of scope / unknown / not-yet-submitted) surfaces as a tagged error so the
// workspace can show "Case not available."
export async function getCase(caseId) {
  const response = await apiFetch(`/console/cases/${encodeURIComponent(caseId)}`)
  if (response.ok) return response.json()
  const err = new Error(response.status === 404 ? 'Case not available.' : 'Could not load this case.')
  err.status = response.status
  throw err
}

// Pull a clean message off a non-OK write response. The backend returns a 400
// with { detail: "<message>" } for validation errors (reason missing, bad
// vegetation class, …) — we surface that verbatim so it can show inline.
async function writeError(response) {
  let detail = null
  try {
    detail = (await response.json())?.detail
  } catch {
    /* non-JSON body — fall through to a generic message */
  }
  const err = new Error(detail || (response.status === 404 ? 'Case not available.' : 'That change could not be saved.'))
  err.status = response.status
  return err
}

// PUT /console/cases/{id}/sectors/{side}/confirm — mark a side reviewed. Returns
// { compass_side, sector, bal_rating, governing_direction, governing_compass_side }.
export async function confirmSector(caseId, compassSide) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/sectors/${encodeURIComponent(compassSide)}/confirm`
  const response = await apiFetch(path, { method: 'PUT' })
  if (response.ok) return response.json()
  throw await writeError(response)
}

// PUT /console/cases/{id}/sectors/{side}/override — apply an assessor override.
// `body` carries ONLY the changed fields plus the mandatory `reason`. Same
// response shape as confirm. A 400 (validation) is thrown with the backend
// message for inline display.
export async function overrideSector(caseId, compassSide, body) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/sectors/${encodeURIComponent(compassSide)}/override`
  const response = await apiFetch(path, { method: 'PUT', body: JSON.stringify(body) })
  if (response.ok) return response.json()
  throw await writeError(response)
}

// DELETE /console/cases/{id}/sectors/{side}/override — remove ONLY the assessor
// override, reverting the side to its calculated value. Same response shape as
// confirm/override. A 400 ("no override to remove") is thrown with the backend
// message for inline display.
export async function removeOverride(caseId, compassSide) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/sectors/${encodeURIComponent(compassSide)}/override`
  const response = await apiFetch(path, { method: 'DELETE' })
  if (response.ok) return response.json()
  throw await writeError(response)
}

// PUT /console/cases/{id}/status — move the case through the review lifecycle.
// `body` = { status, reason?, photo_request_sides? }. Returns the refreshed
// case-level review fields { status, ui_state, review_reason, photo_request_sides,
// can_ready_to_sign, ready_to_sign_blockers, audit }. A 400 (unknown status,
// missing reason, ready-to-sign blocked) is thrown with the backend message.
export async function updateStatus(caseId, body) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/status`
  const response = await apiFetch(path, { method: 'PUT', body: JSON.stringify(body) })
  if (response.ok) return response.json()
  throw await writeError(response)
}

// GET a sector photo's image bytes (assessor-gated) and return an object URL the
// <img> can use. The Bearer token must be attached, so we fetch via apiFetch and
// wrap the blob — a plain <img src> can't carry the Authorization header. Returns
// null if the photo is missing/forbidden (the caller falls back to a placeholder).
export async function getSectorPhoto(caseId, compassSide, photoId) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/sectors/${encodeURIComponent(compassSide)}/photos/${encodeURIComponent(photoId)}`
  const response = await apiFetch(path)
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

// POST /console/cases/{id}/sign — sign and issue the determination. `attestation`
// must be true. Returns the refreshed case-status bundle plus `signoff`
// { report_number, signed_at, assessor_name, bal_rating, ... }. A 400/409/422
// (not ready / already signed / not attested) is thrown with the backend message.
export async function signCase(caseId, { attestation } = {}) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/sign`
  const response = await apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({ attestation: !!attestation }),
  })
  if (response.ok) return response.json()
  throw await writeError(response)
}

// GET /console/cases/{id}/report — fetch the signed PDF (Bearer) and return an
// object URL the browser can open/download. Returns null if not signed/forbidden.
export async function getCaseReport(caseId) {
  const path = `/console/cases/${encodeURIComponent(caseId)}/report`
  const response = await apiFetch(path)
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

export { API_BASE }

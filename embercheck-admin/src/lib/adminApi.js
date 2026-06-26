// Admin API client — wraps /admin/* (admin-gated) on top of the auth layer's
// apiFetch (Bearer auto-attached + one silent refresh on 401).
import { apiFetch } from './auth'

export { login, logout } from './auth'

// GET /admin/me — the gate check. { ok, me } | { ok:false, reason }.
export async function getMe() {
  const response = await apiFetch('/admin/me')
  if (response.ok) return { ok: true, me: await response.json() }
  if (response.status === 403) return { ok: false, reason: 'forbidden' }
  if (response.status === 401) return { ok: false, reason: 'unauthorized' }
  return { ok: false, reason: 'error' }
}

// GET /admin/applications?status_filter=... — the queue.
export async function listApplications(statusFilter) {
  const qs = statusFilter ? `?status_filter=${encodeURIComponent(statusFilter)}` : ''
  const response = await apiFetch(`/admin/applications${qs}`)
  if (!response.ok) throw new Error('Could not load applications.')
  return response.json()
}

// GET /admin/applications/{id} — full detail.
export async function getApplication(id) {
  const response = await apiFetch(`/admin/applications/${encodeURIComponent(id)}`)
  if (!response.ok) throw new Error(response.status === 404 ? 'Application not found.' : 'Could not load this application.')
  return response.json()
}

// GET a document's bytes (admin-gated) and return an object URL for viewing.
// The Bearer token must be attached, so we fetch via apiFetch and wrap the blob.
export async function getDocumentURL(id, index) {
  const response = await apiFetch(`/admin/applications/${encodeURIComponent(id)}/documents/${index}`)
  if (!response.ok) return null
  const blob = await response.blob()
  return URL.createObjectURL(blob)
}

async function action(id, name, reason) {
  const body = reason != null ? JSON.stringify({ reason }) : JSON.stringify({})
  const response = await apiFetch(`/admin/applications/${encodeURIComponent(id)}/${name}`, {
    method: 'POST',
    body,
  })
  if (response.ok) return response.json()
  let detail = null
  try { detail = (await response.json())?.detail } catch { /* non-JSON */ }
  const err = new Error(typeof detail === 'string' ? detail : 'That action could not be completed.')
  err.status = response.status
  throw err
}

export const approve = (id, reason) => action(id, 'approve', reason)
export const reactivate = (id, reason) => action(id, 'reactivate', reason)
export const deactivate = (id, reason) => action(id, 'deactivate', reason)
export const reject = (id, reason) => action(id, 'reject', reason)
export const suspend = (id, reason) => action(id, 'suspend', reason)
export const requestInfo = (id, reason) => action(id, 'request-info', reason)

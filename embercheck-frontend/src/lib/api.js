// Thin wrapper around the EmberCheck backend's /assess endpoint.
//
// Base URL is env-driven: empty in dev (so paths stay relative and the Vite
// proxy forwards them to the local backend), and set to the public API URL in
// production via VITE_API_BASE_URL.
import { apiFetch } from './auth'

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''

// overrides: optional { fireDanger: 50|80|100, slope: number } - either or
// both may be omitted/null to let the backend work them out automatically.
export async function assess(address, overrides = {}, sitePolygon = null) {
  const body = { address }
  if (overrides.fireDanger != null) {
    body.fire_danger_override = overrides.fireDanger
  }
  if (overrides.slope != null) {
    body.slope_override = overrides.slope
  }
  if (sitePolygon) body.site_polygon = sitePolygon

  let response
  try {
    response = await fetch(`${API_BASE}/assess`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    // Network error / backend not reachable.
    throw new Error('Something went wrong, please try again.')
  }

  if (!response.ok) {
    if (response.status === 404) {
      throw new Error('Address not found')
    }
    if (response.status === 400) {
      throw new Error('Address appears to be outside NSW')
    }
    throw new Error('Something went wrong, please try again.')
  }

  return response.json()
}

// Streaming variant of assess(): POSTs to /assess/stream and reads Server-Sent
// Events, calling onProgress(event) for each pipeline stage as it happens.
// Resolves with the final result, or throws with the backend's error message.
//
// sitePolygon (optional): a GeoJSON Polygon (WGS84) the user drew on the map.
// When given, the backend measures vegetation from the boundary edge and returns
// per-transect results; when omitted, the normal point assessment runs.
export async function assessStream(address, overrides = {}, onProgress, sitePolygon = null) {
  const body = { address }
  if (overrides.fireDanger != null) body.fire_danger_override = overrides.fireDanger
  if (overrides.slope != null) body.slope_override = overrides.slope
  if (sitePolygon) body.site_polygon = sitePolygon

  let response
  try {
    response = await fetch(`${API_BASE}/assess/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('Something went wrong, please try again.')
  }

  if (!response.ok || !response.body) {
    throw new Error('Something went wrong, please try again.')
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let result = null
  let errorMessage = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    // SSE messages are separated by a blank line.
    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      const dataLine = block.split('\n').find((l) => l.startsWith('data:'))
      if (!dataLine) continue
      let event
      try {
        event = JSON.parse(dataLine.slice(5).trim())
      } catch {
        continue
      }
      if (event.type === 'progress') onProgress?.(event)
      else if (event.type === 'result') result = event.data
      else if (event.type === 'error') errorMessage = event.detail
    }
  }

  if (errorMessage) throw new Error(errorMessage)
  if (!result) throw new Error('Something went wrong, please try again.')
  return result
}

// Downscale a JPEG data URL so its long edge is at most maxEdge px, re-encoding
// as JPEG. The VLM doesn't need full resolution, and full-res photos make the
// /assess/photos payload large. Returns the original URL unchanged if it's
// already small enough or can't be decoded.
function downscaleDataURL(dataURL, maxEdge = 1600, quality = 0.82) {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      const longEdge = Math.max(img.width, img.height)
      if (!longEdge || longEdge <= maxEdge) {
        resolve(dataURL)
        return
      }
      const scale = maxEdge / longEdge
      const canvas = document.createElement('canvas')
      canvas.width = Math.round(img.width * scale)
      canvas.height = Math.round(img.height * scale)
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }
    img.onerror = () => resolve(dataURL)
    img.src = dataURL
  })
}

// Send the four capture photos to /assess/photos for the active case and return
// the FULL sharpened assessment (overall BAL, governing direction, per_direction
// with class_source + review flags, and the raw VLM read per side). This is now
// login-only and case-bound: it goes through apiFetch (Bearer auto-attached +
// silent refresh) and carries the active case_id. Photos are downscaled before
// upload. Throws a friendly Error on failure; the caller keeps the captured
// photos so the user can retry.
export async function assessPhotos(context, photos, caseId) {
  const scaledPhotos = await Promise.all(
    photos.map(async (p) => ({ ...p, image: await downscaleDataURL(p.image) })),
  )

  const body = { case_id: caseId, photos: scaledPhotos }
  if (context.address) body.address = context.address
  if (context.latitude != null) body.latitude = context.latitude
  if (context.longitude != null) body.longitude = context.longitude
  if (context.overrides?.fireDanger != null) body.fire_danger_override = context.overrides.fireDanger
  if (context.overrides?.slope != null) body.slope_override = context.overrides.slope

  let response
  try {
    response = await apiFetch('/assess/photos', {
      method: 'POST',
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('We couldn’t reach the server. Check your connection and try again.')
  }

  if (!response.ok) {
    if (response.status === 401) throw new Error('Please log in to continue.')
    if (response.status === 404) throw new Error('That analysis session has expired. Please start again.')
    throw new Error('We couldn’t read your photos just now. Please try again.')
  }
  return response.json()
}

// Recompute the BAL from known per-direction inputs plus manual overrides
// (distance, slope, vegetation type per side; FDI globally). Stateless and
// instant - no map scan. Passing empty overrides reproduces the original
// result, which is how "reset to the map calculation" works.
export async function recalculateBal({ fireDanger, fireDangerOverride, perDirection, overrides }) {
  const body = {
    fire_danger_index: fireDanger,
    fire_danger_override: fireDangerOverride ?? null,
    per_direction: perDirection,
    overrides: overrides || {},
  }
  let response
  try {
    response = await fetch(`${API_BASE}/assess/recalculate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('We couldn’t recalculate just now. Please try again.')
  }
  if (!response.ok) {
    throw new Error('We couldn’t recalculate just now. Please try again.')
  }
  return response.json()
}

// Address autocomplete suggestions for the given partial text. Returns an
// empty list on any error so the typing experience never breaks.
export async function suggest(q) {
  try {
    const response = await fetch(
      `${API_BASE}/suggest?q=${encodeURIComponent(q)}`,
    )
    if (!response.ok) {
      return []
    }
    const data = await response.json()
    return Array.isArray(data) ? data : []
  } catch {
    return []
  }
}

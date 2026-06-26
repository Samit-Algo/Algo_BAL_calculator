// Auth + token layer for the EmberCheck Console (copied, trimmed, from the
// consumer app's lib/auth.js — duplication is intentional; no shared package).
//
// Token policy (Bearer, not cookies):
//   - ACCESS token lives in MEMORY ONLY (module-level), never in localStorage.
//   - REFRESH token lives in localStorage so a reload can re-authenticate.
// Login and refresh both return a NEW access + refresh pair (the refresh token
// rotates on every use); we always store both. apiFetch() transparently
// refreshes once on a 401 and retries.

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const REFRESH_STORAGE_KEY = 'embercheck_console.refresh_token'

let accessToken = null // memory only — intentionally NOT persisted
const logoutListeners = new Set()

export function getAccessToken() {
  return accessToken
}

export function getRefreshToken() {
  try {
    return localStorage.getItem(REFRESH_STORAGE_KEY)
  } catch {
    return null
  }
}

export function setTokens({ access_token, refresh_token } = {}) {
  if (access_token !== undefined) accessToken = access_token
  if (refresh_token) {
    try {
      localStorage.setItem(REFRESH_STORAGE_KEY, refresh_token)
    } catch {
      /* storage unavailable — refresh just won't survive a reload */
    }
  }
}

export function clearTokens() {
  accessToken = null
  try {
    localStorage.removeItem(REFRESH_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function onForcedLogout(callback) {
  logoutListeners.add(callback)
  return () => logoutListeners.delete(callback)
}

function signalForcedLogout() {
  logoutListeners.forEach((cb) => {
    try {
      cb()
    } catch {
      /* a listener throwing must not break the others */
    }
  })
}

// --- core fetch + silent refresh ---------------------------------------------

let refreshInFlight = null

function buildHeaders(extra, withAuth) {
  const headers = { 'Content-Type': 'application/json', ...(extra || {}) }
  for (const key of Object.keys(headers)) {
    if (headers[key] === undefined) delete headers[key]
  }
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

function ensureRefreshed() {
  if (!refreshInFlight) {
    refreshInFlight = performRefresh().finally(() => {
      refreshInFlight = null
    })
  }
  return refreshInFlight
}

async function performRefresh() {
  const refresh_token = getRefreshToken()
  if (!refresh_token) return false
  let response
  try {
    response = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token }),
    })
  } catch {
    return false
  }
  if (!response.ok) return false
  setTokens(await response.json())
  return true
}

// Authenticated fetch with one transparent refresh-and-retry on 401. Returns the
// raw Response. On a refresh failure it clears tokens, signals logout, and
// returns the original 401.
export async function apiFetch(path, options = {}) {
  const doFetch = () =>
    fetch(`${API_BASE}${path}`, {
      ...options,
      headers: buildHeaders(options.headers, true),
    })

  let response = await doFetch()
  if (response.status !== 401) return response

  const refreshed = await ensureRefreshed()
  if (!refreshed) {
    clearTokens()
    signalForcedLogout()
    return response
  }
  return doFetch()
}

// --- auth endpoints (bypass the refresh interceptor) -------------------------

export async function login(email, password) {
  let response
  try {
    response = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    })
  } catch {
    throw new Error('We couldn’t reach the server. Check your connection and try again.')
  }
  if (!response.ok) {
    const err = new Error(
      response.status === 400
        ? 'Email or password is incorrect.'
        : 'Something went wrong signing in. Please try again.',
    )
    err.status = response.status
    throw err
  }
  const tokens = await response.json()
  setTokens(tokens)
  return tokens
}

export async function logout() {
  const refresh_token = getRefreshToken()
  try {
    if (refresh_token) {
      await fetch(`${API_BASE}/auth/logout`, {
        method: 'POST',
        headers: buildHeaders(null, true),
        body: JSON.stringify({ refresh_token }),
      })
    }
  } catch {
    /* best-effort — we clear locally either way */
  }
  clearTokens()
}

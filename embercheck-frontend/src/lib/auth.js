// Auth + token layer for EmberCheck consumer accounts (Phase 1, Step 3b-i).
//
// Token policy (our Bearer-not-cookies choice):
//   - ACCESS token lives in MEMORY ONLY (module-level variable). Never touches
//     localStorage, so it can't be lifted from disk/XSS-persisted storage.
//   - REFRESH token lives in localStorage so a reload can re-authenticate.
// Login and refresh both return a NEW access + refresh pair (the refresh token
// rotates on every use) — we always store both.
//
// apiFetch() transparently refreshes a single time on a 401 and retries; the
// auth endpoints (login/register/refresh) bypass that interceptor so there's no
// refresh-on-refresh loop.

const API_BASE = import.meta.env.VITE_API_BASE_URL || ''
const REFRESH_STORAGE_KEY = 'embercheck.refresh_token'

// --- token state -------------------------------------------------------------

let accessToken = null // memory only — intentionally NOT persisted
const logoutListeners = new Set() // notified when a silent refresh fails

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

// Store the rotated pair returned by login/refresh. Access -> memory, refresh ->
// localStorage. Missing fields are left as-is.
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

// Wipe both memory and localStorage (logout, or a dead refresh token).
export function clearTokens() {
  accessToken = null
  try {
    localStorage.removeItem(REFRESH_STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

// Subscribe to "forced logout" (a silent refresh failed). Returns an
// unsubscribe fn. AuthContext uses this to drop the user from the UI.
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

// --- friendly error mapping --------------------------------------------------

// The backend uses fastapi-users error codes (string detail) or, for an invalid
// password, an object { code, reason }. Map them to messages the modal can show.
function messageForDetail(detail, status) {
  let code = null
  let reason = null
  if (typeof detail === 'string') code = detail
  else if (detail && typeof detail === 'object') {
    code = detail.code
    reason = detail.reason
  }

  switch (code) {
    case 'LOGIN_BAD_CREDENTIALS':
    case 'LOGIN_USER_NOT_VERIFIED':
      return 'Email or password is incorrect.'
    case 'REGISTER_USER_ALREADY_EXISTS':
      return 'An account with this email already exists.'
    case 'REGISTER_INVALID_PASSWORD':
      return reason || 'Password must be at least 8 characters.'
    case 'GOOGLE_AUTH_NOT_CONFIGURED':
      return 'Google sign-in is not configured yet.'
    case 'INVALID_GOOGLE_TOKEN':
    case 'GOOGLE_EMAIL_NOT_VERIFIED':
      return 'Google sign-in could not be verified.'
    default:
      if (status === 422) return 'Please enter a valid email and password.'
      return 'Something went wrong. Please try again.'
  }
}

async function errorFromResponse(response) {
  let detail = null
  try {
    detail = (await response.json()).detail
  } catch {
    /* no JSON body */
  }
  const error = new Error(messageForDetail(detail, response.status))
  error.status = response.status
  return error
}

// --- core fetch + silent refresh ---------------------------------------------

let refreshInFlight = null // a single shared refresh promise for concurrent 401s

function buildHeaders(extra, withAuth) {
  const headers = { 'Content-Type': 'application/json', ...(extra || {}) }
  // Allow callers to omit Content-Type (e.g. for FormData uploads where the
  // browser must set the multipart boundary automatically).
  for (const key of Object.keys(headers)) {
    if (headers[key] === undefined) delete headers[key]
  }
  if (withAuth && accessToken) headers.Authorization = `Bearer ${accessToken}`
  return headers
}

// Attempt one token refresh. Concurrent callers share the same promise so only
// ONE /auth/refresh runs even if several requests 401 at once. Resolves true on
// success (tokens stored), false otherwise.
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
// raw Response (callers decide how to read it). On a refresh failure it clears
// tokens, signals logout, and returns the original 401 response.
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

async function authPost(path, body, withAuth = false) {
  let response
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: buildHeaders(null, withAuth),
      body: JSON.stringify(body),
    })
  } catch {
    throw new Error('We couldn’t reach the server. Check your connection and try again.')
  }
  return response
}

// Create an account. Returns the new user (no tokens — caller then logs in).
export async function register(email, password, name) {
  const response = await authPost('/auth/register', {
    email,
    password,
    name: name || null,
  })
  if (!response.ok) throw await errorFromResponse(response)
  return response.json()
}

// Log in; stores the rotated access + refresh pair. Returns the token payload.
export async function login(email, password) {
  const response = await authPost('/auth/login', { email, password })
  if (!response.ok) throw await errorFromResponse(response)
  const tokens = await response.json()
  setTokens(tokens)
  return tokens
}

// Exchange a Google Identity Services ID token for EmberCheck app tokens.
export async function loginWithGoogle(idToken) {
  const response = await authPost('/auth/google', { id_token: idToken })
  if (!response.ok) throw await errorFromResponse(response)
  const tokens = await response.json()
  setTokens(tokens)
  return tokens
}

// Manually refresh (used by AuthContext on app load). Throws on failure.
export async function refresh() {
  const ok = await ensureRefreshed()
  if (!ok) {
    clearTokens()
    throw new Error('Session expired.')
  }
  return true
}

// Revoke the refresh token server-side, then clear locally REGARDLESS of whether
// that call succeeded (logout must always log you out on this device).
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

// Fetch the current user (protected — goes through the refresh interceptor).
export async function getMe() {
  const response = await apiFetch('/users/me')
  if (!response.ok) throw await errorFromResponse(response)
  return response.json()
}

// Auth state for the app (Phase 1, Step 3b-i / 3b-ii).
//
// Exposes the current user (or null), a status (bootstrapping | ready), and the
// login / signup / logout actions. On mount it tries to restore a session from
// the stored refresh token (refresh -> getMe). It also mirrors the api layer's
// "forced logout" signal so a dead session drops the user from the UI.
//
// 3b-ii: the provider owns the login modal so any feature can demand auth via
// ensureAuthenticated() (resolves true on login, false if the user cancels).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import * as auth from '../lib/auth'
import AuthModal from './AuthModal'

const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [status, setStatus] = useState('bootstrapping') // 'bootstrapping' | 'ready'
  // The shared login modal + the pending ensureAuthenticated() resolver (if a
  // gate is waiting on this open).
  const [modalOpen, setModalOpen] = useState(false)
  const pendingResolve = useRef(null)

  // Restore a session on load: if a refresh token survived in localStorage, try
  // to refresh + fetch the user; otherwise we're simply logged out.
  useEffect(() => {
    let cancelled = false
    async function bootstrap() {
      if (!auth.getRefreshToken()) {
        if (!cancelled) setStatus('ready')
        return
      }
      try {
        await auth.refresh()
        const me = await auth.getMe()
        if (!cancelled) setUser(me)
      } catch {
        auth.clearTokens()
      } finally {
        if (!cancelled) setStatus('ready')
      }
    }
    bootstrap()
    return () => {
      cancelled = true
    }
  }, [])

  // A failed silent refresh (mid-session) clears tokens in the api layer; drop
  // the user here so the UI flips to logged-out.
  useEffect(() => auth.onForcedLogout(() => setUser(null)), [])

  const login = useCallback(async (email, password) => {
    await auth.login(email, password)
    const me = await auth.getMe()
    setUser(me)
    return me
  }, [])

  // Register doesn't return tokens, so log in immediately after to get them.
  const signup = useCallback(async (email, password, name) => {
    await auth.register(email, password, name)
    await auth.login(email, password)
    const me = await auth.getMe()
    setUser(me)
    return me
  }, [])

  const logout = useCallback(async () => {
    await auth.logout()
    setUser(null)
  }, [])

  // Re-fetch the current user (handy for exercising silent refresh).
  const refreshUser = useCallback(async () => {
    const me = await auth.getMe()
    setUser(me)
    return me
  }, [])

  // Open the login modal as a plain action (e.g. the header "Log in" button) -
  // no gate is waiting on the result.
  const openAuthModal = useCallback(() => {
    pendingResolve.current = null
    setModalOpen(true)
  }, [])

  // Demand auth. Resolves immediately if already logged in; otherwise opens the
  // modal and resolves true on a successful login / false if the user cancels.
  const ensureAuthenticated = useCallback(() => {
    if (user) return Promise.resolve(true)
    return new Promise((resolve) => {
      pendingResolve.current = resolve
      setModalOpen(true)
    })
  }, [user])

  function settlePending(outcome) {
    setModalOpen(false)
    if (pendingResolve.current) {
      pendingResolve.current(outcome)
      pendingResolve.current = null
    }
  }

  const value = {
    user,
    status,
    login,
    signup,
    logout,
    refreshUser,
    openAuthModal,
    ensureAuthenticated,
  }
  return (
    <AuthContext.Provider value={value}>
      {children}
      {modalOpen && (
        <AuthModal
          onSuccess={() => settlePending(true)}
          onCancel={() => settlePending(false)}
        />
      )}
    </AuthContext.Provider>
  )
}

// The provider and its hook conventionally live together; fast refresh isn't
// affected here, so this rule is intentionally relaxed for this one export.
// eslint-disable-next-line react-refresh/only-export-components
export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider')
  return ctx
}

// Admin app shell: login → admin gate (GET /admin/me) → queue / detail.
//
// Gate: after a token exists, GET /admin/me decides —
//   role admin (200) → app; 403 → "admins only" + sign out; 401 → login.
import { useCallback, useEffect, useState } from 'react'
import { getMe, logout } from './lib/adminApi'
import { getRefreshToken, onForcedLogout } from './lib/auth'
import { LoginScreen } from './screens/LoginScreen'
import { QueueScreen } from './screens/QueueScreen'
import { DetailScreen } from './screens/DetailScreen'

const DENIED_MESSAGE = 'This area is for EmberCheck administrators only.'

function parseHash() {
  const m = (window.location.hash || '').match(/^#\/application\/(.+)$/)
  return m ? { name: 'detail', id: decodeURIComponent(m[1]) } : { name: 'queue' }
}

export default function App() {
  const [phase, setPhase] = useState(() => (getRefreshToken() ? 'checking' : 'login'))
  const [me, setMe] = useState(null)
  const [route, setRoute] = useState(parseHash)

  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])

  const resolveGate = useCallback(async () => {
    const result = await getMe()
    if (result.ok && result.me.role === 'admin') {
      setMe(result.me)
      setPhase('app')
    } else if (result.reason === 'forbidden') {
      setPhase('denied')
    } else {
      setPhase('login')
    }
  }, [])

  useEffect(() => {
    if (!getRefreshToken()) return
    let cancelled = false
    getMe().then((result) => {
      if (cancelled) return
      if (result.ok && result.me.role === 'admin') {
        setMe(result.me)
        setPhase('app')
      } else if (result.reason === 'forbidden') {
        setPhase('denied')
      } else {
        setPhase('login')
      }
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => onForcedLogout(() => setPhase('login')), [])

  const navigate = useCallback((hash) => { window.location.hash = hash }, [])

  const signOut = useCallback(async () => {
    await logout()
    setMe(null)
    navigate('')
    setPhase('login')
  }, [navigate])

  if (phase === 'checking') {
    return <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)' }}>Loading…</div>
  }
  if (phase === 'login') return <LoginScreen onAuthed={resolveGate} />
  if (phase === 'denied') return <LoginScreen notice={DENIED_MESSAGE} onAuthed={resolveGate} />

  // phase === 'app'
  return (
    <div style={{ minHeight: '100vh' }}>
      <Header me={me} onHome={() => navigate('')} onSignOut={signOut} />
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '24px 20px 64px' }}>
        {route.name === 'detail' ? (
          <DetailScreen id={route.id} onBack={() => navigate('')} />
        ) : (
          <QueueScreen onOpen={(id) => navigate(`#/application/${encodeURIComponent(id)}`)} />
        )}
      </main>
    </div>
  )
}

function Header({ me, onHome, onSignOut }) {
  return (
    <header style={{ borderBottom: '1px solid var(--line)', background: 'color-mix(in oklab, var(--paper) 90%, transparent)' }}>
      <div style={{ maxWidth: 980, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button onClick={onHome} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--ink)' }}>EmberCheck</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ochre)' }}>Admin</span>
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{me?.email}</span>
          <button className="a-btn a-btn-quiet" onClick={onSignOut} style={{ minHeight: 32, fontSize: 13 }}>Sign out</button>
        </div>
      </div>
    </header>
  )
}

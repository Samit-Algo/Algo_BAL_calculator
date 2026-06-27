// Admin app shell: login → admin gate (GET /admin/me) → queue / detail.
//
// Gate: after a token exists, GET /admin/me decides —
//   role admin (200) → app; 403 → "admins only" + sign out; 401 → login.
import { useCallback, useEffect, useState } from 'react'
import { getMe, logout } from './lib/adminApi'
import { getRefreshToken, onForcedLogout } from './lib/auth'
import { LoginScreen } from './screens/LoginScreen'
import { OverviewScreen } from './screens/OverviewScreen'
import { QueueScreen } from './screens/QueueScreen'
import { DetailScreen } from './screens/DetailScreen'

const DENIED_MESSAGE = 'This area is for EmberCheck administrators only.'

function parseHash() {
  const hash = window.location.hash || ''
  const m = hash.match(/^#\/application\/(.+)$/)
  if (m) return { name: 'detail', id: decodeURIComponent(m[1]) }
  if (hash.startsWith('#/applications')) return { name: 'queue' }
  return { name: 'overview' }
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
  // The Overview dashboard is a wider canvas (charts/map) than the application
  // review screens, so it gets a roomier max-width.
  const wide = route.name === 'overview'
  return (
    <div style={{ minHeight: '100vh' }}>
      <Header me={me} route={route} onNavigate={navigate} onSignOut={signOut} />
      <main style={{ maxWidth: wide ? 1180 : 980, margin: '0 auto', padding: '24px 20px 64px' }}>
        {route.name === 'detail' ? (
          <DetailScreen id={route.id} onBack={() => navigate('#/applications')} />
        ) : route.name === 'queue' ? (
          <QueueScreen onOpen={(id) => navigate(`#/application/${encodeURIComponent(id)}`)} />
        ) : (
          <OverviewScreen onNavigate={navigate} />
        )}
      </main>
    </div>
  )
}

// The two top-level admin tabs. `detail` is a drill-down of the queue, so it
// keeps the Applications tab highlighted.
const TABS = [
  { key: 'overview', label: 'Overview', hash: '' },
  { key: 'queue', label: 'Applications', hash: '#/applications' },
]

function Header({ me, route, onNavigate, onSignOut }) {
  const active = route.name === 'detail' ? 'queue' : route.name
  return (
    <header style={{ borderBottom: '1px solid var(--line)', background: 'color-mix(in oklab, var(--paper) 90%, transparent)' }}>
      <div style={{ maxWidth: 1180, margin: '0 auto', padding: '14px 20px', display: 'flex', alignItems: 'center', gap: 20, flexWrap: 'wrap' }}>
        <button onClick={() => onNavigate('')} style={{ border: 'none', background: 'none', cursor: 'pointer', display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--ink)' }}>EmberCheck</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ochre)' }}>Admin</span>
        </button>
        <nav style={{ display: 'flex', gap: 6 }}>
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => onNavigate(t.hash)}
              className="a-pill"
              style={{
                cursor: 'pointer',
                border: active === t.key ? '1.5px solid var(--euc-deep)' : '1.5px solid transparent',
                background: active === t.key ? 'color-mix(in oklab, var(--euc-deep) 12%, var(--card))' : 'transparent',
                color: active === t.key ? 'var(--euc-deep)' : 'var(--ink-soft)',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginLeft: 'auto' }}>
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{me?.email}</span>
          <button className="a-btn a-btn-quiet" onClick={onSignOut} style={{ minHeight: 32, fontSize: 13 }}>Sign out</button>
        </div>
      </div>
    </header>
  )
}

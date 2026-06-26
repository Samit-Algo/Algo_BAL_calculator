// Console app shell: login → assessor gate → worklist / job placeholder.
//
// Gate (per CONSOLE-F1): after a token exists, GET /console/me decides —
//   role assessor (200) → worklist; 403 → "assessors only" + sign out;
//   401 / no token     → login.
import { useCallback, useEffect, useRef, useState } from 'react'
import { getMe, logout } from './lib/consoleApi'
import { getRefreshToken, onForcedLogout } from './lib/auth'
import { Chrome } from './components/Chrome'
import { LoginScreen } from './screens/LoginScreen'
import { WorklistScreen } from './screens/WorklistScreen'
import { WorkspaceScreen } from './screens/WorkspaceScreen'

const DENIED_MESSAGE = 'This console is for accredited assessors only.'

// --- tiny hash router --------------------------------------------------------

function parseHash() {
  const m = (window.location.hash || '').match(/^#\/job\/(.+)$/)
  return m ? { name: 'job', id: decodeURIComponent(m[1]) } : { name: 'worklist' }
}

function useHashRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const onChange = () => setRoute(parseHash())
    window.addEventListener('hashchange', onChange)
    return () => window.removeEventListener('hashchange', onChange)
  }, [])
  const navigate = useCallback((hash) => {
    window.location.hash = hash
  }, [])
  return [route, navigate]
}

export default function App() {
  // 'checking' | 'login' | 'denied' | 'app'. Seed from whether a refresh token
  // even exists, so the mount effect never has to setState synchronously.
  const [phase, setPhase] = useState(() => (getRefreshToken() ? 'checking' : 'login'))
  const [me, setMe] = useState(null)
  const [route, navigate] = useHashRoute()
  const [selectedJob, setSelectedJob] = useState(null) // last-clicked worklist row
  const [jobTitle, setJobTitle] = useState(null) // address the workspace reports up

  // Resolve the gate from /console/me; used by the post-login path (an event
  // handler, so setState here is fine). The mount effect below inlines the same
  // logic but keeps every setState inside the async callback.
  const resolveGate = useCallback(async () => {
    const result = await getMe()
    if (result.ok && result.me.role === 'assessor') {
      setMe(result.me)
      setPhase('app')
    } else if (result.reason === 'forbidden') {
      setPhase('denied')
    } else {
      setPhase('login')
    }
  }, [])

  // On load: probe the gate only if a refresh token might let us in. setState
  // happens solely in the async .then callback (never synchronously here).
  useEffect(() => {
    if (!getRefreshToken()) return
    let cancelled = false
    getMe().then((result) => {
      if (cancelled) return
      if (result.ok && result.me.role === 'assessor') {
        setMe(result.me)
        setPhase('app')
      } else if (result.reason === 'forbidden') {
        setPhase('denied')
      } else {
        setPhase('login')
      }
    })
    return () => {
      cancelled = true
    }
  }, [])

  // A failed silent refresh inside apiFetch forces us back to login.
  useEffect(() => onForcedLogout(() => setPhase('login')), [])

  const signOut = useCallback(async () => {
    await logout()
    setMe(null)
    navigate('')
    setPhase('login')
  }, [navigate])

  const openJob = useCallback(
    (jobOrId) => {
      const id = typeof jobOrId === 'string' ? jobOrId : jobOrId.id
      if (typeof jobOrId === 'object') setSelectedJob(jobOrId)
      navigate(`#/job/${encodeURIComponent(id)}`)
    },
    [navigate],
  )

  // A lightweight toast (the mockup's not-wired affordances point here).
  const [toastMsg, setToastMsg] = useState(null)
  const toastTimer = useRef()
  const toast = useCallback((msg) => {
    setToastMsg(msg)
    clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToastMsg(null), 3000)
  }, [])

  if (phase === 'checking') {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
        Loading…
      </div>
    )
  }

  if (phase === 'login') {
    return <LoginScreen onAuthed={resolveGate} />
  }

  if (phase === 'denied') {
    return <LoginScreen notice={DENIED_MESSAGE} onAuthed={resolveGate} />
  }

  // phase === 'app'
  const onJob = route.name === 'job'
  const job = onJob && selectedJob && selectedJob.id === route.id ? selectedJob : null
  // Breadcrumb: prefer the clicked row's address, else the address the workspace
  // reports once it loads (so a hard refresh on #/job/<id> still shows it).
  const breadcrumb = onJob ? job?.address || jobTitle || `Job ${route.id}` : null

  return (
    <>
      <Chrome me={me} breadcrumb={breadcrumb} onHome={() => navigate('')} onSignOut={signOut} fill={onJob}>
        {onJob ? (
          <WorkspaceScreen caseId={route.id} onTitle={setJobTitle} me={me} />
        ) : (
          <WorklistScreen onOpenJob={openJob} toast={toast} />
        )}
      </Chrome>

      <div
        style={{
          position: 'fixed',
          right: 18,
          bottom: 18,
          zIndex: 200,
          maxWidth: 380,
          opacity: toastMsg ? 1 : 0,
          transform: toastMsg ? 'none' : 'translateY(8px)',
          transition: 'opacity .3s ease, transform .3s ease',
          pointerEvents: 'none',
        }}
      >
        <div style={{ padding: '11px 16px', borderRadius: 10, background: 'var(--ink)', color: 'var(--paper)', fontSize: 12.5, fontWeight: 600, lineHeight: 1.45, boxShadow: '0 10px 30px rgba(40,36,24,0.3)' }}>
          {toastMsg || ''}
        </div>
      </div>
    </>
  )
}

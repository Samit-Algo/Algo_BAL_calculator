import { useState, useRef, useEffect } from 'react'
import EntryHero from './components/EntryHero'
import AppHeader from './components/AppHeader'
import Dashboard from './components/Dashboard'
import AssessmentMap from './components/AssessmentMap'
import ResultPanel from './components/ResultPanel'
import DrivingFactors from './components/DrivingFactors'
import BoundaryStepCard from './components/BoundaryStepCard'
import NextStepCard from './components/NextStepCard'
import LoadingState from './components/LoadingState'
import ContourField from './components/ui/ContourField'
import Glyph from './components/ui/Glyph'
import Reveal from './components/ui/Reveal'
import { ECCard, ECEyebrow } from './components/ui/ECCard'
import { assessStream } from './lib/api'
import { getCase, getCasePhotoURL, createCase } from './lib/cases'
import { caseHasBoundary, boundaryPolygonFromCase } from './lib/boundary'
import { worstBalRating } from './lib/ec'
import { getRefreshToken } from './lib/auth'
import { useAuth } from './auth/AuthContext'
import { plog } from './lib/debug'

const NO_OVERRIDES = { fireDanger: null, slope: null }

// Parse the URL hash into a view intent so a reload restores where you were.
// '#/dashboard' -> dashboard; '#/cases/<id>' -> resume that case; else entry.
function parseHash() {
  const h = typeof window === 'undefined' ? '' : window.location.hash || ''
  if (h === '#/dashboard') return { view: 'dashboard', caseId: null }
  const m = h.match(/^#\/cases\/(.+)$/)
  if (m) return { view: 'home', caseId: decodeURIComponent(m[1]) }
  return { view: 'home', caseId: null }
}

function setHash(h) {
  if (typeof window !== 'undefined' && window.location.hash !== h) {
    window.location.hash = h
  }
}

function App() {
  // The signed-in user (or null). When present, an address check is auto-saved
  // as a DRAFT case so it lands in My Properties and the boundary/photo flows
  // update that same case. Logged out stays public/stateless.
  const { user } = useAuth()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  // Live pipeline stage progress, keyed by stage (address, lga, ...).
  const [stages, setStages] = useState({})
  // The address of the current result, so override changes can re-run it.
  const [lastAddress, setLastAddress] = useState('')
  const [overrides, setOverrides] = useState(NO_OVERRIDES)
  // Saved boundary assessment (separate from the free point result), set when the
  // user completes the boundary workflow or resumes a boundary case.
  const [boundarySession, setBoundarySession] = useState(null)
  // The bal_rating of the latest in-session photo-sharpened read, so the headline
  // can govern to the worst across point, photo, and boundary (safety). On resume
  // the sharpened read is already in `result`, so this only covers the live flow.
  const [sharpenedRating, setSharpenedRating] = useState(null)
  // The side (N/E/S/W) hovered in the boundary summary, for map highlighting.
  const [highlightedSide, setHighlightedSide] = useState(null)
  // Identifies the latest assessment run; lets us ignore an in-flight stream's
  // late results if the user has gone back (or started another run) meanwhile.
  const runId = useRef(0)
  // View selector for the no-router app: 'home' (entry/loading/results) or
  // 'dashboard' (My Properties). The resumed case, if any, drives the results
  // view from stored data and tells NextStepCard which case to continue.
  // Initial view is restored from the URL hash so a reload keeps your place.
  // Captured once at first render (lazy state) — not refs, so it's render-safe.
  const [bootIntent] = useState(parseHash)
  const [hasSession] = useState(
    () => typeof window !== 'undefined' && Boolean(getRefreshToken()),
  )
  const [view, setView] = useState(() =>
    hasSession && bootIntent.view === 'dashboard' ? 'dashboard' : 'home',
  )
  const [activeCase, setActiveCase] = useState(null)
  const [resuming, setResuming] = useState(
    () => hasSession && Boolean(bootIntent.caseId),
  )
  // Object URLs for a resumed case's photos (so thumbnails render on resume),
  // revoked when we leave / load another case.
  const [resumedPhotoUrls, setResumedPhotoUrls] = useState({})
  const photoUrlsRef = useRef({})

  function handleBoundarySaved({ boundaryResult, polygon, caseId, caseRecord }) {
    setBoundarySession({ boundaryResult, polygon, caseId })
    if (caseRecord) setActiveCase(caseRecord)
    setHash(`#/cases/${caseId}`)
  }

  // Logged-in only: persist a just-checked address as a DRAFT case in the
  // background, so it appears in My Properties and the boundary/photo flows
  // update the SAME case (activeCase). Not awaited — the result is already on
  // screen, so saving never blocks it; a save failure leaves the read untouched.
  async function persistDraft(address, activeOverrides, myRun) {
    try {
      const created = await createCase({
        address,
        fireDangerOverride: activeOverrides?.fireDanger,
        slopeOverride: activeOverrides?.slope,
      })
      if (runId.current !== myRun) return // user moved on — don't attach a stale case
      setActiveCase(created)
      setHash(`#/cases/${created.id}`)
    } catch {
      /* couldn't save the draft (offline, etc.) — the on-screen read is unaffected */
    }
  }

  // Core call used by a fresh search or an override change (point mode only).
  async function runAssess(address, activeOverrides, polygon = null) {
    const myRun = ++runId.current
    setLoading(true)
    setError(null)
    setStages({})
    setLastAddress(address)
    try {
      const data = await assessStream(
        address,
        activeOverrides,
        (event) => {
          if (runId.current !== myRun) return
          setStages((prev) => ({
            ...prev,
            [event.stage]: { status: event.status, detail: event.detail },
          }))
        },
        polygon,
      )
      if (runId.current !== myRun) return
      setResult(data)
      // Auto-save the check as a draft when signed in (background, point mode).
      if (user && !polygon) persistDraft(address, activeOverrides, myRun)
    } catch (err) {
      if (runId.current !== myRun) return
      setError(err.message)
      setResult(null)
    } finally {
      if (runId.current === myRun) setLoading(false)
    }
  }

  // Fresh search from the entry screen: start clean (no overrides, no boundary,
  // no carried-over case — a new check is its own draft when signed in).
  function handleAssess(address) {
    setOverrides(NO_OVERRIDES)
    setBoundarySession(null)
    setSharpenedRating(null)
    setActiveCase(null)
    runAssess(address, NO_OVERRIDES, null)
  }

  // Clear all result/session state and invalidate any in-flight run so its late
  // results can't pull us back into the results view.
  function revokePhotoUrls() {
    const count = Object.keys(photoUrlsRef.current).length
    if (count) plog('revokePhotoUrls revoking', count, 'url(s)')
    for (const url of Object.values(photoUrlsRef.current)) {
      try {
        URL.revokeObjectURL(url)
      } catch {
        /* ignore */
      }
    }
    photoUrlsRef.current = {}
  }

  function resetResultState() {
    runId.current++
    setLoading(false)
    setResult(null)
    setError(null)
    setStages({})
    setLastAddress('')
    setOverrides(NO_OVERRIDES)
    setBoundarySession(null)
    setSharpenedRating(null)
    setHighlightedSide(null)
    setActiveCase(null)
    revokePhotoUrls()
    setResumedPhotoUrls({})
  }

  // Header back: a resumed case returns to the dashboard; a fresh result returns
  // to the entry screen.
  function handleBack() {
    const toDashboard = Boolean(activeCase)
    resetResultState()
    setView(toDashboard ? 'dashboard' : 'home')
    setHash(toDashboard ? '#/dashboard' : '#/')
  }

  // Open the dashboard ("My Properties").
  function openDashboard() {
    setView('dashboard')
    setHash('#/dashboard')
  }

  // New assessment / back to entry from the dashboard.
  function goToEntry() {
    resetResultState()
    setView('home')
    setHash('#/')
  }

  // Resume a saved case: load it and render the stored assessment in the results
  // view, status-aware (NextStepCard reads activeCase). Also fetches the stored
  // photo thumbnails so a sharpened case shows its photos.
  async function handleOpenCase(caseId) {
    resetResultState()
    const myRun = runId.current
    setView('home')
    setHash(`#/cases/${caseId}`)
    setResuming(true)
    try {
      const loaded = await getCase(caseId)
      if (runId.current !== myRun) return

      // STEP 1: does the case actually carry photos with file paths?
      const photos = loaded.photos || []
      plog('case loaded', loaded.id, 'status', loaded.status, 'photos', photos.length)
      plog(
        'case photo metadata',
        photos.map((p) => ({ direction: p.direction, hasFilePath: Boolean(p.file_path) })),
      )

      // STEP 2: fetch each stored JPEG as an object URL BEFORE committing the
      // result, so NextStepCard mounts with the thumbnails already present
      // (it snapshots initialPhotos once on mount).
      const urls = {}
      if (photos.length) {
        await Promise.all(
          photos.map(async (p) => {
            plog('fetch loop ->', p.direction, 'url', `/cases/${loaded.id}/photos/${p.direction}`)
            const url = await getCasePhotoURL(loaded.id, p.direction)
            if (url) urls[(p.direction || '').toLowerCase()] = url
          }),
        )
        if (runId.current !== myRun) {
          for (const url of Object.values(urls)) {
            try {
              URL.revokeObjectURL(url)
            } catch {
              /* ignore */
            }
          }
          return
        }
      }
      plog('photo urls ready', Object.keys(urls))

      const address =
        loaded.property?.address ||
        loaded.assessment?.address ||
        loaded.boundary_assessment?.address ||
        ''
      setLastAddress(address)

      // The persisted reads are authoritative — no re-fetch. The default/point
      // read drives the main page; a boundary-only case falls back to its
      // boundary read so the page still renders a headline.
      setResult(loaded.assessment || loaded.boundary_assessment)

      // A saved boundary read renders in BoundaryStepCard below the default read,
      // coexisting with point + photo (they live in separate case fields now).
      if (caseHasBoundary(loaded)) {
        setBoundarySession({
          boundaryResult: loaded.boundary_assessment,
          polygon: boundaryPolygonFromCase(loaded),
          caseId: loaded.id,
        })
      }

      photoUrlsRef.current = urls
      setResumedPhotoUrls(urls)
      setActiveCase(loaded)
    } catch (err) {
      if (runId.current !== myRun) return
      setError(err.message)
      setView('dashboard')
      setHash('#/dashboard')
    } finally {
      if (runId.current === myRun) setResuming(false)
    }
  }

  // On first load, restore a case from the URL hash (#/cases/<id>) if a session
  // exists; the 'dashboard'/'home' view was already set from the hash above. A
  // protected hash with no session falls back to entry.
  useEffect(() => {
    const { view: bootView, caseId } = bootIntent
    if (hasSession && caseId) {
      // Restoring app state from the URL on load — a legitimate sync with an
      // external system (the browser history/URL), runs once on mount.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      handleOpenCase(caseId)
    } else if (!hasSession && (bootView !== 'home' || caseId)) {
      setHash('#/')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // When resuming a saved case, seed NextStepCard so it continues on that case.
  // A completed/submitted case carries its sharpened assessment + photos in
  // `assessment` (the boundary read lives separately in boundary_assessment).
  const resumedComplete =
    activeCase?.status === 'ANALYSIS_COMPLETE' ||
    activeCase?.status === 'SUBMITTED_TO_ASSESSOR'
  const resumedSharpened = resumedComplete ? activeCase.assessment : null
  const resumedPhotos = activeCase?.photos?.length
    ? activeCase.photos.map((p) => ({
        intended_direction: p.direction,
        image: resumedPhotoUrls[(p.direction || '').toLowerCase()] || null,
      }))
    : null
  if (resumedPhotos) {
    plog(
      'handoff -> NextStepCard initialPhotos',
      resumedPhotos.map((p) => ({ dir: p.intended_direction, hasImage: Boolean(p.image) })),
    )
  }

  // SAFETY: the single property headline governs to the WORST read present —
  // point (or photo-sharpened point in `result`), the live sharpened read, and
  // the boundary edge read — so it never sits below any individual panel.
  const headlineRating = worstBalRating([
    result?.bal_rating,
    sharpenedRating,
    boundarySession?.boundaryResult?.bal_rating,
  ])

  // Entry screen until a run starts; the analyzing view while loading; the full
  // results only once the backend has finished and a result is in hand.
  const showEntry = !loading && !result

  return (
    <div style={{ position: 'relative', minHeight: '100vh', background: 'var(--paper)' }}>
      {/* topographic backdrop */}
      <div style={{ position: 'fixed', inset: 0, opacity: 0.5, pointerEvents: 'none' }}>
        <ContourField lines={14} amp={34} />
      </div>

      {view === 'dashboard' ? (
        /* ───────── Dashboard / My Properties ───────── */
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <AppHeader onBack={goToEntry} onMyProperties={openDashboard} />
          <main style={{ flex: 1 }}>
            <Dashboard onOpenCase={handleOpenCase} onNewAssessment={goToEntry} />
          </main>
        </div>
      ) : showEntry ? (
        /* ───────── Entry / hero ───────── */
        <div style={{ position: 'relative', zIndex: 1, display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
          <AppHeader onMyProperties={openDashboard} />
          <main
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '8px 20px 48px',
            }}
          >
            <EntryHero onAssess={handleAssess} loading={loading} error={error} />
          </main>
        </div>
      ) : (
        <>
      {/* header */}
      <AppHeader sticky onBack={handleBack} onMyProperties={openDashboard} />

      <main
        className="ec-shell-pad"
        style={{
          position: 'relative',
          maxWidth: 1180,
          margin: '0 auto',
          padding: '0 24px 64px',
        }}
      >
          {loading ? (
            /* ───────── Analyzing — spinner only until the backend finishes ───────── */
            <section
              key="analyzing"
              className="ec-screen-in"
              style={{
                minHeight: 'calc(100vh - 140px)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <div style={{ width: '100%', maxWidth: 460 }}>
                <LoadingState stages={stages} address={lastAddress} />
              </div>
            </section>
          ) : (
            /* ───────── Results ───────── */
            <section key="results" className="ec-results ec-screen-in">
              {/* full-width address title — anchors both columns */}
              <div className="ec-results-title">
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: 'clamp(24px, 3vw, 30px)',
                    lineHeight: 1.15,
                    letterSpacing: '-0.01em',
                    color: 'var(--ink)',
                    margin: 0,
                  }}
                >
                  {result.matched_address}
                </h2>
                <div style={{ marginTop: 4, fontSize: 14, color: 'var(--ink-soft)' }}>
                  {result.lga} LGA
                </div>
              </div>

              <div
                style={{ display: 'grid', gap: 20, gridTemplateColumns: 'minmax(0, 1fr)' }}
                className="ec-results-grid"
              >
                {/* map — fills the left, static */}
                <div className="ec-map-col">
                  <ECCard className="ec-map-card" style={{ padding: 18 }}>
                    <ECEyebrow>Your block, as the data sees it</ECEyebrow>
                    <div className="ec-map-frame">
                      <AssessmentMap
                        geometry={result?.geometry}
                        siteBoundaryOverlay={boundarySession?.polygon}
                        transects={boundarySession?.boundaryResult?.per_direction}
                        governingDirection={boundarySession?.boundaryResult?.governing_direction}
                        highlightedSide={highlightedSide}
                      />
                    </div>
                  </ECCard>
                </div>

                {/* story column — default result always visible; boundary and photo
                    summaries stack below without replacing each other. */}
                <div className="ec-story-col">
                  <Reveal>
                    <ResultPanel
                      result={result}
                      overrides={overrides}
                      headlineRating={headlineRating}
                    />
                  </Reveal>
                  <Reveal delay={80}>
                    <DrivingFactors result={result} />
                  </Reveal>
                  <Reveal delay={100}>
                    <BoundaryStepCard
                      key={`boundary-${boundarySession?.caseId || activeCase?.id || result.matched_address || result.address}`}
                      result={result}
                      overrides={overrides}
                      initialBoundaryResult={boundarySession?.boundaryResult || null}
                      initialPolygon={boundarySession?.polygon || null}
                      initialCaseId={boundarySession?.caseId || activeCase?.id || null}
                      onBoundarySaved={handleBoundarySaved}
                      onHoverSide={setHighlightedSide}
                    />
                  </Reveal>
                  <Reveal delay={120}>
                    <NextStepCard
                      key={activeCase?.id || result.matched_address || result.address}
                      result={result}
                      overrides={overrides}
                      initialCaseId={activeCase?.id || boundarySession?.caseId || null}
                      caseStatus={activeCase?.status || null}
                      initialSharpened={resumedSharpened}
                      initialPhotos={resumedPhotos}
                      onSharpened={(data) => setSharpenedRating(data?.bal_rating)}
                    />
                  </Reveal>
                </div>
              </div>
            </section>
          )}
      </main>
        </>
      )}

      {/* Resume loader overlay while a saved case is fetched. */}
      {resuming && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 80,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'color-mix(in oklab, var(--paper) 82%, transparent)',
            backdropFilter: 'blur(2px)',
            WebkitBackdropFilter: 'blur(2px)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
            <span className="ec-spin" aria-hidden="true" style={{ color: 'var(--euc-deep)' }}>
              <Glyph name="refresh" size={24} />
            </span>
            Loading…
          </div>
        </div>
      )}
    </div>
  )
}

export default App

import { useState, useRef, useEffect, useCallback } from 'react'
import EntryHero from './components/EntryHero'
import AppHeader from './components/AppHeader'
import Dashboard from './components/Dashboard'
import AssessmentMap from './components/AssessmentMap'
import ResultPanel from './components/ResultPanel'
import BoundaryResultPanel from './components/BoundaryResultPanel'
import DrivingFactors from './components/DrivingFactors'
import NextStepCard from './components/NextStepCard'
import LoadingState from './components/LoadingState'
import PrelimBadge from './components/ui/PrelimBadge'
import ContourField from './components/ui/ContourField'
import Glyph from './components/ui/Glyph'
import Reveal from './components/ui/Reveal'
import { ECCard, ECEyebrow } from './components/ui/ECCard'
import { assessStream } from './lib/api'
import { getCase, getCasePhotoURL, createCase } from './lib/cases'
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
  // Saving a boundary assessment is login-gated (it becomes a durable Case), so
  // we use the SAME auth gate the deep-analysis photo flow uses.
  const { ensureAuthenticated } = useAuth()
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState(null)
  const [error, setError] = useState(null)
  // Live pipeline stage progress, keyed by stage (address, lga, ...).
  const [stages, setStages] = useState({})
  // The address of the current result, so override changes can re-run it.
  const [lastAddress, setLastAddress] = useState('')
  const [overrides, setOverrides] = useState(NO_OVERRIDES)
  // The site boundary the user has drawn on the map (GeoJSON Polygon), or null
  // for the normal point assessment. Set/cleared by the map's draw tool.
  const [sitePolygon, setSitePolygon] = useState(null)
  // The side (N/E/S/W) the user is hovering in the boundary panel, so the map
  // can highlight that side's transect chips in real time.
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

  // The draw tool emits the current ring (or null on clear); remember it so the
  // "Assess this boundary" button can re-run the assessment from the edge.
  const handleSitePolygon = useCallback((polygon) => {
    setSitePolygon(polygon)
  }, [])

  // Core call used by a fresh search, an override change, or a boundary assess.
  // polygon: a GeoJSON Polygon to assess from the edge, or null for point mode.
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
    } catch (err) {
      if (runId.current !== myRun) return
      setError(err.message)
      setResult(null)
    } finally {
      if (runId.current === myRun) setLoading(false)
    }
  }

  // Fresh search from the entry screen: start clean (no overrides, no boundary).
  function handleAssess(address) {
    setOverrides(NO_OVERRIDES)
    setSitePolygon(null)
    runAssess(address, NO_OVERRIDES, null)
  }

  // Assess from the drawn boundary edge AND save it as a durable Case. Unlike the
  // public point assessment, this is login-gated (like the photo flow): we demand
  // auth, then POST /cases (which re-runs the SAME pipeline in boundary mode and
  // stores the full result). On success the saved case becomes the result, so it
  // shows in My Properties and survives "back". The drawn polygon is left on the
  // map. No /assess/stream here — the single /cases call is the only run.
  async function handleAssessBoundary() {
    if (!sitePolygon || !lastAddress) return

    const ok = await ensureAuthenticated()
    if (!ok) return // user cancelled the login modal — stay on the point result.

    const myRun = ++runId.current
    setLoading(true)
    setError(null)
    setStages({})
    try {
      const created = await createCase({
        address: lastAddress,
        boundaryPolygon: sitePolygon,
        fireDangerOverride: overrides?.fireDanger,
        slopeOverride: overrides?.slope,
      })
      if (runId.current !== myRun) return
      // Render the saved case's stored boundary assessment; keep sitePolygon so
      // the drawn boundary stays on the map. The hash makes the case linkable.
      setResult(created.assessment)
      setActiveCase(created)
      setHash(`#/cases/${created.id}`)
    } catch (err) {
      if (runId.current !== myRun) return
      setError(err.message)
    } finally {
      if (runId.current === myRun) setLoading(false)
    }
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
    setSitePolygon(null)
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

      // Commit photos + result together so the panel mounts with the URLs.
      photoUrlsRef.current = urls
      setResumedPhotoUrls(urls)
      setResult(loaded.assessment)
      setActiveCase(loaded)
      setLastAddress(loaded.property?.address || loaded.assessment?.address || '')
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

  // Boundary mode = the result was assessed from a drawn polygon (its transects
  // carry an outward direction). Drives the per-transect table + button label.
  const isBoundaryResult = Boolean(
    result?.per_direction?.some((side) => side.outward_direction),
  )

  // When resuming a saved case, seed NextStepCard so it continues on that case.
  // A completed/submitted case carries its sharpened assessment + photos.
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
                        onPolygon={handleSitePolygon}
                        transects={result?.per_direction}
                        governingDirection={result?.governing_direction}
                        highlightedSide={highlightedSide}
                      />
                    </div>

                    {/* Appears once a boundary is drawn: re-runs the assessment
                        measuring from the edge instead of the geocoded point. */}
                    {sitePolygon && (
                      <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
                        <button
                          type="button"
                          className="ec-press"
                          onClick={handleAssessBoundary}
                          style={{
                            border: 'none',
                            borderRadius: 99,
                            padding: '10px 18px',
                            background: 'var(--ember, #7A1F1F)',
                            color: '#fff',
                            fontWeight: 700,
                            fontSize: 14,
                            cursor: 'pointer',
                          }}
                        >
                          Assess this boundary
                        </button>
                      </div>
                    )}
                  </ECCard>
                </div>

                {/* story column — scrolls within its own panel on desktop.
                    Boundary mode swaps the right-side content for the per-side
                    breakdown; the address (point) flow is unchanged. */}
                <div className="ec-story-col">
                  {isBoundaryResult ? (
                    <Reveal>
                      <BoundaryResultPanel
                        result={result}
                        onHoverSide={setHighlightedSide}
                        onBack={handleBack}
                      />
                    </Reveal>
                  ) : (
                    <>
                      <Reveal>
                        <ResultPanel result={result} overrides={overrides} />
                      </Reveal>
                      <Reveal delay={80}>
                        <DrivingFactors result={result} />
                      </Reveal>
                      <Reveal delay={120}>
                        {/* key on the case (when resuming) or the property so
                            the deep-analysis session resets cleanly and never
                            reuses a stale case_id across properties. */}
                        <NextStepCard
                          key={activeCase?.id || result.matched_address || result.address}
                          result={result}
                          overrides={overrides}
                          initialCaseId={activeCase?.id || null}
                          caseStatus={activeCase?.status || null}
                          initialSharpened={resumedSharpened}
                          initialPhotos={resumedPhotos}
                        />
                      </Reveal>
                    </>
                  )}
                  {/* Boundary mode keeps its badge here; point mode shows the
                      prominent one beside the BAL inside ResultPanel. */}
                  {isBoundaryResult && (
                    <div style={{ display: 'flex', justifyContent: 'center', paddingTop: 4, paddingBottom: 8 }}>
                      <PrelimBadge />
                    </div>
                  )}
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

import { useCallback, useEffect, useRef, useState } from 'react'
import AssessmentMap from './AssessmentMap'
import BoundaryResultPanel from './BoundaryResultPanel'
import ECButton from './ui/ECButton'
import ConfirmModal from './ui/ConfirmModal'
import GuidedTour from './ui/GuidedTour'
import Glyph from './ui/Glyph'
import { createCase, getCase, updateCaseBoundary } from '../lib/cases'
import { boundaryPolygonFromCase } from '../lib/boundary'

const P = (...args) => console.log('[BoundaryPage]', ...args)

// First-run guided tour for the draw flow. Auto-shows once (localStorage flag),
// always replayable via the "Show tour" button. Each step spotlights ONE REAL
// control present in draw mode and explains it: the map, then each Geoman tool
// individually (draw polygon, edit, drag, erase), then the Assess button. Each
// Geoman button is targeted via its own icon class through its `.button-container`
// (`:has`) so the highlight lands on that single tool, not the whole toolbar.
// (The bottom "Clear boundary" button only appears after a shape exists, so it
// isn't a first-run step — the erase tool covers "start over".)
// Parked follow-up (not built): sync this seen-flag to a backend user pref so it
// follows the user across devices; localStorage is the scope for now.
const TOUR_FLAG = 'embercheck.tourSeen.drawBoundary'
const TOUR_STEPS = [
  {
    selector: '[data-tour="boundary-map"]',
    title: 'Trace your block',
    body: 'This is your property on the map. Pan and zoom to frame your block, then use the tools on the left to draw its outline.',
  },
  {
    selector: '.button-container:has(.leaflet-pm-icon-polygon)',
    title: 'Draw the outline',
    body: 'Tap this polygon tool to start, then tap each corner of your block on the map. Example, for a rectangular block: tap the top-left corner, then top-right, then bottom-right, then bottom-left — finally tap your first corner again to close the shape.',
  },
  {
    selector: '.button-container:has(.leaflet-pm-icon-edit)',
    title: 'Adjust a corner',
    body: 'Tap Edit, then drag any corner dot to move it. Drag a faint dot on an edge to add a new corner — use this to make the outline hug your real boundary.',
  },
  {
    selector: '.button-container:has(.leaflet-pm-icon-drag)',
    title: 'Move the whole shape',
    body: 'Tap Drag, then drag the whole outline to reposition it — handy when the shape is right but sits slightly off. Its form stays the same.',
  },
  {
    selector: '.button-container:has(.leaflet-pm-icon-delete)',
    title: 'Start over',
    body: 'Tap the bin, then tap your shape to remove it and draw again. Nothing is saved while you draw or adjust.',
  },
  {
    selector: '[data-tour="assess-boundary"]',
    title: 'Get your rating',
    body: 'When your block is closed, tap Assess boundary. We measure vegetation from each side and return your BAL — this is the only step that saves.',
  },
]

function tourSeen() {
  try {
    return Boolean(localStorage.getItem(TOUR_FLAG))
  } catch {
    return false
  }
}

export default function BoundaryAssessmentPage({
  address,
  pointResult,
  overrides,
  initialPolygon = null,
  initialCaseId = null,
  onClose,
  onComplete,
  onClear,
}) {
  const [phase, setPhase] = useState('loading')
  // polygon holds the editable GeoJSON Polygon for the draw phase.
  // It is NOT passed to AssessmentMap in result phase.
  const [polygon, setPolygon] = useState(initialPolygon)
  const [assessment, setAssessment] = useState(null)
  const [caseId, setCaseId] = useState(initialCaseId)
  const [highlightedSide, setHighlightedSide] = useState(null)
  const [assessing, setAssessing] = useState(false)
  const [error, setError] = useState(null)
  const [confirmClear, setConfirmClear] = useState(false)
  // Auto-open the guided tour the first time the draw flow is ever entered
  // (lazy from the localStorage flag, so no set-state-in-effect). Replaying via
  // "Show tour" sets this true without touching the flag.
  const [tourOpen, setTourOpen] = useState(() => !tourSeen())
  const savedCaseRef = useRef(null)

  // Skip or Done both close the tour and mark it seen, so it never auto-shows
  // again. Stable identity so GuidedTour's effects don't re-run each render.
  const closeTour = useCallback(() => {
    setTourOpen(false)
    try {
      localStorage.setItem(TOUR_FLAG, '1')
    } catch {
      // localStorage unavailable (private mode) — the tour just shows again.
    }
  }, [])

  P('mount', { initialCaseId, hasInitialPolygon: !!initialPolygon })

  // On mount: if we have a caseId, fetch the saved case and hydrate into
  // the result phase. DrawControl is NOT mounted during result, so this
  // cannot trigger handlePolygon.
  useEffect(() => {
    let cancelled = false
    async function hydrate() {
      if (!initialCaseId) {
        P('no caseId → draw')
        setPhase('draw')
        return
      }
      P('hydrating case', initialCaseId)
      try {
        const saved = await getCase(initialCaseId)
        if (cancelled) return
        savedCaseRef.current = saved
        if (saved.boundary_assessment) {
          setAssessment(saved.boundary_assessment)
          setCaseId(saved.id)
          // Store the polygon for later editing, but do NOT feed it to
          // AssessmentMap — the result phase shows the boundary via
          // siteBoundaryOverlay (read-only), not via DrawControl.
          const hydrated = boundaryPolygonFromCase(saved)
          if (hydrated) setPolygon(hydrated)
          P('hydrated → result', {
            bal: saved.boundary_assessment.bal_rating,
            hasPolygon: !!hydrated,
            sectorEvidence: (saved.sector_evidence || []).length,
          })
          setPhase('result')
        } else {
          P('no boundary_assessment → draw')
          setPhase('draw')
        }
      } catch (err) {
        P('hydration error', err?.message)
        if (!cancelled) setPhase('draw')
      }
    }
    hydrate()
    return () => { cancelled = true }
  }, [initialCaseId])

  // handlePolygon only fires in draw phase (DrawControl is only mounted
  // when phase === 'draw'). No phase guard needed.
  const handlePolygon = useCallback((next) => {
    P('handlePolygon', { hasNext: !!next })
    setPolygon(next)
  }, [])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  async function runAssess() {
    if (!polygon || !address) return
    setAssessing(true)
    setError(null)
    try {
      const saved = caseId
        ? await updateCaseBoundary(caseId, {
            boundaryPolygon: polygon,
            fireDangerOverride: overrides?.fireDanger,
            slopeOverride: overrides?.slope,
          })
        : await createCase({
            address,
            boundaryPolygon: polygon,
            fireDangerOverride: overrides?.fireDanger,
            slopeOverride: overrides?.slope,
          })
      setAssessment(saved.boundary_assessment)
      setCaseId(saved.id)
      setPhase('result')
      savedCaseRef.current = saved
      P('assessed → result', { bal: saved.boundary_assessment?.bal_rating })
    } catch (err) {
      setError(err.message || 'Assessment failed. Please try again.')
    } finally {
      setAssessing(false)
    }
  }

  function handleDone() {
    if (!assessment || !polygon) return
    onComplete?.({
      boundaryResult: assessment,
      polygon,
      caseId,
      caseRecord: savedCaseRef.current,
    })
    onClose?.()
  }

  function enterEditMode() {
    P('entering draw mode for edit')
    setAssessment(null)
    setPhase('draw')
  }

  function handleClearBoundary() {
    P('clear boundary')
    // (a) Reset THIS page back to a blank draw canvas so the user can trace a
    // fresh boundary in place (we do not close the page).
    setAssessment(null)
    setPolygon(null)
    setCaseId(null)
    savedCaseRef.current = null
    setError(null)
    setPhase('draw')
    // (b) Propagate the reset up so the main page drops the stale boundary
    // summary and returns to "Start boundary assessment".
    onClear?.()
    setConfirmClear(false)
  }

  P('render', { phase, hasAssessment: !!assessment, hasPolygon: !!polygon })

  // --- Map props: different per phase ---
  const isDrawPhase = phase === 'draw'
  const isResultPhase = phase === 'result' && assessment

  // Result phase: show the user's boundary as a read-only overlay from the
  // assessment geometry. DrawControl is NOT mounted → no re-emit race.
  // Draw phase: DrawControl is mounted with the polygon for editing.
  // Loading phase: show the point result geometry (if any) as a placeholder.
  const mapGeometry = assessment?.geometry || pointResult?.geometry
  const mapTransects = isResultPhase ? assessment.per_direction : null
  const mapGoverning = isResultPhase ? assessment.governing_direction : null

  // Only pass siteBoundaryOverlay in result/loading phase (read-only display).
  // In draw phase the DrawControl handles the polygon.
  const mapBoundaryOverlay = !isDrawPhase
    ? (assessment?.geometry?.site_polygon || null)
    : null

  return (
    <div className="ec-boundary-overlay" role="dialog" aria-modal="true">
      <div className="ec-boundary-panel">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute',
            top: 14,
            right: 14,
            zIndex: 30,
            width: 38,
            height: 38,
            borderRadius: 99,
            border: 'none',
            background: 'rgba(20,18,11,0.45)',
            color: '#F7F2E2',
            cursor: 'pointer',
            fontSize: 18,
            lineHeight: 1,
          }}
        >
          ×
        </button>

        <div className="ec-boundary-body">
          <div className="ec-boundary-map" data-tour="boundary-map">
            <AssessmentMap
              geometry={mapGeometry}
              drawEnabled={isDrawPhase}
              initialPolygon={isDrawPhase ? polygon : null}
              onPolygon={handlePolygon}
              siteBoundaryOverlay={mapBoundaryOverlay}
              transects={mapTransects}
              governingDirection={mapGoverning}
              highlightedSide={highlightedSide}
            />
          </div>

          <div className="ec-boundary-side">
            {phase === 'loading' && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '14px',
                }}
              >
                <span className="ec-spin" aria-hidden="true" style={{ color: 'var(--euc-deep)' }}>
                  <Glyph name="refresh" size={20} />
                </span>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                  Loading saved assessment…
                </div>
              </div>
            )}

            {phase === 'draw' && (
              <>
                <h2
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontWeight: 800,
                    fontSize: 22,
                    lineHeight: 1.15,
                    color: 'var(--ink)',
                    margin: '0 0 8px',
                  }}
                >
                  Trace your block
                </h2>
                <p style={{ margin: '0 0 12px', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
                  Draw your site boundary on the map. We measure vegetation from the nearest edge — the
                  way an assessor walks the perimeter.
                </p>

                {/* Always-available replay of the guided tour (independent of the
                    seen flag). */}
                <button
                  type="button"
                  onClick={() => setTourOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    marginBottom: 16,
                    padding: '4px 8px',
                    borderRadius: 8,
                    border: '1px solid var(--line)',
                    background: 'none',
                    color: 'var(--euc-deep)',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 12.5,
                    fontWeight: 700,
                    cursor: 'pointer',
                  }}
                >
                  <Glyph name="help" size={14} />
                  Show tour
                </button>

                {error && (
                  <div
                    style={{
                      marginBottom: 14,
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
                      border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
                      fontSize: 13.5,
                      fontWeight: 600,
                      color: '#7a2418',
                    }}
                  >
                    {error}
                  </div>
                )}

                <div data-tour="assess-boundary">
                  {assessing ? (
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 12,
                        padding: '14px',
                        borderRadius: 14,
                        background: 'color-mix(in oklab, var(--euc) 12%, transparent)',
                        border: '1px solid color-mix(in oklab, var(--euc-deep) 20%, transparent)',
                      }}
                    >
                      <span className="ec-spin" aria-hidden="true" style={{ color: 'var(--euc-deep)' }}>
                        <Glyph name="refresh" size={20} />
                      </span>
                      <div>
                        <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
                          Assessing your boundary…
                        </div>
                        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
                          Measuring from each side of your block.
                        </div>
                      </div>
                    </div>
                  ) : (
                    <ECButton full icon="locate" onClick={runAssess} disabled={!polygon}>
                      Assess boundary
                    </ECButton>
                  )}
                </div>
              </>
            )}

            {isResultPhase && (
              <>
                <BoundaryResultPanel
                  variant="full"
                  result={assessment}
                  onHoverSide={setHighlightedSide}
                  caseId={caseId}
                  sectorEvidence={savedCaseRef.current?.sector_evidence}
                />
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <ECButton full icon="check" onClick={handleDone}>
                    Done
                  </ECButton>
                  <ECButton full variant="ghost" onClick={enterEditMode}>
                    Edit boundary on map
                  </ECButton>
                  <ECButton full variant="ghost" onClick={() => setConfirmClear(true)}>
                    Clear boundary
                  </ECButton>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      <ConfirmModal
        isOpen={confirmClear}
        tone="danger"
        title="Clear this boundary?"
        message="This removes your drawn boundary and its per-side ratings from this property. You can draw a new one."
        confirmLabel="Clear boundary"
        cancelLabel="Cancel"
        onConfirm={handleClearBoundary}
        onCancel={() => setConfirmClear(false)}
      />

      {/* First-run / replayable spotlight tour — only over the draw flow. */}
      {phase === 'draw' && tourOpen && (
        <GuidedTour steps={TOUR_STEPS} onClose={closeTour} />
      )}
    </div>
  )
}

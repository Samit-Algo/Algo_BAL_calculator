import { useCallback, useEffect, useRef, useState } from 'react'
import AssessmentMap from './AssessmentMap'
import BoundaryResultPanel from './BoundaryResultPanel'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'
import { createCase, updateCaseBoundary } from '../lib/cases'

// Full-screen boundary workflow: draw on the map → assess → review → Done.
// Login is enforced by the caller before this page opens.
export default function BoundaryAssessmentPage({
  address,
  pointResult,
  overrides,
  initialPolygon = null,
  initialCaseId = null,
  onClose,
  onComplete,
}) {
  const [phase, setPhase] = useState(initialPolygon ? 'draw' : 'draw')
  const [polygon, setPolygon] = useState(initialPolygon)
  const [assessment, setAssessment] = useState(null)
  const [caseId, setCaseId] = useState(initialCaseId)
  const [highlightedSide, setHighlightedSide] = useState(null)
  const [assessing, setAssessing] = useState(false)
  const [error, setError] = useState(null)
  const savedCaseRef = useRef(null)

  const handlePolygon = useCallback((next) => {
    setPolygon(next)
    if (phase === 'result') {
      setAssessment(null)
      setPhase('draw')
    }
  }, [phase])

  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  async function runAssess() {
    if (!polygon || !address) return
    setAssessing(true)
    setError(null)
    try {
      // Editing an existing case (boundary OR a point/photo case for this
      // property) updates it in place via PUT; a first boundary creates the
      // case. Either way the read comes back in `boundary_assessment`, coexisting
      // with any point/photo read on the same case.
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
    } catch (err) {
      setError(err.message || 'We couldn’t assess your boundary just now. Please try again.')
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

  const mapGeometry = assessment?.geometry || pointResult?.geometry
  const mapTransects = phase === 'result' ? assessment?.per_direction : null
  const mapGoverning = phase === 'result' ? assessment?.governing_direction : null

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
          <div className="ec-boundary-map">
            <AssessmentMap
              geometry={mapGeometry}
              drawEnabled
              initialPolygon={initialPolygon}
              onPolygon={handlePolygon}
              transects={mapTransects}
              governingDirection={mapGoverning}
              highlightedSide={highlightedSide}
            />
          </div>

          <div className="ec-boundary-side">
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
                <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
                  Draw your site boundary on the map. We measure vegetation from the nearest edge — the
                  way an assessor walks the perimeter.
                </p>

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
              </>
            )}

            {phase === 'result' && assessment && (
              <>
                <BoundaryResultPanel
                  variant="full"
                  result={assessment}
                  onHoverSide={setHighlightedSide}
                />
                <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <ECButton full icon="check" onClick={handleDone}>
                    Done
                  </ECButton>
                  <ECButton full variant="ghost" onClick={() => setPhase('draw')}>
                    Edit boundary on map
                  </ECButton>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

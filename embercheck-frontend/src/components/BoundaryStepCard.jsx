import { useState } from 'react'
import { ECCard, ECEyebrow } from './ui/ECCard'
import ECButton from './ui/ECButton'
import BoundaryAssessmentPage from './BoundaryAssessmentPage'
import BoundaryResultPanel from './BoundaryResultPanel'
import { useAuth } from '../auth/AuthContext'

// Boundary upsell + summary card. Mirrors NextStepCard: auth gate → dedicated
// workflow page → summary on the main result page without replacing the default
// point assessment.
export default function BoundaryStepCard({
  result,
  overrides,
  initialBoundaryResult = null,
  initialPolygon = null,
  initialCaseId = null,
  onBoundarySaved,
  onBoundaryCleared,
  onHoverSide,
}) {
  const { ensureAuthenticated } = useAuth()
  const [boundaryResult, setBoundaryResult] = useState(initialBoundaryResult)
  const [savedPolygon, setSavedPolygon] = useState(initialPolygon)
  const [caseId, setCaseId] = useState(initialCaseId)
  // Current case headline (raise OR lower) carried back from the assessment page,
  // so this summary card shows the latest assessment, not the immutable draft.
  const [caseHeadline, setCaseHeadline] = useState(null)
  const [pageOpen, setPageOpen] = useState(false)
  const [starting, setStarting] = useState(false)

  async function openBoundaryPage() {
    if (starting) return
    setStarting(true)
    try {
      const ok = await ensureAuthenticated()
      if (!ok) return
      setPageOpen(true)
    } finally {
      setStarting(false)
    }
  }

  function handleComplete({ boundaryResult: nextResult, polygon, caseId: nextCaseId, caseRecord }) {
    setBoundaryResult(nextResult)
    setSavedPolygon(polygon)
    setCaseId(nextCaseId)
    if (caseRecord) {
      setCaseHeadline({
        bal_rating: caseRecord.bal_rating,
        governing_direction: caseRecord.governing_direction,
      })
    }
    setPageOpen(false)
    onBoundarySaved?.({
      boundaryResult: nextResult,
      polygon,
      caseId: nextCaseId,
      caseRecord,
    })
  }

  function handleClearBoundary() {
    setBoundaryResult(null)
    setSavedPolygon(null)
    setCaseId(null)
    onBoundaryCleared?.()
  }

  if (boundaryResult) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* View = view + edit: opens the full boundary page (result view, then
            "Edit boundary on map"). Replaces the old "Edit boundary" button —
            one affordance, same destination. Rendered INSIDE the result card
            via the `action` slot. */}
        <BoundaryResultPanel
          variant="summary"
          result={boundaryResult}
          onHoverSide={onHoverSide}
          caseHeadline={caseHeadline}
          action={
            <ECButton full icon="locate" onClick={openBoundaryPage} disabled={starting}>
              {starting ? 'Opening…' : 'View'}
            </ECButton>
          }
        />
        {pageOpen && (
          <BoundaryAssessmentPage
            address={result?.address || result?.matched_address}
            pointResult={result}
            overrides={overrides}
            initialPolygon={savedPolygon}
            initialCaseId={caseId}
            onClose={() => setPageOpen(false)}
            onComplete={handleComplete}
            onClear={handleClearBoundary}
          />
        )}
      </div>
    )
  }

  return (
    <>
      <ECCard>
        <ECEyebrow n="2">Refine with your boundary</ECEyebrow>

        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 21,
            lineHeight: 1.25,
            color: 'var(--ink)',
            marginBottom: 8,
            textWrap: 'pretty',
          }}
        >
          Assess from your block edge
        </div>

        <p
          style={{
            margin: '0 0 18px',
            fontSize: 14.5,
            lineHeight: 1.55,
            color: 'var(--ink-soft)',
            textWrap: 'pretty',
          }}
        >
          Go deeper than the single map point — trace your block and we measure every side for a
          sharper, more accurate rating, plus a report you can send.{' '}
          <strong style={{ color: 'var(--ink)', fontWeight: 700 }}>$29.</strong>
        </p>

        <ECButton full icon="locate" onClick={openBoundaryPage} disabled={starting}>
          {starting ? 'Checking account…' : 'Start boundary assessment'}
        </ECButton>

        <p
          style={{
            margin: '10px 4px 0',
            fontSize: 12.5,
            lineHeight: 1.5,
            color: 'var(--ink-soft)',
            textAlign: 'center',
          }}
        >
          Requires a free account — your boundary is saved as a property record.
        </p>
      </ECCard>

      {pageOpen && (
        <BoundaryAssessmentPage
          address={result?.address || result?.matched_address}
          pointResult={result}
          overrides={overrides}
          initialPolygon={savedPolygon}
          initialCaseId={caseId}
          onClose={() => setPageOpen(false)}
          onComplete={handleComplete}
          onClear={handleClearBoundary}
        />
      )}
    </>
  )
}

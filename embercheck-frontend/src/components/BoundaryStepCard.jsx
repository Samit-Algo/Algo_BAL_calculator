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
  onHoverSide,
}) {
  const { ensureAuthenticated } = useAuth()
  const [boundaryResult, setBoundaryResult] = useState(initialBoundaryResult)
  const [savedPolygon, setSavedPolygon] = useState(initialPolygon)
  const [caseId, setCaseId] = useState(initialCaseId)
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
    setPageOpen(false)
    onBoundarySaved?.({
      boundaryResult: nextResult,
      polygon,
      caseId: nextCaseId,
      caseRecord,
    })
  }

  if (boundaryResult) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <BoundaryResultPanel
          variant="summary"
          result={boundaryResult}
          onHoverSide={onHoverSide}
        />
        <ECButton full variant="ghost" icon="locate" onClick={openBoundaryPage} disabled={starting}>
          {starting ? 'Opening…' : 'Edit boundary'}
        </ECButton>
        {pageOpen && (
          <BoundaryAssessmentPage
            address={result?.address || result?.matched_address}
            pointResult={result}
            overrides={overrides}
            initialPolygon={savedPolygon}
            initialCaseId={caseId}
            onClose={() => setPageOpen(false)}
            onComplete={handleComplete}
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
          Trace your site on the map and we measure vegetation from the boundary — saved to your
          account so you can return and edit it later.
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
        />
      )}
    </>
  )
}

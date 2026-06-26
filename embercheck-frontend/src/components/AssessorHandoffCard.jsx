import { useEffect, useState } from 'react'
import { ECCard, ECEyebrow } from './ui/ECCard'
import ECButton from './ui/ECButton'
import { useAuth } from '../auth/AuthContext'
import { listAssessorsForCase, submitCase } from '../lib/cases'

function assessorName(a) {
  return a.business_name || a.legal_name || 'Accredited assessor'
}

// DEMO ONLY: there is no real rating system yet (no job history at launch). Show
// the same placeholder rating for every assessor so the choose screen looks
// complete in the demo. Replace with a real, per-assessor rating later.
const DEMO_RATING = '4.9'

function RatingBadge() {
  return (
    <span
      title="Demo rating"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 3, flexShrink: 0,
        padding: '2px 8px', borderRadius: 99, fontSize: 12, fontWeight: 700,
        color: '#7a5418', background: 'color-mix(in oklab, var(--ochre) 22%, transparent)',
      }}
    >
      <span aria-hidden="true">★</span> {DEMO_RATING}
    </span>
  )
}

// Modal: fetch the approved assessors for this case, let the consumer pick one,
// and submit the case to them. States: loading | list | empty | submitting |
// done | error.
function ChooseAssessorModal({ caseId, onClose }) {
  const [phase, setPhase] = useState('loading') // loading|list|empty|done|error
  const [assessors, setAssessors] = useState([])
  const [error, setError] = useState(null)
  const [submittingId, setSubmittingId] = useState(null)
  const [chosen, setChosen] = useState(null)

  useEffect(() => {
    let cancelled = false
    listAssessorsForCase(caseId)
      .then((list) => {
        if (cancelled) return
        setAssessors(list)
        setPhase(list.length ? 'list' : 'empty')
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setPhase('error')
      })
    return () => { cancelled = true }
  }, [caseId])

  async function choose(a) {
    if (submittingId) return
    setSubmittingId(a.assessor_id)
    setError(null)
    try {
      await submitCase(caseId, a.assessor_id)
      setChosen(a)
      setPhase('done')
    } catch (e) {
      setError(e.message)
      setSubmittingId(null)
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 20, background: 'rgba(28,25,16,0.5)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 22,
          padding: '24px 22px', maxWidth: 460, width: '100%',
          boxShadow: '0 24px 60px rgba(40,36,24,0.28)', maxHeight: '84vh', overflowY: 'auto',
        }}
      >
        {phase === 'done' ? (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--ink)', marginBottom: 8 }}>
              Sent to your assessor
            </div>
            <p style={{ margin: '0 0 20px', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
              <strong style={{ color: 'var(--ink)' }}>{assessorName(chosen)}</strong> has received your assessment.
              They’ll review it and be in touch. You can track it in My Properties.
            </p>
            <ECButton full onClick={onClose}>Done</ECButton>
          </div>
        ) : (
          <>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, color: 'var(--ink)', marginBottom: 4 }}>
              Choose an accredited assessor
            </div>
            <p style={{ margin: '0 0 18px', fontSize: 14, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
              These accredited assessors cover your area. Pick one to review and certify your assessment.
            </p>

            {phase === 'loading' && <div style={{ color: 'var(--ink-soft)', padding: '12px 0' }}>Finding assessors near you…</div>}

            {phase === 'error' && (
              <div style={{ color: '#7a2418', fontWeight: 600, fontSize: 14 }}>{error}</div>
            )}

            {phase === 'empty' && (
              <div style={{ padding: '16px', borderRadius: 12, background: 'color-mix(in oklab, var(--ink) 5%, transparent)', fontSize: 14, color: 'var(--ink-soft)', lineHeight: 1.55 }}>
                No accredited assessors are available in your area right now. Please contact us and we’ll help arrange one.
              </div>
            )}

            {phase === 'list' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                {error && <div style={{ color: '#7a2418', fontWeight: 600, fontSize: 13.5 }}>{error}</div>}
                {assessors.map((a) => (
                  <div
                    key={a.assessor_id}
                    style={{
                      display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                      padding: '12px 14px', borderRadius: 12, border: '1px solid var(--line)', background: 'var(--paper)',
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontWeight: 700, fontSize: 14.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{assessorName(a)}</span>
                        <RatingBadge />
                      </div>
                      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                        {[a.accreditation_level && `Level ${a.accreditation_level}`, (a.operating_states || []).join(', ')].filter(Boolean).join(' · ')}
                      </div>
                    </div>
                    <ECButton small onClick={() => choose(a)} disabled={!!submittingId}>
                      {submittingId === a.assessor_id ? 'Sending…' : 'Choose'}
                    </ECButton>
                  </div>
                ))}
              </div>
            )}

            <div style={{ marginTop: 18 }}>
              <ECButton full variant="secondary" onClick={onClose}>Cancel</ECButton>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// "Go to an accredited assessor" — now wired (Phase 4/5): routes through the
// existing login flow, then opens the choose-assessor list and submits the case
// to the chosen assessor. Needs the active case id; without one it asks the user
// to save the assessment first.
export default function AssessorHandoffCard({ caseId }) {
  const { ensureAuthenticated } = useAuth()
  const [checking, setChecking] = useState(false)
  const [showChoose, setShowChoose] = useState(false)
  const [notice, setNotice] = useState(null)

  async function handleClick() {
    if (checking) return
    setChecking(true)
    setNotice(null)
    try {
      const ok = await ensureAuthenticated()
      if (!ok) return // login modal cancelled — stay put
      if (!caseId) {
        setNotice('Run an address check first so we have something to send.')
        return
      }
      setShowChoose(true)
    } finally {
      setChecking(false)
    }
  }

  return (
    <ECCard>
      <ECEyebrow n="4">Get it certified</ECEyebrow>

      <div
        style={{
          fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 21,
          lineHeight: 1.25, color: 'var(--ink)', marginBottom: 8, textWrap: 'pretty',
        }}
      >
        Go to an accredited assessor
      </div>

      <p
        style={{
          margin: '0 0 18px', fontSize: 14.5, lineHeight: 1.55,
          color: 'var(--ink-soft)', textWrap: 'pretty',
        }}
      >
        Ready for the real thing? An accredited assessor reviews your assessment and signs off a
        certified BAL — the official rating, not just a screening.{' '}
        <strong style={{ color: 'var(--ink)', fontWeight: 700 }}>$29.</strong>
      </p>

      <ECButton full icon="doc" onClick={handleClick} disabled={checking}>
        {checking ? 'Checking account…' : 'Go to accredited assessor'}
      </ECButton>

      {notice && (
        <p style={{ margin: '10px 4px 0', fontSize: 12.5, lineHeight: 1.5, color: '#7a5418', textAlign: 'center', fontWeight: 600 }}>
          {notice}
        </p>
      )}

      {showChoose && caseId && <ChooseAssessorModal caseId={caseId} onClose={() => setShowChoose(false)} />}
    </ECCard>
  )
}

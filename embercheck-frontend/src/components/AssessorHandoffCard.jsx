import { useState } from 'react'
import { ECCard, ECEyebrow } from './ui/ECCard'
import ECButton from './ui/ECButton'
import { useAuth } from '../auth/AuthContext'

// A small ember-themed placeholder shown once the user is authenticated: the
// accredited-assessor Console is parked, so this is an explicit "not yet
// available" state — not a dead button.
function NotAvailableModal({ onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: 20, background: 'rgba(28,25,16,0.5)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', border: '1px solid var(--line)',
          borderRadius: 22, padding: '26px 24px', maxWidth: 360, width: '100%',
          boxShadow: '0 24px 60px rgba(40,36,24,0.28)', textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22,
            color: 'var(--ink)', marginBottom: 8,
          }}
        >
          Not available yet
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
          The accredited-assessor handoff isn’t built yet — the assessor console is still on the
          way. Your account’s ready, so you’ll be able to submit from here once it opens.
        </p>
        <ECButton full onClick={onClose}>
          Got it
        </ECButton>
      </div>
    </div>
  )
}

// "Go to an accredited assessor" — routes through the EXISTING login flow
// (ensureAuthenticated), then lands on the parked "not yet available" state.
// If already signed in, ensureAuthenticated resolves immediately and we go
// straight there. No new auth, no change to other entry points.
export default function AssessorHandoffCard() {
  const { ensureAuthenticated } = useAuth()
  const [checking, setChecking] = useState(false)
  const [showNotAvailable, setShowNotAvailable] = useState(false)

  async function handleClick() {
    if (checking) return
    setChecking(true)
    try {
      const ok = await ensureAuthenticated()
      if (!ok) return // login modal cancelled — stay put
      setShowNotAvailable(true)
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

      <p
        style={{
          margin: '10px 4px 0', fontSize: 12.5, lineHeight: 1.5,
          color: 'var(--ink-soft)', textAlign: 'center',
        }}
      >
        Coming soon — sign in now and you’ll be set to submit when it opens.
      </p>

      {showNotAvailable && <NotAvailableModal onClose={() => setShowNotAvailable(false)} />}
    </ECCard>
  )
}

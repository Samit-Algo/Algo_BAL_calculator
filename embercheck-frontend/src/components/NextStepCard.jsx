import { useState } from 'react'
import { ECCard, ECEyebrow } from './ui/ECCard'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'
import CaptureFlow from './CaptureFlow'
import SharpenedResultPanel from './SharpenedResultPanel'
import SharpenedResultPage from './SharpenedResultPage'
import { assessPhotos } from '../lib/api'
import { createCase } from '../lib/cases'
import { plog } from '../lib/debug'
import { useAuth } from '../auth/AuthContext'

// A small themed "coming soon" modal — still used for the assessor hand-off,
// which isn't built yet.
function ComingSoonModal({ message, onClose }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 100,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 20,
        background: 'rgba(28,25,16,0.5)',
        backdropFilter: 'blur(4px)',
        WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 22,
          padding: '26px 24px',
          maxWidth: 360,
          width: '100%',
          boxShadow: '0 24px 60px rgba(40,36,24,0.28)',
          textAlign: 'center',
        }}
      >
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 22,
            color: 'var(--ink)',
            marginBottom: 8,
          }}
        >
          {message}
        </div>
        <p style={{ margin: '0 0 20px', fontSize: 14, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
          This part isn’t built yet — it’s a placeholder.
        </p>
        <ECButton full onClick={onClose}>
          Got it
        </ECButton>
      </div>
    </div>
  )
}

// "Your next step" — the upsell card. The primary CTA opens the guided
// four-photo capture flow; on completion the photos are POSTed to
// /assess/photos, the VLM reads them server-side, and we render the sharpened
// per-direction result. Photos + result are held in state so a re-render never
// re-uploads.
export default function NextStepCard({
  result,
  overrides,
  // Resume props (Step 5b-ii): when a saved case is opened, these seed the
  // session so we continue ON THE SAME case instead of creating a new one.
  initialCaseId = null,
  initialSharpened = null,
  initialPhotos = null,
  caseStatus = null, // the resumed case's status, or null for a fresh result
}) {
  const { ensureAuthenticated } = useAuth()
  const [capturing, setCapturing] = useState(false)
  const [photos, setPhotos] = useState(initialPhotos)
  const [notice, setNotice] = useState(null)
  // 'idle' | 'reading' | 'done' | 'error'
  const [status, setStatus] = useState(initialSharpened ? 'done' : 'idle')
  const [sharpened, setSharpened] = useState(initialSharpened) // /assess/photos result
  const [adjusted, setAdjusted] = useState(null) // latest recalc result, or null
  const [showPage, setShowPage] = useState(false) // the override "next page"
  const [error, setError] = useState(null)
  // The deep-analysis session's case id (one per property). Seeded from a
  // resumed case so "Take the four photos" continues on it (no duplicate case).
  const [activeCaseId, setActiveCaseId] = useState(initialCaseId)
  const [starting, setStarting] = useState(false)

  plog(
    'NextStepCard mount/render: caseStatus', caseStatus,
    'photos', (photos || []).map((p) => ({ dir: p.intended_direction, hasImage: Boolean(p.image) })),
  )

  // The property context the sharpened re-run needs: same address the free
  // screen used, plus any FDI/slope overrides, and coords for the record.
  const context = {
    address: result?.address || result?.matched_address,
    latitude: result?.latitude,
    longitude: result?.longitude,
    overrides,
  }

  // THE GATE: deep analysis requires login, then a Case, then capture.
  //   1. ensureAuthenticated() — open the login modal if needed.
  //   2. create the case once per session (reuse it on retake).
  //   3. only then open the guided capture flow.
  async function startPhotoCapture() {
    setError(null)
    if (starting) return

    const ok = await ensureAuthenticated()
    if (!ok) return // user cancelled the login modal — stay on results.

    // Reuse the existing case for this property (e.g. "retake"); otherwise make
    // one from the current session inputs.
    if (!activeCaseId) {
      setStarting(true)
      try {
        const created = await createCase({
          address: context.address,
          fireDangerOverride: overrides?.fireDanger,
          slopeOverride: overrides?.slope,
        })
        setActiveCaseId(created.id)
      } catch (err) {
        setError(err.message)
        return
      } finally {
        setStarting(false)
      }
    }

    setCapturing(true)
  }

  // POST the held photos to the backend for the active case. Used both right
  // after capture and by the retry button — it reads from state, so the photos
  // are never re-captured or lost on a failed attempt.
  async function sharpen(captured) {
    if (!activeCaseId) {
      setError('That analysis session has expired. Please start again.')
      setStatus('error')
      return
    }
    setStatus('reading')
    setError(null)
    try {
      const data = await assessPhotos(context, captured, activeCaseId)
      setSharpened(data)
      setAdjusted(null)
      setStatus('done')
      setShowPage(true) // move to the result/override page once the read lands
    } catch (err) {
      setError(err.message)
      setStatus('error')
    }
  }

  function handleComplete(captured) {
    setPhotos(captured)
    setCapturing(false)
    sharpen(captured)
  }

  const done = Array.isArray(photos) && photos.length === 4

  // Resumed case already submitted for accredited assessment: show the sharpened
  // read + a "queued" note, no capture/assessor CTAs. (The full submit CTA and
  // assessor status live in Step 5b-iii.)
  if (caseStatus === 'SUBMITTED_TO_ASSESSOR') {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {sharpened && <SharpenedResultPanel result={sharpened} photos={photos} />}
        <ECCard>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <span style={{ color: 'var(--euc-deep)', display: 'inline-flex' }}>
              <Glyph name="check" size={20} />
            </span>
            <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--ink)' }}>
              Submitted for accredited assessment
            </div>
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
            This assessment is queued for an accredited assessor. We’ll let you know when there’s an
            update — there’s nothing more to do here for now.
          </p>
        </ECCard>
      </div>
    )
  }

  // Once we have a sharpened result, surface it in place of the upsell copy.
  // The inline summary reflects any overrides made on the result page; the page
  // itself opens automatically after the read and can be reopened to adjust.
  if (status === 'done' && sharpened) {
    const displayed = adjusted || sharpened
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <SharpenedResultPanel result={displayed} photos={photos} />
        <ECButton full icon="doc" onClick={() => setShowPage(true)}>
          Adjust the inputs
        </ECButton>
        <ECButton full variant="ghost" icon="camera" onClick={startPhotoCapture} disabled={starting}>
          {starting ? 'Starting…' : 'Retake the four photos'}
        </ECButton>
        {showPage && (
          <SharpenedResultPage
            base={sharpened}
            photos={photos}
            onApply={setAdjusted}
            onClose={() => setShowPage(false)}
          />
        )}
        {capturing && (
          <CaptureFlow onClose={() => setCapturing(false)} onComplete={handleComplete} />
        )}
      </div>
    )
  }

  return (
    <ECCard>
      <ECEyebrow n="3">Your next step</ECEyebrow>

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
        Sharpen this read with four photos
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
        Guided capture, right where you’re standing. We read the vegetation condition, tighten the
        range, and build a report you can send to anyone.{' '}
        <strong style={{ color: 'var(--ink)', fontWeight: 700 }}>$29.</strong>
      </p>

      {status === 'reading' && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            marginBottom: 14,
            padding: '14px',
            borderRadius: 14,
            background: 'color-mix(in oklab, var(--euc) 12%, transparent)',
            border: '1px solid color-mix(in oklab, var(--euc-deep) 20%, transparent)',
          }}
        >
          <span className="ec-spin" aria-hidden="true" style={{ color: 'var(--euc-deep)', flexShrink: 0 }}>
            <Glyph name="refresh" size={20} />
          </span>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              Reading your photos…
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              Identifying the vegetation on each side — this takes a few seconds.
            </div>
          </div>
        </div>
      )}

      {status === 'error' && (
        <div
          style={{
            marginBottom: 14,
            padding: '14px',
            borderRadius: 14,
            background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
            border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
          }}
        >
          <div style={{ display: 'flex', gap: 10, marginBottom: 10 }}>
            <span style={{ color: '#b3402c', flexShrink: 0 }}>
              <Glyph name="warn" size={19} />
            </span>
            <div style={{ fontSize: 13.5, lineHeight: 1.5, color: '#7a2418', fontWeight: 600 }}>
              {error || 'We couldn’t read your photos just now.'} Your four photos are safe.
            </div>
          </div>
          <ECButton full variant="ochre" icon="refresh" onClick={() => sharpen(photos)}>
            Try again
          </ECButton>
        </div>
      )}

      {status !== 'reading' && (
        <ECButton full icon="camera" onClick={startPhotoCapture} disabled={starting}>
          {starting
            ? 'Starting…'
            : done
              ? 'Retake the four photos'
              : 'Take the four photos'}
        </ECButton>
      )}

      <div style={{ height: 10 }} />

      <ECButton full variant="ghost" onClick={() => setNotice('Assessor handoff coming soon')}>
        Or go straight to an accredited assessor
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
        Either way, everything on this screen stays yours.
      </p>

      {capturing && (
        <CaptureFlow onClose={() => setCapturing(false)} onComplete={handleComplete} />
      )}
      {notice && <ComingSoonModal message={notice} onClose={() => setNotice(null)} />}
    </ECCard>
  )
}

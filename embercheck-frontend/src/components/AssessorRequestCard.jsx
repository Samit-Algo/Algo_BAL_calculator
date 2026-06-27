import { ECCard } from './ui/ECCard'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'

// The consumer's "respond to your assessor" surface. When an assessor sends a
// case back asking for more photos (NEEDS_MORE_PHOTOS / legacy CHANGES_REQUESTED)
// or flags a site visit / specialist referral, the dashboard shows the reason but
// gives no way to act. This card — rendered at the top of the resumed property's
// result view — closes that loop: it explains the request and, for photo requests,
// opens the boundary per-side capture so the consumer can supply evidence. Adding
// a photo to a requested side auto-returns the case to the assessor (handled
// server-side); `justResumed` then flips this into a confirmation.

const PHOTO_REQUEST_STATUSES = new Set(['NEEDS_MORE_PHOTOS', 'CHANGES_REQUESTED'])
const INFO_STATUSES = new Set(['SITE_VISIT_REQUIRED', 'REFERRED_SPECIALIST'])

const HEADINGS = {
  NEEDS_MORE_PHOTOS: 'Your assessor needs more photos',
  CHANGES_REQUESTED: 'Your assessor requested changes',
  SITE_VISIT_REQUIRED: 'An on-site inspection is required',
  REFERRED_SPECIALIST: 'Referred for specialist review',
}

export default function AssessorRequestCard({ status, reason, sides = [], justResumed, onAddPhotos }) {
  // Confirmation state after the consumer supplied evidence and the case went
  // back into review automatically.
  if (justResumed) {
    return (
      <ECCard>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
          <span style={{ color: 'var(--euc-deep)', display: 'inline-flex' }}>
            <Glyph name="check" size={20} />
          </span>
          <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--ink)' }}>
            Sent back to your assessor
          </div>
        </div>
        <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>
          Thanks — your new photos are in and your assessor has been notified. They’ll pick the
          review back up. You can track it in My Properties.
        </p>
      </ECCard>
    )
  }

  const isPhotoRequest = PHOTO_REQUEST_STATUSES.has(status)
  const isInfo = INFO_STATUSES.has(status)
  if (!isPhotoRequest && !isInfo) return null

  return (
    <ECCard>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <span style={{ color: '#7a5418', display: 'inline-flex' }}>
          <Glyph name="info" size={18} />
        </span>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 19, color: 'var(--ink)' }}>
          {HEADINGS[status] || 'Your assessor has a request'}
        </div>
      </div>

      {reason && (
        <p style={{ margin: '0 0 12px', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink)' }}>
          “{reason}”
        </p>
      )}

      {isPhotoRequest && (
        <>
          {sides.length > 0 && (
            <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
              Please add photos for: <strong style={{ color: 'var(--ink)' }}>{sides.join(', ')}</strong>
            </p>
          )}
          <ECButton full icon="camera" onClick={onAddPhotos}>
            Add the requested photos
          </ECButton>
          <p style={{ margin: '10px 4px 0', fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink-soft)', textAlign: 'center' }}>
            We’ll open your site boundary so you can capture each side. Once you add them, the case
            goes straight back to your assessor.
          </p>
        </>
      )}

      {isInfo && (
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
          No action is needed in the app right now — your assessor will be in touch about next steps.
        </p>
      )}
    </ECCard>
  )
}

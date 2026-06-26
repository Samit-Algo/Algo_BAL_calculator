// Photo review — the workspace's "Photo review" tab. Layout/typography from the
// mockup's console/gaps.jsx (GapsScreen / PhotoTile / ResolvedCard); ALL content
// and the PHOTO DISPLAY are live.
//
// Photo display mirrors the consumer app's proven structure
// (embercheck-frontend BoundaryResultPanel + lib/cases.getSectorPhotoURL):
//   • the parent fetches EVERY photo for a side into one thumbMap keyed by
//     photo_id (via apiFetch → blob → object URL, so the Bearer token is sent),
//   • object URLs are revoked once, when the map changes (not per-tile),
//   • a tile renders the real <img> only when its URL is ready; while loading or
//     if the image is genuinely unavailable it shows a NEUTRAL state — never a
//     decorative gradient that could be mistaken for a photo,
//   • clicking a thumbnail opens it full-size (the consumer's photo viewer).
//
// CONSOLE-F3.1 — Photo review is now the assessor's PRIMARY review surface:
// every card carries the full decision chain (Draft → AI → Consumer → Assessor →
// Current), a live review-state chip, and working Confirm / Override / Remove
// override actions. All writes reuse the SAME handlers as the Workspace (passed
// down via `actions`), so the two screens stay in lock-step. No BAL is computed
// here — the backend reconciles and is the single source of truth.
import { useEffect, useState } from 'react'
import { getSectorPhoto } from '../lib/consoleApi'
import { CBALChip, CBadge, CSectionLabel, CBtn, FlagChip } from '../components/atoms'
import { Glyph } from '../components/Glyph'
import { confBand } from '../lib/bal'
import { OverrideEditor, hasAssessorOverride } from '../components/OverrideEditor'

// Human titles for the backend's review-flag tokens (presentation only — the
// tokens themselves are live). An unmapped token falls back to a generic title.
const FLAG_TITLE = {
  uncertain_vegetation: 'vegetation condition unconfirmed',
  photo_lower_than_draft_review: 'photo reads lower than the map draft',
  override_lower_than_draft_review: 'override is lower than the draft/photo',
  photo_vegetation_no_distance_review: 'photo found vegetation but no distance',
  needs_distance: 'distance required',
  geometry_overridden: 'geometry overridden',
}

const VEG_SOURCE_LABEL = { photo: 'site photo', gis_draft: 'SVTM aerial draft', override: 'assessor override' }
const LOW_CONF_TOKENS = new Set(['unknown', 'cant_tell', "can't tell"])

// The actual photo class that triggered the conservative fallback (so the note
// reflects the real read — not a fixed string). Null when not forced.
function forcedReason(s) {
  if (s.combined_classification !== 'Forest') return null
  for (const p of s.photos || []) {
    const ap = p.ai_proposal
    if (!ap) continue
    const cls = (ap.vegetation_class || '').toLowerCase()
    if (LOW_CONF_TOKENS.has(cls) || (ap.confidence ?? 0) < 0.7) return ap.vegetation_class || 'low-confidence read'
  }
  return null
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

// Consumer-pattern photo loader: fetch every photo for a side into a
// { photo_id: objectURL } map; track per-photo status; revoke on change. All
// setState happens after the awaits (a missing entry → 'missing'; the default,
// before any entry, is treated as 'loading' by the tile), so the effect never
// sets state synchronously.
function useSideThumbs(caseId, side, photos) {
  const [thumbMap, setThumbMap] = useState({})
  const [statusMap, setStatusMap] = useState({}) // photo_id -> 'ready' | 'missing'

  const ids = (photos || []).map((p) => p.photo_id).join(',')
  useEffect(() => {
    const list = photos || []
    if (!caseId || list.length === 0) return
    let cancelled = false
    ;(async () => {
      const entries = await Promise.all(
        list.map(async (p) => (p.photo_id ? [p.photo_id, await getSectorPhoto(caseId, side, p.photo_id)] : null)),
      )
      if (cancelled) {
        entries.forEach((e) => e && e[1] && URL.revokeObjectURL(e[1]))
        return
      }
      const next = {}
      const status = {}
      for (const e of entries) {
        if (!e) continue
        const [id, url] = e
        status[id] = url ? 'ready' : 'missing'
        if (url) next[id] = url
      }
      setThumbMap(next)
      setStatusMap(status)
    })()
    return () => {
      cancelled = true
    }
    // `ids` is a stable digest of `photos` (so a new array identity with the same
    // photo_ids doesn't re-fetch); caseId/side are the scope.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [caseId, side, ids])

  // Revoke this map's object URLs when it changes / on unmount.
  useEffect(() => () => Object.values(thumbMap).forEach((u) => URL.revokeObjectURL(u)), [thumbMap])

  return { thumbMap, statusMap }
}

// One photo tile: the real <img> when ready; an honest neutral state otherwise.
function PhotoTile({ url, status, label, tall, onView }) {
  const height = tall ? 190 : 150
  const frame = {
    flex: 1,
    minWidth: 0,
    height,
    borderRadius: 10,
    position: 'relative',
    overflow: 'hidden',
    boxShadow: 'inset 0 0 0 1px rgba(40,36,24,.18)',
    background: 'var(--panel)',
  }
  if (status === 'ready' && url) {
    return (
      <button type="button" onClick={() => onView?.(url)} aria-label="View photo full size" style={{ ...frame, padding: 0, border: 'none', cursor: 'zoom-in' }}>
        <img src={url} alt="site photo" style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
        {label && (
          <span className="cs-mono" style={{ position: 'absolute', left: 8, bottom: 8, padding: '3px 8px', borderRadius: 7, background: 'rgba(34,30,18,0.62)', color: '#F7F2E2', fontSize: 10 }}>
            {label}
          </span>
        )}
      </button>
    )
  }
  // loading / missing — neutral, clearly NOT a photo
  return (
    <div style={{ ...frame, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 6, color: 'var(--ink-soft)' }}>
      <Glyph name={status === 'missing' ? 'info' : 'camera'} size={20} style={{ opacity: 0.5 }} />
      <span style={{ fontSize: 12 }}>{status === 'missing' ? 'Photo unavailable' : 'Loading photo…'}</span>
    </div>
  )
}

// Full-size viewer overlay (the consumer's PhotoViewer, minimal).
function PhotoViewer({ url, onClose }) {
  if (!url) return null
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(20,18,10,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 32, cursor: 'zoom-out' }}
    >
      <img src={url} alt="site photo full size" style={{ maxWidth: '92vw', maxHeight: '90vh', borderRadius: 10, boxShadow: '0 20px 60px rgba(0,0,0,0.5)' }} />
    </div>
  )
}

// The per-photo AI read (its own proposal).
function PhotoRead({ photo, index }) {
  const ap = photo.ai_proposal
  return (
    <div style={{ width: 260, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 7 }}>
      <CSectionLabel>Vision read — photo {index + 1}</CSectionLabel>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)' }}>{ap?.vegetation_class || 'No read returned'}</span>
        {ap ? <CBadge conf={confBand(ap.confidence)} /> : null}
      </div>
      <div style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
        {ap?.reasoning || 'The vision model returned no reasoning for this photo.'}
      </div>
      <div className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>
        {[ap?.model_version, fmtDate(photo.captured_at)].filter(Boolean).join(' · ')}
      </div>
    </div>
  )
}

// Live review-state chip (§5). Reuses the mockup's CRowStatus colour system, just
// with the review-state wording the brief asks for.
const REVIEW_STATE = {
  overridden: { label: 'Overridden', color: '#93431F', dashed: false },
  reviewed: { label: 'Reviewed', color: 'var(--euc-deep)', dashed: false },
  awaiting: { label: 'Awaiting review', color: 'var(--ink-soft)', dashed: true },
}
function reviewState(sector) {
  if (hasAssessorOverride(sector)) return 'overridden'
  if (sector.reviewed) return 'reviewed'
  return 'awaiting'
}
function ReviewStateChip({ sector }) {
  const s = REVIEW_STATE[reviewState(sector)]
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 99,
        fontSize: 10.5,
        fontWeight: 700,
        color: s.color,
        border: (s.dashed ? '1.2px dashed ' : '1.2px solid ') + 'currentColor',
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  )
}

// One step in the decision chain. `tone`: 'neutral' (draft/AI) | 'accent'
// (assessor) | 'current' (the governing value).
function ChainStep({ label, value, badge, note, tone = 'neutral' }) {
  const current = tone === 'current'
  const accent = tone === 'accent'
  return (
    <div
      style={{
        padding: '8px 11px',
        borderRadius: 9,
        background: current
          ? 'color-mix(in oklab, var(--euc-deep) 11%, transparent)'
          : accent
            ? 'color-mix(in oklab, var(--ochre) 14%, transparent)'
            : 'color-mix(in oklab, var(--ink) 5%, transparent)',
        border: current ? '1.5px solid var(--euc-deep)' : '1px solid var(--line)',
      }}
    >
      <CSectionLabel>{label}</CSectionLabel>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: 3 }}>
        <span style={{ fontSize: current ? 14 : 13, fontWeight: current ? 800 : 700, color: 'var(--ink)' }}>{value}</span>
        {badge}
      </div>
      {note ? <div style={{ fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.4, marginTop: 3 }}>{note}</div> : null}
    </div>
  )
}

function ChainArrow() {
  return (
    <div style={{ display: 'flex', justifyContent: 'center', color: 'var(--ink-soft)', margin: '-1px 0' }}>
      <Glyph name="arrowRight" size={14} style={{ transform: 'rotate(90deg)', opacity: 0.6 }} />
    </div>
  )
}

// The full evidence chain (§3): GIS Draft → AI → Consumer override (if any) →
// Assessor override (if any) → Current effective. Previous decisions are NEVER
// replaced — the AI read in particular stays visible permanently (§7).
function DecisionChain({ sector }) {
  const photos = sector.photos || []
  const govPhoto = photos.find((p) => p.ai_proposal)
  const aiClass = sector.combined_classification || govPhoto?.ai_proposal?.vegetation_class
  const aiConf = sector.combined_confidence != null ? sector.combined_confidence : govPhoto?.ai_proposal?.confidence
  const ov = sector.overrides
  const overridden = hasAssessorOverride(sector)
  // No consumer-override layer exists on a boundary side in the data model yet, so
  // this step renders only "if any" — never faked.
  const consumer = sector.consumer_override?.vegetation_class

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <ChainStep label="GIS draft · SVTM" value={sector.gis_draft_classification || 'no mapped hazard'} />
      <ChainArrow />
      <ChainStep
        label="AI proposal"
        value={aiClass || 'no read returned'}
        badge={aiConf != null ? <CBadge conf={confBand(aiConf)} /> : null}
        note={sector.combined_reasoning || undefined}
      />
      {consumer ? (
        <>
          <ChainArrow />
          <ChainStep label="Consumer override" value={consumer} />
        </>
      ) : null}
      {overridden ? (
        <>
          <ChainArrow />
          <ChainStep
            label="Assessor override"
            tone="accent"
            value={ov.vegetation_class || '(inputs adjusted)'}
            note={[ov.reason ? `“${ov.reason}”` : null, ov.override_by].filter(Boolean).join(' · ') || undefined}
          />
        </>
      ) : null}
      <ChainArrow />
      <ChainStep
        label="Current effective"
        tone="current"
        value={sector.effective_classification || 'no mapped hazard'}
        badge={<CBALChip bal={sector.final_bal} suggested />}
      />
    </div>
  )
}

// The photo card for ANY side that has photos — flagged or not. It ALWAYS shows
// every uploaded photo + AI analysis; review flags only change the annotations
// (warning chips + conservative note) vs the "AI agrees with mapping" state.
// Confirm / Override / Remove override write through the SHARED handlers (§2/§4).
function GapCard({ caseId, sector, onView, actions }) {
  const side = sector.compass_side
  const flags = sector.review_flags || []
  const photos = sector.photos || []
  const flagged = flags.length > 0
  const primary = flags[0]
  const reason = forcedReason(sector)
  const headConf = sector.combined_confidence != null ? sector.combined_confidence : photos[0]?.ai_proposal?.confidence
  const headBand = confBand(headConf)
  const { thumbMap, statusMap } = useSideThumbs(caseId, side, photos)

  const { busy, editing, formError, onConfirm, onOverrideOpen, onOverrideClose, onOverrideSave, onRemoveOverride } = actions || {}
  const reviewed = !!sector.reviewed
  const overridden = hasAssessorOverride(sector)
  const busyHere = busy?.side === side
  const confirming = busyHere && busy.kind === 'confirm'
  const saving = busyHere && busy.kind === 'override'
  const removing = busyHere && busy.kind === 'remove'
  const isEditing = editing === side
  const sideError = formError && formError.side === side ? formError.message : null
  const lock = !!busy

  return (
    <div className="cs-card" style={{ padding: '16px 18px', borderColor: flagged ? '#B06F3A' : 'var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ width: 7, height: 7, borderRadius: 99, background: flagged ? '#B06F3A' : 'var(--euc-deep)' }} />
          <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
            {side} — {flagged ? (FLAG_TITLE[primary] || 'needs your judgment') : 'AI agrees with public mapping'}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {headBand ? <CBadge conf={headBand} /> : null}
          <ReviewStateChip sector={sector} />
        </div>
      </div>

      {photos.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 12 }}>
          {photos.map((photo, i) => (
            <div key={photo.photo_id} style={{ display: 'flex', gap: 12 }}>
              <PhotoTile
                url={thumbMap[photo.photo_id]}
                status={statusMap[photo.photo_id] || 'loading'}
                tall={photos.length === 1}
                onView={onView}
                label={`Site photo ${side[0]}${photos.length > 1 ? ' · ' + (i + 1) : ''}${photo.captured_at ? ' · ' + fmtDate(photo.captured_at) : ''}`}
              />
              <PhotoRead photo={photo} index={i} />
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 12 }}>
          No site photo on file for this side — this flag was raised from the map draft.
        </div>
      )}

      {/* full evidence chain (§3/§6) — Draft / AI / Current clearly separated */}
      <div style={{ borderTop: '1px solid var(--line)', paddingTop: 12, marginBottom: 10 }}>
        <DecisionChain sector={sector} />
      </div>

      {/* side outcome — provenance, conservative note, flags (all live) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
        <div className="cs-mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          vegetation source: {VEG_SOURCE_LABEL[sector.value_sources?.vegetation] || sector.value_sources?.vegetation || '—'}
        </div>

        {reason && (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5, fontWeight: 600, color: '#93431F' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: '#B06F3A', flexShrink: 0 }} />
            AI read “{reason}” → kept conservative as {sector.combined_classification}
          </div>
        )}

        {flagged ? (
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {flags.map((f) => (
              <FlagChip key={f} label={f} />
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5, fontWeight: 600, color: 'var(--euc-deep)' }}>
            <Glyph name="check" size={14} stroke={2.6} />
            AI agrees with the public mapping — no flags raised. Inspect the photo and confirm.
          </div>
        )}
      </div>

      {/* live review actions (§2/§4) — same handlers as the Workspace */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', marginTop: 12 }}>
        <CBtn
          variant="primary"
          onClick={() => onConfirm?.(side)}
          disabled={reviewed || lock}
          title={reviewed ? 'This elevation has been reviewed' : 'Confirm the calculated assessment for this elevation'}
          style={{ minHeight: 30, fontSize: 12 }}
        >
          {reviewed ? 'Reviewed' : confirming ? 'Confirming…' : `Confirm: ${sector.effective_classification || sector.gis_draft_classification || 'class'}`}
        </CBtn>
        <CBtn
          variant="quiet"
          onClick={() => (isEditing ? onOverrideClose?.() : onOverrideOpen?.(side))}
          disabled={lock}
          style={{ minHeight: 30, fontSize: 12 }}
        >
          {isEditing ? 'Close' : 'Different read — override'}
        </CBtn>
        {overridden ? (
          <CBtn
            variant="ghost"
            onClick={() => onRemoveOverride?.(side)}
            disabled={lock}
            title="Remove the assessor override and revert to the calculated value"
            style={{ minHeight: 30, fontSize: 12, color: '#93431F' }}
          >
            {removing ? 'Reverting…' : 'Remove override'}
          </CBtn>
        ) : null}
      </div>

      {sideError && !isEditing && (
        <div style={{ marginTop: 10, padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600 }}>
          {sideError}
        </div>
      )}

      {isEditing && (
        <OverrideEditor
          sector={sector}
          saving={saving}
          error={sideError}
          onCancel={onOverrideClose}
          onSave={(changed, r) => onOverrideSave?.(side, changed, r)}
        />
      )}
    </div>
  )
}

export function PhotoReview({ caseId, data, actions }) {
  const sectors = data.sectors || []
  // PHOTO review, not flag review: every side with photos gets a full card
  // (flagged or not). Only sides with NO photos fall to the summary line.
  const withPhotos = sectors.filter((s) => (s.photos || []).length > 0)
  const noPhotos = sectors.filter((s) => (s.photos || []).length === 0)
  const flaggedCount = withPhotos.filter((s) => (s.review_flags || []).length > 0).length
  const reviewedCount = withPhotos.filter((s) => s.reviewed).length
  const [viewerUrl, setViewerUrl] = useState(null)

  return (
    <div className="ec-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '22px 28px 48px' }}>
        <div style={{ marginBottom: 16, display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '0 0 3px', color: 'var(--ink)' }}>Photo review</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              {withPhotos.length === 0
                ? 'No site photos submitted for this case yet.'
                : `${withPhotos.length} side${withPhotos.length > 1 ? 's' : ''} with photos · ` +
                  (flaggedCount > 0
                    ? `${flaggedCount} need${flaggedCount === 1 ? 's' : ''} your judgment. The system proposes — you decide.`
                    : 'AI agrees with the public mapping. Inspect each photo and confirm.')}
            </div>
          </div>
          {withPhotos.length > 0 && (
            <div style={{ textAlign: 'right', flexShrink: 0 }}>
              <div className="cs-mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
                {reviewedCount}<span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>/{withPhotos.length}</span>
              </div>
              <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>reviewed</div>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {withPhotos.map((s) => (
            <GapCard key={s.compass_side} caseId={caseId} sector={s} onView={setViewerUrl} actions={actions} />
          ))}

          {noPhotos.length > 0 && (
            <div className="cs-card" style={{ padding: '13px 16px', fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
              <strong style={{ color: 'var(--ink)' }}>{noPhotos.map((s) => s.compass_side).join(', ')}</strong>{' '}
              — no site photos submitted. These sides rest on the SVTM draft until photos are added.
            </div>
          )}
        </div>
      </div>

      <PhotoViewer url={viewerUrl} onClose={() => setViewerUrl(null)} />
    </div>
  )
}

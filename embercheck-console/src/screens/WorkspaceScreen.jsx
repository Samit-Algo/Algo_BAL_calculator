// Assessor workspace — the mockup's TWO-PANE cockpit, rebuilt from the extracted
// bundle and fed live by GET /console/cases/{id} (CONSOLE-B2). READ-ONLY.
//
// Rebuilt from:
//   • console/workspace.jsx  → WorkspaceScreen (left map pane + right evidence
//     panel: overall strip, N/E/S/W elevation selector, per-elevation EvidenceRows,
//     "resolves to" block, flagged-items footer).
//   • console/app.jsx (shell) → the job header (title + status/BAL + Report
//     preview) and the Workspace · Photo review · Audit trail · Report & sign-off
//     tab row.
//   • console/shared.jsx + embercheck/shared.jsx → CBALChip, CBadge, CRowStatus,
//     CStatusChip, CSectionLabel, CBtn, Glyph.
//
// Two deliberate departures from the mockup, both per the brief:
//   • the faux-satellite + demo geometry is omitted — the left pane is a neutral
//     placeholder sized/positioned exactly as the mockup, with the N/E/S/W markers.
//   • every action is inert (read-only); the non-Workspace tabs select + show a
//     "coming next" placeholder but keep their styling/hover/selected state.
import { useEffect, useState } from 'react'
import { getCase, confirmSector, overrideSector, removeOverride, updateStatus } from '../lib/consoleApi'
import {
  CStatusChip,
  CSectionLabel,
  CBtn,
  CBALChip,
  CBadge,
  CRowStatus,
} from '../components/atoms'
import { Glyph } from '../components/Glyph'
import { confBand } from '../lib/bal'
import AssessmentMap from '../components/AssessmentMap'
import { useIsMobile } from '../lib/useIsMobile'
import { OverrideEditor, effectiveVeg, hasAssessorOverride } from '../components/OverrideEditor'
import { PhotoReview } from './PhotoReview'
import { AuditTrail } from './AuditTrail'
import { ReportSignoff } from './ReportSignoff'

const SIDES = ['North', 'East', 'South', 'West']
const SIDE_INITIAL = { North: 'N', East: 'E', South: 'S', West: 'W' }

// Source-meta lines synthesised from value_sources — the same provenance strings
// the mockup's CSourceMeta shows (SVTM 2019/5 m, LiDAR 2022/1 m, cadastre 2024).
const VEG_META = { gis_draft: 'NSW SVTM aerial · 2019 · 5 m', photo: 'Site photo · vision read', override: 'Assessor override' }
const SLOPE_META = { dem: 'LiDAR DEM · 2022 · 1 m', override: 'Assessor override' }
const DIST_META = { gis: 'Cadastre + vegetation edge · 2024 · ±1 m', override: 'Assessor override' }

const LOW_CONF_TOKENS = new Set(['unknown', 'cant_tell', "can't tell"])

// Safety rule fired: combined is Forest but a photo read was Unknown/cant_tell or < 0.7.
function forcedConservative(s) {
  if (s.combined_classification !== 'Forest') return false
  return (s.photos || []).some((p) => {
    const ap = p.ai_proposal
    if (!ap) return false
    const cls = (ap.vegetation_class || '').toLowerCase()
    return LOW_CONF_TOKENS.has(cls) || (ap.confidence ?? 0) < 0.7
  })
}

const TABS = [
  ['workspace', 'Workspace'],
  ['photo', 'Photo review'],
  ['audit', 'Audit trail'],
  ['report', 'Report & sign-off'],
]

// ── case-level review status (CONSOLE-B3.2) ─────────────────────────────────
// The settable lifecycle targets (mirrors the backend's SETTABLE_STATUSES) and
// which of them require a typed reason. No status logic is computed here — the
// backend validates, gates READY_TO_SIGN, and records the audit event.
const SETTABLE_STATUS = [
  ['UNDER_REVIEW', 'Under review'],
  ['NEEDS_MORE_PHOTOS', 'Needs more photos'],
  ['SITE_VISIT_REQUIRED', 'Site visit required'],
  ['REFERRED_SPECIALIST', 'Referred to specialist'],
  ['READY_TO_SIGN', 'Ready to sign'],
]
const REASON_REQUIRED_STATUS = new Set(['NEEDS_MORE_PHOTOS', 'SITE_VISIT_REQUIRED', 'REFERRED_SPECIALIST'])
const STATUS_LABEL = {
  SUBMITTED_TO_ASSESSOR: 'Submitted to assessor', ANALYSIS_COMPLETE: 'Analysis complete', DRAFT: 'Draft',
  UNDER_REVIEW: 'Under review', NEEDS_MORE_PHOTOS: 'Needs more photos', SITE_VISIT_REQUIRED: 'Site visit required',
  REFERRED_SPECIALIST: 'Referred to specialist', READY_TO_SIGN: 'Ready to sign', CHANGES_REQUESTED: 'Needs more photos',
  APPROVED: 'Ready to sign', COMPLETE: 'Signed · issued',
}

function ReviewStatusPanel({ data, busy, error, onUpdate }) {
  const current = data.status
  const [target, setTarget] = useState(SETTABLE_STATUS.some(([v]) => v === current) ? current : 'UNDER_REVIEW')
  const [reason, setReason] = useState('')
  const [sides, setSides] = useState([])

  const needsReason = REASON_REQUIRED_STATUS.has(target)
  const isPhotos = target === 'NEEDS_MORE_PHOTOS'
  const wantsReady = target === 'READY_TO_SIGN'
  const blockers = data.ready_to_sign_blockers || []
  const readyBlocked = wantsReady && !data.can_ready_to_sign

  const reasonOk = !needsReason || reason.trim().length > 0
  const canUpdate = !busy && reasonOk && !readyBlocked && target !== current

  const toggleSide = (s) =>
    setSides((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  const allSelected = SIDES.every((s) => sides.includes(s))

  function submit() {
    const payload = { status: target }
    if (reason.trim()) payload.reason = reason.trim()
    if (isPhotos) payload.photo_request_sides = allSelected ? [] : sides
    onUpdate(payload)
  }

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)', background: 'color-mix(in oklab, var(--euc-deep) 4%, transparent)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 9 }}>
        <CSectionLabel>Review status</CSectionLabel>
        <CStatusChip state={data.ui_state} />
      </div>

      <div style={{ display: 'flex', gap: 7, alignItems: 'center', marginBottom: needsReason || isPhotos ? 9 : 9 }}>
        <select
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          disabled={busy}
          style={{ flex: 1, minHeight: 32, padding: '5px 9px', borderRadius: 8, border: '1px solid color-mix(in oklab, var(--ink) 22%, transparent)', background: 'var(--panel)', color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 12.5 }}
        >
          {SETTABLE_STATUS.map(([v, label]) => (
            <option key={v} value={v}>{label}{v === current ? ' (current)' : ''}</option>
          ))}
        </select>
        <CBtn variant="primary" onClick={submit} disabled={!canUpdate} style={{ minHeight: 32, fontSize: 12 }}>
          {busy ? 'Updating…' : 'Update status'}
        </CBtn>
      </div>

      <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginBottom: 9, lineHeight: 1.4 }}>
        Status advances automatically as you review (→ Under review on first action, → Ready to sign once every elevation is reviewed). Use this only to override or request more from the client.
      </div>

      {isPhotos && (
        <div style={{ marginBottom: 9 }}>
          <CSectionLabel style={{ marginBottom: 5 }}>Photos needed from</CSectionLabel>
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <button type="button" className="ec-press" onClick={() => setSides(allSelected ? [] : [...SIDES])} disabled={busy}
              style={{ padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: 700, border: '1px solid color-mix(in oklab, var(--ink) 20%, transparent)', background: allSelected ? 'var(--euc-deep)' : 'transparent', color: allSelected ? 'var(--paper)' : 'var(--ink-soft)' }}>
              All
            </button>
            {SIDES.map((s) => {
              const on = sides.includes(s)
              return (
                <button key={s} type="button" className="ec-press" onClick={() => toggleSide(s)} disabled={busy}
                  style={{ padding: '4px 11px', borderRadius: 99, cursor: 'pointer', fontFamily: 'var(--font-ui)', fontSize: 11.5, fontWeight: 700, border: '1px solid color-mix(in oklab, var(--ink) 20%, transparent)', background: on ? 'var(--euc-deep)' : 'transparent', color: on ? 'var(--paper)' : 'var(--ink-soft)' }}>
                  {s}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 4 }}>None selected = any side.</div>
        </div>
      )}

      {needsReason && (
        <div style={{ marginBottom: 9 }}>
          <CSectionLabel style={{ marginBottom: 4 }}>Reason <span style={{ color: '#93431F' }}>· required</span></CSectionLabel>
          <textarea
            rows={2}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            disabled={busy}
            placeholder="Shown to the client and recorded in the audit trail."
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 46, resize: 'vertical', padding: '6px 9px', borderRadius: 8, border: '1px solid color-mix(in oklab, var(--ink) 22%, transparent)', background: 'var(--panel)', color: 'var(--ink)', fontFamily: 'var(--font-ui)', fontSize: 12.5, lineHeight: 1.45 }}
          />
        </div>
      )}

      {readyBlocked && blockers.length > 0 && (
        <div style={{ marginBottom: 4, padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600, lineHeight: 1.45 }}>
          {blockers.join(' ')}
        </div>
      )}

      {error && (
        <div style={{ padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600 }}>
          {error}
        </div>
      )}

      {data.review_reason && !error && (
        <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
          <strong style={{ color: 'var(--ink)' }}>Current request:</strong> {data.review_reason}
          {(data.photo_request_sides || []).length > 0 ? ` (${data.photo_request_sides.join(', ')})` : ''}
        </div>
      )}
    </div>
  )
}

// ── review summary (CONSOLE-F3.3) — progress bar, outstanding checklist and the
// "why can't I sign?" panel. Every value is DERIVED BY THE BACKEND and rendered
// verbatim (no React-side calculation, §8). ────────────────────────────────────
const OCHRE = '#93431F'
// Checklist keys that represent an open case-level request (vs. an elevation
// review) — rendered with a warning marker rather than a hollow ring.
const REQUEST_KEYS = new Set(['photo_request', 'site_visit', 'specialist'])

function ChecklistMarker({ complete, request }) {
  if (complete) {
    return (
      <span style={{ display: 'flex', color: 'var(--euc-deep)', flexShrink: 0 }}>
        <Glyph name="check" size={14} stroke={2.6} />
      </span>
    )
  }
  if (request) {
    return <span style={{ width: 13, height: 13, borderRadius: 99, background: '#B06F3A', flexShrink: 0 }} />
  }
  return (
    <span style={{ width: 12, height: 12, borderRadius: 99, border: '1.8px solid color-mix(in oklab, var(--ink) 35%, transparent)', flexShrink: 0, boxSizing: 'border-box' }} />
  )
}

function ReviewSummary({ data }) {
  const progress = data.review_progress || { reviewed: 0, total: 0, percent: 0 }
  const checklist = data.review_checklist || []
  const blockers = data.ready_to_sign_blockers || []
  const ready = !!data.can_ready_to_sign
  // Collapsed by default — the assessor expands it when they want the progress
  // bar, outstanding tasks and blockers. The READY/NOT-READY pill stays visible
  // in the header either way.
  const [open, setOpen] = useState(false)

  return (
    <div style={{ padding: '12px 16px', borderBottom: '1px solid var(--line)' }}>
      <button
        type="button"
        className="ec-press"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: open ? 9 : 0, padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
      >
        <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
          <span style={{ display: 'flex', color: 'var(--ink-soft)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.18s ease' }}>
            <Glyph name="chevronRight" size={13} />
          </span>
          <CSectionLabel>Review summary</CSectionLabel>
        </span>
        <span style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.03em', color: ready ? 'var(--euc-deep)' : OCHRE }}>
          {ready ? 'READY FOR SIGN-OFF' : 'NOT READY'}
        </span>
      </button>

      {!open ? null : <>

      {/* progress bar — only meaningful when the case has elevations to review */}
      {progress.total > 0 && (
        <div style={{ marginBottom: 11 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 5 }}>
            <span style={{ fontSize: 11.5, fontWeight: 600, color: 'var(--ink-soft)' }}>Review progress</span>
            <span className="cs-mono" style={{ fontSize: 11.5, color: 'var(--ink)' }}>
              {progress.reviewed} / {progress.total} elevations reviewed
            </span>
          </div>
          <div style={{ height: 8, borderRadius: 99, background: 'color-mix(in oklab, var(--ink) 10%, transparent)', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${progress.percent}%`, borderRadius: 99, background: ready ? 'var(--euc-deep)' : 'var(--ochre)', transition: 'width 0.25s ease' }} />
          </div>
        </div>
      )}

      {/* outstanding tasks — the backend's review_checklist, rendered directly */}
      {checklist.length > 0 && (
        <div style={{ marginBottom: blockers.length ? 11 : 0 }}>
          <CSectionLabel style={{ marginBottom: 6 }}>Outstanding tasks</CSectionLabel>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {checklist.map((item) => {
              const request = REQUEST_KEYS.has(item.key)
              return (
                <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                  <ChecklistMarker complete={item.complete} request={request} />
                  <span style={{ fontSize: 12.5, color: item.complete ? 'var(--euc-deep)' : request ? OCHRE : 'var(--ink)' }}>
                    {item.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* why can't I sign? — driven entirely by backend blockers (§3) */}
      {!ready && blockers.length > 0 && (
        <div style={{ padding: '9px 11px', borderRadius: 9, background: 'color-mix(in oklab, #B06F3A 10%, transparent)' }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: OCHRE, marginBottom: 5 }}>Cannot sign yet</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {blockers.map((b, i) => (
              <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: '#7a3a1c', lineHeight: 1.4 }}>
                <span style={{ width: 5, height: 5, borderRadius: 99, background: '#B06F3A', flexShrink: 0, marginTop: 5 }} />
                {b}
              </div>
            ))}
          </div>
        </div>
      )}

      {ready && (
        <div style={{ padding: '9px 11px', borderRadius: 9, background: 'color-mix(in oklab, var(--euc-deep) 8%, transparent)', display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ display: 'flex', color: 'var(--euc-deep)' }}><Glyph name="check" size={15} stroke={2.6} /></span>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--euc-deep)' }}>
            All reviews complete — no outstanding requests. Ready for sign-off.
          </span>
        </div>
      )}

      </>}
    </div>
  )
}

// ── one read-only evidence row (mockup EvidenceRow idiom) ───────────────────
function EvidenceRow({ label, status, value, balChip, confBadge, sourceMeta, actions, children }) {
  return (
    <div style={{ padding: '11px 14px', borderBottom: '1px solid var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10, marginBottom: 3 }}>
        <CSectionLabel>{label}</CSectionLabel>
        {status ? <CRowStatus status={status} /> : null}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 4 }}>
        <span className="cs-mono" style={{ fontSize: 14.5, fontWeight: 600, color: 'var(--ink)' }}>{value}</span>
        {balChip}
        {confBadge}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
        <span className="cs-mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>{sourceMeta}</span>
        {actions ? <div style={{ display: 'flex', gap: 6 }}>{actions}</div> : null}
      </div>
      {children}
    </div>
  )
}

// ── right panel: one selected elevation ─────────────────────────────────────
function ElevationDetail({ sector, hasBoundary, busy, editing, onConfirm, onOverrideOpen, onOverrideClose, onOverrideSave, onRemoveOverride, formError }) {
  const side = sector.compass_side
  const vs = sector.value_sources || {}
  const veg = effectiveVeg(sector)
  const forced = forcedConservative(sector)
  const empty = !hasBoundary && !sector.gis_draft_classification && (sector.photos || []).length === 0

  if (empty) {
    return (
      <div style={{ padding: '16px 14px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
        No boundary evidence for this side.
      </div>
    )
  }

  const reviewed = !!sector.reviewed
  const overridden = hasAssessorOverride(sector)
  const vegStatus = overridden ? 'overridden' : reviewed ? 'confirmed' : 'suggested'
  const busyHere = busy?.side === side
  const confirming = busyHere && busy.kind === 'confirm'
  const saving = busyHere && busy.kind === 'override'
  const removing = busyHere && busy.kind === 'remove'
  const isEditing = editing === side
  // A write error scoped to THIS side (confirm/override/remove all surface here).
  const sideError = formError && formError.side === side ? formError.message : null
  // While any write is in flight, lock the other affordances (no concurrent edits).
  const lock = !!busy
  const inert = { minHeight: 26, fontSize: 11.5, padding: '0 10px' }
  const overrideBtn = (
    <CBtn
      variant="quiet"
      onClick={() => (isEditing ? onOverrideClose() : onOverrideOpen(side))}
      disabled={lock}
      style={inert}
    >
      {isEditing ? 'Close' : 'Override'}
    </CBtn>
  )
  // Remove-override (revert) — only when an assessor override layer exists. Drops
  // the override; the backend restores the calculated effective value.
  const removeBtn = overridden ? (
    <CBtn
      variant="ghost"
      onClick={() => onRemoveOverride(side)}
      disabled={lock}
      title="Remove the assessor override and revert to the calculated value"
      style={{ ...inert, color: '#93431F' }}
    >
      {removing ? 'Reverting…' : 'Remove override'}
    </CBtn>
  ) : null
  const slopeText =
    sector.effective_slope_degrees != null
      ? `${sector.effective_slope_degrees}°${sector.slope_direction ? ' ' + sector.slope_direction : ''}`
      : '—'

  return (
    <>
      <div style={{ padding: '12px 14px 8px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: 16.5, color: 'var(--ink)' }}>{side} elevation</div>
        {reviewed ? (
          <span style={{ fontSize: 11, color: 'var(--euc-deep)', fontWeight: 700 }}>
            Reviewed{sector.reviewed_by ? ` · ${sector.reviewed_by}` : ''}
          </span>
        ) : (
          <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>Awaiting your review</span>
        )}
      </div>

      {/* vegetation */}
      <EvidenceRow
        label="Vegetation classification"
        status={vegStatus}
        value={veg || 'no mapped hazard'}
        balChip={<CBALChip bal={sector.final_bal} suggested />}
        confBadge={sector.combined_confidence != null ? <CBadge conf={confBand(sector.combined_confidence)} /> : null}
        sourceMeta={VEG_META[vs.vegetation] || vs.vegetation || '—'}
        actions={
          <>
            <CBtn
              variant="primary"
              onClick={() => onConfirm(side)}
              disabled={reviewed || lock}
              title={reviewed ? 'This elevation has been reviewed' : 'Confirm the calculated assessment for this elevation'}
              style={inert}
            >
              {reviewed ? 'Reviewed' : confirming ? 'Confirming…' : 'Confirm'}
            </CBtn>
            {overrideBtn}
            {removeBtn}
          </>
        }
      >
        <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
          <strong style={{ color: 'var(--ink)' }}>Draft prior (SVTM):</strong>{' '}
          {sector.gis_draft_classification || 'no mapped hazard'}
        </div>

        {/* provenance honesty — mockup's "Photo proposes / Condition unconfirmed" idiom */}
        {forced ? (
          <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 9, background: 'color-mix(in oklab, #B06F3A 9%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>
              <strong style={{ color: '#93431F' }}>AI: Unknown → forced to Forest (conservative)</strong>
            </div>
            <CBtn variant="ghost" disabled title="Photo review lands in a later step" style={{ minHeight: 24, fontSize: 11.5, padding: '0 6px' }}>View photo →</CBtn>
          </div>
        ) : sector.combined_classification && sector.combined_classification !== sector.gis_draft_classification ? (
          <div style={{ marginTop: 8, padding: '9px 11px', borderRadius: 9, background: 'color-mix(in oklab, var(--euc-deep) 7%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
            <div style={{ fontSize: 12, color: 'var(--ink)', lineHeight: 1.4 }}>
              <strong>Photo proposes:</strong> {sector.combined_classification}{' '}
              <span className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>
                (site photo · {confBand(sector.combined_confidence) || 'low'} conf)
              </span>
            </div>
            <CBtn variant="ghost" disabled title="Photo review lands in a later step" style={{ minHeight: 24, fontSize: 11.5, padding: '0 6px' }}>View photo →</CBtn>
          </div>
        ) : null}

        {sector.combined_reasoning && (
          <div style={{ marginTop: 6, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.45 }}>
            <strong style={{ color: 'var(--ink)' }}>Why:</strong> {sector.combined_reasoning}
          </div>
        )}

        {(sector.review_flags || []).map((f) => (
          <div key={f} style={{ marginTop: 7, display: 'flex', gap: 7, alignItems: 'center', fontSize: 11.5, fontWeight: 600, color: '#93431F' }}>
            <span style={{ width: 7, height: 7, borderRadius: 99, background: '#B06F3A', flexShrink: 0 }} />
            {f}
          </div>
        ))}

        {sideError && !isEditing && (
          <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600 }}>
            {sideError}
          </div>
        )}

        {isEditing && (
          <OverrideEditor
            sector={sector}
            saving={saving}
            error={sideError}
            onCancel={onOverrideClose}
            onSave={(changed, reason) => onOverrideSave(side, changed, reason)}
          />
        )}
      </EvidenceRow>

      {/* effective slope */}
      <EvidenceRow
        label="Effective slope (toward hazard)"
        status={vs.slope === 'override' ? 'overridden' : 'derived'}
        value={slopeText}
        confBadge={vs.slope !== 'override' ? <CBadge conf="high" /> : null}
        sourceMeta={SLOPE_META[vs.slope] || vs.slope || '—'}
        actions={overrideBtn}
      />

      {/* separation distance */}
      <EvidenceRow
        label="Separation distance"
        status={vs.distance === 'override' ? 'overridden' : 'derived'}
        value={sector.distance_m != null ? `${sector.distance_m} m` : 'no distance'}
        confBadge={vs.distance !== 'override' && sector.distance_m != null ? <CBadge conf="high" /> : null}
        sourceMeta={DIST_META[vs.distance] || vs.distance || '—'}
        actions={overrideBtn}
      />

      {/* this elevation resolves to */}
      <div style={{ padding: '13px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <CSectionLabel style={{ marginBottom: 5 }}>This elevation resolves to</CSectionLabel>
          <CBALChip bal={sector.final_bal} size="lg" suggested />
        </div>
        <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--ink-soft)', textAlign: 'right', maxWidth: 210 }}>
          From {(veg || 'no mapped hazard').toLowerCase()} at {sector.distance_m != null ? `${sector.distance_m} m` : '—'},{' '}
          {slopeText} — construction requirements per the AS 3959 table for this level (your licensed copy governs).
        </div>
      </div>
    </>
  )
}

function RightPanel({ data, selected, setSelected, actions, statusActions, isMobile }) {
  const sectors = data.sectors
  const flags = sectors.reduce((n, s) => n + (s.review_flags || []).length, 0)
  const reviewedCount = sectors.filter((s) => s.reviewed).length
  const current = sectors.find((s) => s.compass_side === selected) || sectors[0]

  return (
    <div
      className={isMobile ? 'ec-scroll' : undefined}
      style={{
        width: isMobile ? '100%' : 472,
        flex: isMobile ? 1 : undefined,
        flexShrink: isMobile ? 1 : 0,
        minHeight: 0,
        overflowY: isMobile ? 'auto' : undefined,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--paper)',
        minWidth: 0,
        borderLeft: isMobile ? 'none' : '1px solid var(--line)',
        borderTop: isMobile ? '1px solid var(--line)' : 'none',
      }}
    >
      {/* case-level review status (CONSOLE-B3.2) — remounts on status change so the
          dropdown/reason reset cleanly */}
      <ReviewStatusPanel key={data.status} data={data} {...statusActions} />

      {/* review summary (CONSOLE-F3.3) — progress, outstanding tasks, blockers */}
      <ReviewSummary data={data} />

      {/* overall strip */}
      <div style={{ padding: '12px 16px 10px', borderBottom: '1px solid var(--line)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div>
          <CSectionLabel style={{ marginBottom: 4 }}>Overall — highest elevation</CSectionLabel>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <CBALChip bal={data.bal_rating} size="lg" suggested />
            <span style={{ fontSize: 11.5, color: 'var(--ink-soft)', lineHeight: 1.35 }}>
              Suggested — becomes a determination only when you sign
            </span>
          </div>
        </div>
        <div style={{ textAlign: 'right', flexShrink: 0 }}>
          <div className="cs-mono" style={{ fontSize: 18, fontWeight: 600, color: 'var(--ink)' }}>
            {reviewedCount}<span style={{ color: 'var(--ink-soft)', fontSize: 12 }}>/{sectors.length || 4}</span>
          </div>
          <div style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>reviewed</div>
        </div>
      </div>

      {/* elevation selector */}
      <div style={{ display: 'flex', borderBottom: '1px solid var(--line)' }}>
        {SIDES.map((side) => {
          const s = sectors.find((x) => x.compass_side === side)
          const sel = selected === side
          const flagged = (s?.review_flags || []).length > 0
          const reviewed = !!s?.reviewed
          return (
            <button
              key={side}
              className="ec-press"
              onClick={() => setSelected(side)}
              style={{
                flex: 1,
                padding: '9px 4px 8px',
                cursor: 'pointer',
                border: 'none',
                background: sel ? 'var(--panel)' : 'transparent',
                borderBottom: sel ? '2.5px solid var(--ochre)' : '2.5px solid transparent',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 3,
                fontFamily: 'var(--font-ui)',
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 13, fontWeight: 800, color: sel ? 'var(--ink)' : 'var(--ink-soft)' }}>
                {SIDE_INITIAL[side]}
                {flagged ? (
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: '#B06F3A' }} />
                ) : reviewed ? (
                  <span style={{ display: 'flex', color: 'var(--euc-deep)' }}><Glyph name="check" size={11} stroke={2.6} /></span>
                ) : null}
              </span>
              <CBALChip bal={s?.final_bal} suggested />
            </button>
          )
        })}
      </div>

      {/* selected elevation — on phones the whole shell scrolls, so this pane
          flows naturally rather than owning its own scroll region. */}
      <div className="ec-scroll" style={isMobile ? {} : { flex: 1, overflowY: 'auto' }}>
        <ElevationDetail sector={current} hasBoundary={data.has_boundary} {...actions} />
        {flags > 0 && (
          <div style={{ margin: '4px 14px 16px', padding: '10px 12px', borderRadius: 10, background: 'color-mix(in oklab, #B06F3A 10%, transparent)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#93431F' }}>
              {flags} flagged item{flags > 1 ? 's' : ''} across elevations
            </span>
            <CBtn variant="ochre" disabled title="Photo review lands in a later step" style={{ minHeight: 26, fontSize: 11.5 }}>Resolve in photo review</CBtn>
          </div>
        )}
      </div>
    </div>
  )
}

// Top-left N/E/S/W selector overlay — the mockup's left-pane elevation buttons,
// kept on top of the live map (selecting a side highlights its boundary edge).
function ElevationButtons({ sectors, selected, setSelected, zIndex }) {
  return (
    <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, zIndex }}>
      {SIDES.map((side) => {
        const s = sectors.find((x) => x.compass_side === side)
        const flagged = (s?.review_flags || []).length > 0
        const sel = selected === side
        return (
          <button
            key={side}
            className="ec-press"
            onClick={() => setSelected(side)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '5px 10px',
              borderRadius: 9,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 12,
              fontWeight: 700,
              background: sel ? 'var(--ochre)' : 'rgba(34,30,18,0.6)',
              color: sel ? '#241A0C' : '#F7F2E2',
              border: 'none',
            }}
          >
            {SIDE_INITIAL[side]}
            {flagged && <span style={{ width: 6, height: 6, borderRadius: 99, background: sel ? '#93431F' : '#E0A463' }} />}
          </button>
        )
      })}
    </div>
  )
}

// ── left pane: the SAME Leaflet map the consumer app draws (read-only), fed by
// the geometry CONSOLE-B2 now surfaces. Falls back to a neutral placeholder for
// a point-only case that carries no boundary geometry. ──────────────────────
function LeftCanvas({ data, selected, setSelected, isMobile }) {
  const hasGeometry = !!data.geometry?.property_point
  // On phones the map becomes a fixed-height band stacked above the evidence
  // panel; on desktop it fills the left half of the cockpit.
  const frame = isMobile
    ? { height: 240, position: 'relative', flexShrink: 0, overflow: 'hidden' }
    : { flex: 1, position: 'relative', minWidth: 380, overflow: 'hidden' }

  if (hasGeometry) {
    return (
      <div style={frame}>
        <AssessmentMap
          geometry={data.geometry}
          transects={data.transects}
          governingDirection={data.governing_direction}
          highlightedSide={selected}
        />
        {/* selector sits ABOVE the Leaflet panes; selecting highlights the edge */}
        <ElevationButtons sectors={data.sectors} selected={selected} setSelected={setSelected} zIndex={1000} />
      </div>
    )
  }

  // Point-only case: no boundary geometry to draw — keep the neutral placeholder.
  return (
    <div style={{ ...frame, background: '#E7E1CE' }}>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'repeating-linear-gradient(0deg, var(--contour) 0 1px, transparent 1px 46px), repeating-linear-gradient(90deg, var(--contour) 0 1px, transparent 1px 46px)',
          opacity: 0.5,
        }}
      />
      <ElevationButtons sectors={data.sectors} selected={selected} setSelected={setSelected} zIndex={2} />
      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center', color: 'var(--ink-soft)', maxWidth: 280 }}>
        <Glyph name="locate" size={26} style={{ opacity: 0.5 }} />
        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>No site boundary</div>
        <div style={{ fontSize: 12, marginTop: 2 }}>This is a point-only case — no boundary geometry to map.</div>
      </div>
    </div>
  )
}

// ── coming-next placeholder for the non-Workspace tabs ──────────────────────
function ComingNext({ label }) {
  return (
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="cs-card" style={{ padding: '22px 26px', textAlign: 'center', maxWidth: 360 }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>Coming next — this tab isn’t wired yet.</div>
      </div>
    </div>
  )
}

// ── the screen ──────────────────────────────────────────────────────────────
export function WorkspaceScreen({ caseId, onTitle, me }) {
  const isMobile = useIsMobile()
  // The fetch result is tagged with its caseId; loading is DERIVED by comparing
  // (no synchronous setState in the effect). Default selection + tab reset are
  // applied in the async .then, not the effect body.
  const [result, setResult] = useState({ caseId: null, phase: 'loading', data: null, error: null })
  const [selected, setSelected] = useState(null)
  const [tab, setTab] = useState('workspace')
  // CONSOLE-F3 write state. `busy` = { side, kind } during a confirm/override
  // request; `editing` = the side whose inline override editor is open;
  // `formError` = a backend validation message shown inside that editor.
  const [busy, setBusy] = useState(null)
  const [editing, setEditing] = useState(null)
  const [formError, setFormError] = useState(null)
  // Case-level review status write state (separate from the per-side `busy`).
  const [statusBusy, setStatusBusy] = useState(false)
  const [statusError, setStatusError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getCase(caseId)
      .then((data) => {
        if (cancelled) return
        setResult({ caseId, phase: 'ready', data, error: null })
        setSelected(data.governing_compass_side || 'North')
        setTab('workspace')
        setEditing(null)
        setFormError(null)
        onTitle?.(data.property?.matched_address || data.property?.address || null)
      })
      .catch((err) => {
        if (!cancelled) setResult({ caseId, phase: 'error', data: null, error: err.message })
      })
    return () => {
      cancelled = true
    }
  }, [caseId, onTitle])

  const phase = result.caseId === caseId ? result.phase : 'loading'

  if (phase === 'loading') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>
        Loading case…
      </div>
    )
  }

  if (phase === 'error') {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <div className="cs-card" style={{ padding: '22px 26px', textAlign: 'center', maxWidth: 420 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)', marginBottom: 4 }}>{result.error}</div>
          <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
            This case isn’t in your worklist (it may be unsubmitted, outside your jurisdiction, or unknown).
          </div>
        </div>
      </div>
    )
  }

  const data = result.data
  const p = data.property || {}
  const sub = [data.job_number, p.state, 'simplified method', data.client_name].filter(Boolean).join(' · ')
  // Sides with review flags drive the "Photo review (N)" tab count.
  const flaggedCount = (data.sectors || []).filter((s) => (s.review_flags || []).length > 0).length

  // ── write path (CONSOLE-F3) — the backend is the single source of truth ─────
  // Patch the in-place case so EVERY tab (workspace, photo review, audit,
  // report) reflects the change without a page reload. We optimistically merge
  // the write response (refreshed sector + recomputed headline) for instant
  // feedback, then refetch the whole case so the audit trail picks up the new
  // event. No BAL is recomputed in React.
  function patchData(next) {
    setResult((r) => (r.caseId === caseId ? { ...r, data: next(r.data) } : r))
  }
  function applyWrite(resp) {
    patchData((d) => ({
      ...d,
      bal_rating: resp.bal_rating,
      governing_direction: resp.governing_direction,
      governing_compass_side: resp.governing_compass_side,
      sectors: d.sectors.map((s) => (s.compass_side === resp.compass_side ? resp.sector : s)),
      // Live-sync the derived review summary (§8) so the progress bar, outstanding
      // tasks and blockers update the instant a side is confirmed/overridden.
      review_progress: resp.review_progress,
      remaining_reviews: resp.remaining_reviews,
      review_checklist: resp.review_checklist,
      outstanding_requests: resp.outstanding_requests,
      can_ready_to_sign: resp.can_ready_to_sign,
      ready_to_sign_blockers: resp.ready_to_sign_blockers,
    }))
  }
  async function refreshCase() {
    try {
      const fresh = await getCase(caseId)
      patchData(() => fresh)
    } catch {
      /* keep the optimistic state if the refetch fails */
    }
  }

  async function handleConfirm(side) {
    if (busy) return
    setBusy({ side, kind: 'confirm' })
    setFormError(null)
    try {
      applyWrite(await confirmSector(caseId, side))
      await refreshCase()
    } catch (e) {
      setFormError({ side, message: e.message })
    } finally {
      setBusy(null)
    }
  }

  async function handleOverrideSave(side, changed, reason) {
    if (busy) return
    setBusy({ side, kind: 'override' })
    setFormError(null)
    try {
      applyWrite(await overrideSector(caseId, side, { ...changed, reason }))
      setEditing(null)
      await refreshCase()
    } catch (e) {
      setFormError({ side, message: e.message }) // shown inline inside the open editor
    } finally {
      setBusy(null)
    }
  }

  async function handleRemoveOverride(side) {
    if (busy) return
    setBusy({ side, kind: 'remove' })
    setFormError(null)
    try {
      applyWrite(await removeOverride(caseId, side))
      setEditing(null)
      await refreshCase()
    } catch (e) {
      setFormError({ side, message: e.message })
    } finally {
      setBusy(null)
    }
  }

  // Case-level status change. Patches the case-level review fields + audit from
  // the response (instant), then refetches the whole case (so the report tab,
  // can_ready_to_sign and any newly-cleared photo request all settle).
  async function handleUpdateStatus(payload) {
    if (statusBusy) return
    setStatusBusy(true)
    setStatusError(null)
    try {
      const resp = await updateStatus(caseId, payload)
      patchData((d) => ({
        ...d,
        status: resp.status,
        ui_state: resp.ui_state,
        review_reason: resp.review_reason,
        photo_request_sides: resp.photo_request_sides,
        review_progress: resp.review_progress,
        remaining_reviews: resp.remaining_reviews,
        review_checklist: resp.review_checklist,
        outstanding_requests: resp.outstanding_requests,
        can_ready_to_sign: resp.can_ready_to_sign,
        ready_to_sign_blockers: resp.ready_to_sign_blockers,
        audit: resp.audit,
      }))
      await refreshCase()
    } catch (e) {
      setStatusError(e.message)
    } finally {
      setStatusBusy(false)
    }
  }

  // Sign-off (P0). The sign response carries the same case-status bundle as a
  // status change plus `signoff`; patch it in so the whole workspace flips to the
  // signed/locked state, then refetch so the audit trail picks up the sign event.
  async function handleSigned(resp) {
    patchData((d) => ({
      ...d,
      status: resp.status,
      ui_state: resp.ui_state,
      review_reason: resp.review_reason,
      photo_request_sides: resp.photo_request_sides,
      review_progress: resp.review_progress,
      remaining_reviews: resp.remaining_reviews,
      review_checklist: resp.review_checklist,
      outstanding_requests: resp.outstanding_requests,
      can_ready_to_sign: resp.can_ready_to_sign,
      ready_to_sign_blockers: resp.ready_to_sign_blockers,
      signoff: resp.signoff,
      audit: resp.audit,
    }))
    await refreshCase()
  }

  function selectSide(side) {
    setEditing(null)
    setFormError(null)
    setSelected(side)
  }

  const actions = {
    busy,
    editing,
    formError,
    onConfirm: handleConfirm,
    onOverrideOpen: (side) => { setFormError(null); setEditing(side) },
    onOverrideClose: () => { setFormError(null); setEditing(null) },
    onOverrideSave: handleOverrideSave,
    onRemoveOverride: handleRemoveOverride,
  }

  return (
    <>
      {/* job header (mockup app-shell job route) */}
      <div style={{ flexShrink: 0, borderBottom: '1px solid var(--line)', background: 'var(--panel)', padding: isMobile ? '10px 12px 0' : '10px 16px 0' }}>
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'center', justifyContent: 'space-between', gap: isMobile ? 8 : 14, marginBottom: 8 }}>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'flex-start' : 'baseline', gap: isMobile ? 2 : 12, minWidth: 0, maxWidth: '100%' }}>
            <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: isMobile ? 16 : 18, margin: 0, color: 'var(--ink)', whiteSpace: isMobile ? 'normal' : 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
              {p.matched_address || p.address}
            </h1>
            <span className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', whiteSpace: isMobile ? 'normal' : 'nowrap' }}>{sub}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0, flexWrap: 'wrap' }}>
            <CStatusChip state={data.ui_state} />
            <CBALChip bal={data.bal_rating} suggested />
            {!isMobile && <CBtn variant="quiet" disabled title="Report builder lands in a later step">Report preview</CBtn>}
          </div>
        </div>
        <div className="ec-scroll" style={{ display: 'flex', gap: 2, overflowX: isMobile ? 'auto' : 'visible' }}>
          {TABS.map(([id, label]) => {
            const sel = tab === id
            const text = id === 'photo' && flaggedCount > 0 ? `${label} (${flaggedCount})` : label
            return (
              <button
                key={id}
                className="ec-press"
                onClick={() => setTab(id)}
                style={{
                  padding: '7px 14px 8px',
                  cursor: 'pointer',
                  border: 'none',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  fontFamily: 'var(--font-ui)',
                  fontSize: 12.5,
                  fontWeight: 600,
                  borderRadius: '8px 8px 0 0',
                  background: sel ? 'var(--paper)' : 'transparent',
                  color: sel ? 'var(--ink)' : 'var(--ink-soft)',
                  boxShadow: sel ? 'inset 0 2.5px 0 var(--ochre), inset 1px 0 0 var(--line), inset -1px 0 0 var(--line)' : 'none',
                }}
              >
                {text}
              </button>
            )
          })}
        </div>
      </div>

      {/* tab content — fills the cockpit and manages its own scroll. On phones the
          workspace tab stacks: the map pins on top and the evidence panel scrolls
          beneath it. */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
        {tab === 'workspace' ? (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: isMobile ? 'column' : 'row', minWidth: 0 }}>
            <LeftCanvas data={data} selected={selected} setSelected={selectSide} isMobile={isMobile} />
            <RightPanel
              data={data}
              selected={selected}
              setSelected={selectSide}
              actions={actions}
              statusActions={{ busy: statusBusy, error: statusError, onUpdate: handleUpdateStatus }}
              isMobile={isMobile}
            />
          </div>
        ) : tab === 'photo' ? (
          <PhotoReview caseId={caseId} data={data} actions={actions} selected={selected} setSelected={selectSide} isMobile={isMobile} />
        ) : tab === 'audit' ? (
          <AuditTrail data={data} isMobile={isMobile} />
        ) : tab === 'report' ? (
          <ReportSignoff data={data} me={me} caseId={caseId} onSigned={handleSigned} onGotoWorkspace={() => setTab('workspace')} isMobile={isMobile} />
        ) : (
          <ComingNext label={TABS.find(([id]) => id === tab)?.[1]} />
        )}
      </div>
    </>
  )
}

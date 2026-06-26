// Console UI atoms — lifted verbatim from the mockup bundle (console/shared.jsx
// → CStatusChip, CSectionLabel, CBtn; embercheck/shared.jsx → Wordmark). Inline
// styles + CSS vars are kept exactly as the mockup wrote them.
import { Glyph } from './Glyph'
import { EC_BAL } from '../lib/bal'

const C_STATES = {
  draft: { label: 'Draft ready', color: 'var(--ink-soft)', bg: 'color-mix(in oklab, var(--ink) 7%, transparent)' },
  'needs-photos': { label: 'Needs photos', color: '#8A6420', bg: 'color-mix(in oklab, var(--ochre) 20%, transparent)' },
  'in-review': { label: 'In review', color: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc-deep) 13%, transparent)' },
  ready: { label: 'Ready to sign', color: 'var(--paper)', bg: 'var(--euc-deep)' },
  'site-visit': { label: 'Site visit', color: '#8A6420', bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)' },
  specialist: { label: 'Specialist', color: '#93431F', bg: 'color-mix(in oklab, #B06F3A 18%, transparent)' },
  refer: { label: 'Refer to specialist', color: '#93431F', bg: 'color-mix(in oklab, #B06F3A 18%, transparent)' },
  signed: { label: 'Signed · issued', color: 'var(--ink)', bg: 'color-mix(in oklab, var(--ink) 10%, transparent)' },
}

// The backend's ui_state token → the chip key the mockup uses.
function chipKey(uiState) {
  return uiState === 'ready-to-sign' ? 'ready' : uiState
}

export function CStatusChip({ state }) {
  const s = C_STATES[chipKey(state)] || C_STATES['in-review']
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 99,
        background: s.bg,
        color: s.color,
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {s.label}
    </span>
  )
}

export function CSectionLabel({ children, style }) {
  return (
    <div
      style={{
        fontSize: 10.5,
        fontWeight: 800,
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
        color: 'var(--ink-soft)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function CBtn({ children, onClick, variant = 'quiet', disabled, icon, style, title, type }) {
  const variants = {
    primary: { background: 'var(--euc-deep)', color: 'var(--paper)', border: '1px solid var(--euc-deep)' },
    quiet: { background: 'var(--panel)', color: 'var(--ink)', border: '1px solid color-mix(in oklab, var(--ink) 22%, transparent)' },
    ghost: { background: 'transparent', color: 'var(--euc-deep)', border: '1px solid transparent' },
    ochre: { background: 'var(--ochre)', color: '#241A0C', border: '1px solid var(--ochre)' },
  }
  return (
    <button
      className="ec-press"
      title={title}
      type={type || 'button'}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 7,
        minHeight: 30,
        padding: '0 12px',
        borderRadius: 8,
        cursor: disabled ? 'default' : 'pointer',
        fontFamily: 'var(--font-ui)',
        fontSize: 12.5,
        fontWeight: 600,
        opacity: disabled ? 0.45 : 1,
        whiteSpace: 'nowrap',
        ...variants[variant],
        ...style,
      }}
    >
      {icon ? <Glyph name={icon} size={14} stroke={2} /> : null}
      {children}
    </button>
  )
}

// CBALChip — lifted from console/shared.jsx. The mockup keys on the bare id
// ('12.5', 'LOW'); our API hands back "BAL-12.5"/"BAL-LOW", so we strip the
// prefix here and render the chip identically. `suggested` → dashed border.
export function CBALChip({ bal, size = 'md', suggested }) {
  const id = String(bal || '').replace(/^BAL-/i, '')
  const l = EC_BAL.find((x) => x.id === id)
  const big = size === 'lg'
  if (!l) {
    return (
      <span className="cs-mono" style={{ fontSize: big ? 17 : 12, color: 'var(--ink-soft)' }}>
        {bal || '—'}
      </span>
    )
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: big ? 8 : 6,
        padding: big ? '5px 14px' : '2px 9px',
        borderRadius: 8,
        background: 'color-mix(in oklab, ' + l.color + ' 16%, transparent)',
        border: (suggested ? '1.5px dashed ' : '1.5px solid ') + l.color,
        color: 'var(--ink)',
        fontFamily: 'var(--font-mono)',
        fontWeight: 600,
        fontSize: big ? 17 : 12,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: big ? 10 : 8, height: big ? 10 : 8, borderRadius: 2, background: l.color }} />
      BAL-{l.id}
    </span>
  )
}

// CBadge — confidence pill (console/shared.jsx C_CONF). The mockup keys on
// 'high'|'medium'|'low'; our API gives a 0–1 float, banded by confBand().
const C_CONF = {
  high: { label: 'High conf', color: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc-deep) 12%, transparent)' },
  medium: { label: 'Med conf', color: '#8A6420', bg: 'color-mix(in oklab, var(--ochre) 20%, transparent)' },
  low: { label: 'Low conf', color: '#93431F', bg: 'color-mix(in oklab, #B06F3A 18%, transparent)' },
}

export function CBadge({ conf }) {
  const c = C_CONF[conf]
  if (!c) return null
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 5,
        padding: '2px 8px',
        borderRadius: 99,
        background: c.bg,
        color: c.color,
        fontSize: 10.5,
        fontWeight: 700,
        letterSpacing: '0.04em',
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: 'currentColor' }} />
      {c.label}
    </span>
  )
}

// CRowStatus — provenance pill (console/shared.jsx). suggested/derived dashed,
// confirmed/overridden solid.
const C_ROW_STATUS = {
  suggested: { label: 'Suggested', color: '#8A6420', dashed: true },
  derived: { label: 'Derived', color: 'var(--ink-soft)', dashed: true },
  confirmed: { label: 'Confirmed', color: 'var(--euc-deep)', dashed: false },
  overridden: { label: 'Overridden', color: '#93431F', dashed: false },
}

export function CRowStatus({ status }) {
  const s = C_ROW_STATUS[status]
  if (!s) return null
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
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

// FlagChip — review_flags rendered with the mockup's flag colourway (the
// #B06F3A/#93431F dot+text treatment EvidenceRow uses for d.flag).
export function FlagChip({ label }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '2px 9px',
        borderRadius: 99,
        background: 'color-mix(in oklab, #B06F3A 14%, transparent)',
        color: '#93431F',
        fontSize: 11,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 99, background: '#B06F3A', flexShrink: 0 }} />
      {label}
    </span>
  )
}

// Wordmark — concentric contour mark + name (from embercheck/shared.jsx).
export function Wordmark({ size = 28 }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
      <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
        <circle cx="16" cy="17" r="13" fill="none" stroke="var(--euc-deep)" strokeWidth="1.6" strokeDasharray="62 20" strokeLinecap="round" transform="rotate(-40 16 17)" />
        <circle cx="16" cy="17" r="8" fill="none" stroke="var(--ochre)" strokeWidth="1.6" strokeDasharray="36 14" strokeLinecap="round" transform="rotate(70 16 17)" />
        <circle cx="16" cy="17" r="3" fill="var(--euc-deep)" />
      </svg>
      <span
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: size * 0.78,
          color: 'var(--ink)',
          letterSpacing: '-0.01em',
        }}
      >
        EmberCheck
      </span>
    </div>
  )
}

// Audit trail — the workspace's "Audit trail" tab, ported from the mockup's
// console/audit.jsx (AuditScreen). Layout/typography from the mockup; the events
// are LIVE, derived server-side (data.audit from CONSOLE-B3). READ-ONLY —
// "Export log" is present-but-inert.
import { CSectionLabel, CBtn } from '../components/atoms'
import { Glyph } from '../components/Glyph'

// kind → glyph (mockup C_AUDIT_ICON).
const KIND_ICON = { derive: 'refresh', flag: 'info', photo: 'camera', confirm: 'check', override: 'doc', revert: 'refresh', status: 'arrowRight', submit: 'arrowRight', sign: 'check' }
// actor → pill colours (mockup C_ACTOR_STYLE; the assessor/client actor reuses
// the euc-deep treatment).
const ACTOR_STYLE = {
  System: { bg: 'color-mix(in oklab, var(--ink) 8%, transparent)', color: 'var(--ink-soft)' },
  'Owner capture': { bg: 'color-mix(in oklab, var(--ochre) 20%, transparent)', color: '#8A6420' },
}
function actorStyle(actor) {
  return ACTOR_STYLE[actor] || { bg: 'color-mix(in oklab, var(--euc-deep) 13%, transparent)', color: 'var(--euc-deep)' }
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtStamp(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} · ${hh}:${mm}`
}

export function AuditTrail({ data }) {
  const audit = data.audit || []
  return (
    <div className="ec-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 820, margin: '0 auto', padding: '22px 28px 48px' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 14, marginBottom: 16 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '0 0 3px', color: 'var(--ink)' }}>Audit trail</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>
              Every value sourced, every change attributed. This is your defensibility — it ships with the report.
            </div>
          </div>
          <CBtn variant="quiet" icon="doc" disabled title="Audit export lands in a later step">Export log</CBtn>
        </div>

        {audit.length === 0 ? (
          <div className="cs-card" style={{ padding: '18px 18px', fontSize: 12.5, color: 'var(--ink-soft)' }}>
            No audit events recorded for this case yet.
          </div>
        ) : (
          <div className="cs-card" style={{ padding: '6px 0' }}>
            {audit.map((a, i) => {
              const actor = actorStyle(a.actor)
              const last = i === audit.length - 1
              return (
                <div key={i} style={{ display: 'flex', gap: 14, padding: '12px 18px', borderBottom: last ? 'none' : '1px solid var(--line)' }}>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexShrink: 0 }}>
                    <span
                      style={{
                        width: 28,
                        height: 28,
                        borderRadius: 99,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        background:
                          a.kind === 'override'
                            ? 'color-mix(in oklab, #B06F3A 16%, transparent)'
                            : a.kind === 'sign' || a.kind === 'submit'
                              ? 'var(--euc-deep)'
                              : 'color-mix(in oklab, var(--ink) 7%, transparent)',
                        color:
                          a.kind === 'override'
                            ? '#93431F'
                            : a.kind === 'sign' || a.kind === 'submit'
                              ? 'var(--paper)'
                              : 'var(--ink-soft)',
                      }}
                    >
                      <Glyph name={KIND_ICON[a.kind] || 'info'} size={14} stroke={2.2} />
                    </span>
                    {!last && <span style={{ width: 1.5, flex: 1, background: 'var(--line)', marginTop: 4 }} />}
                  </div>
                  <div style={{ minWidth: 0, paddingBottom: 2 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3, flexWrap: 'wrap' }}>
                      <span className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{fmtStamp(a.timestamp)}</span>
                      <span style={{ padding: '1.5px 8px', borderRadius: 99, fontSize: 10.5, fontWeight: 700, background: actor.bg, color: actor.color }}>{a.actor}</span>
                    </div>
                    <div style={{ fontSize: 13, lineHeight: 1.55, color: 'var(--ink)' }}>{a.text}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}

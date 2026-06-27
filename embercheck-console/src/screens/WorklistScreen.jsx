// Worklist screen — built from the mockup's WorklistScreen component
// (console/worklist.jsx). Markup, grid, pills, typography and spacing are kept
// identical to the mockup; the demo CONSOLE_JOBS rows are replaced by live data
// from GET /console/worklist. The filter tabs map to the backend's ?state=.
import { useEffect, useState } from 'react'
import { getWorklist } from '../lib/consoleApi'
import { CStatusChip, CSectionLabel, CBtn } from '../components/atoms'
import { Glyph } from '../components/Glyph'
import { useIsMobile } from '../lib/useIsMobile'

// Filter tabs map 1:1 to the backend's review ui_states (CONSOLE-B3.2). The third
// tuple element is the backend ?state= value (null = All) — filtering happens
// server-side, never in the client.
const FILTERS = [
  ['all', 'All', null],
  ['in-review', 'In review', 'in-review'],
  ['needs-photos', 'Needs photos', 'needs-photos'],
  ['ready', 'Ready to sign', 'ready-to-sign'],
  ['site-visit', 'Site visit', 'site-visit'],
  ['specialist', 'Specialist', 'specialist'],
  ['signed', 'Signed', 'signed'],
]

const GRID = '2.1fr 1fr 0.9fr 0.75fr 1fr 0.8fr 28px'

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function formatDue(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`
}

export function WorklistScreen({ onOpenJob, toast }) {
  const isMobile = useIsMobile()
  const [filter, setFilter] = useState('all')
  // The fetch result is tagged with the filter it belongs to. Loading is then
  // DERIVED — no synchronous setState in the effect — by checking whether the
  // loaded result matches the active filter yet.
  const [result, setResult] = useState({ filter: null, rows: [], error: false })

  useEffect(() => {
    const backendState = FILTERS.find((f) => f[0] === filter)?.[2] ?? null
    let cancelled = false
    getWorklist(backendState)
      .then((data) => {
        if (!cancelled) setResult({ filter, rows: Array.isArray(data) ? data : [], error: false })
      })
      .catch(() => {
        if (!cancelled) setResult({ filter, rows: [], error: true })
      })
    return () => {
      cancelled = true
    }
  }, [filter])

  const settled = result.filter === filter
  const status = !settled ? 'loading' : result.error ? 'error' : 'ready'
  const rows = settled && !result.error ? result.rows : []

  const flagged = rows.reduce((n, j) => n + (j.flags || 0), 0)
  const ready = rows.filter((j) => j.ui_state === 'ready-to-sign').length

  return (
    <div data-screen-label="Worklist" style={{ maxWidth: 1060, margin: '0 auto', padding: isMobile ? '18px 16px 40px' : '26px 28px 48px' }}>
      <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: isMobile ? 'stretch' : 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 18 }}>
        <div>
          <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 26, margin: '0 0 4px', color: 'var(--ink)', letterSpacing: '-0.01em' }}>
            Worklist
          </h1>
          <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>
            {rows.length} assessment{rows.length === 1 ? '' : 's'} ·{' '}
            <span style={{ color: flagged ? '#93431F' : 'var(--ink-soft)', fontWeight: 600 }}>
              {flagged} flagged item{flagged === 1 ? '' : 's'} need{flagged === 1 ? 's' : ''} your judgment
            </span>
            {ready > 0 ? ` · ${ready} ready to sign` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <CBtn variant="quiet" icon="doc" onClick={() => toast('Batch import accepts a CSV of lots — not wired in this prototype')}>
            Import batch (CSV)
          </CBtn>
          <CBtn variant="primary" icon="search" onClick={() => toast('New assessment is created from the consumer app — not wired in the Console yet')}>
            New assessment
          </CBtn>
        </div>
      </div>

      <div className="ec-scroll" style={{ display: 'flex', gap: 6, marginBottom: 14, overflowX: isMobile ? 'auto' : 'visible', paddingBottom: isMobile ? 4 : 0 }}>
        {FILTERS.map(([id, label]) => (
          <button
            key={id}
            className="ec-press"
            onClick={() => setFilter(id)}
            style={{
              padding: '5px 13px',
              borderRadius: 99,
              cursor: 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 12,
              fontWeight: 600,
              whiteSpace: 'nowrap',
              background: filter === id ? 'var(--euc-deep)' : 'transparent',
              color: filter === id ? 'var(--paper)' : 'var(--ink-soft)',
              border: filter === id ? '1px solid var(--euc-deep)' : '1px solid color-mix(in oklab, var(--ink) 18%, transparent)',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="cs-card" style={{ overflow: 'hidden' }}>
        {!isMobile && (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: GRID,
              gap: 12,
              padding: '9px 16px',
              borderBottom: '1px solid var(--line)',
              background: 'color-mix(in oklab, var(--ink) 4%, transparent)',
            }}
          >
            {['Job', 'Client', 'State', 'Flags', 'Photos', 'Due', ''].map((h, i) => (
              <CSectionLabel key={i}>{h}</CSectionLabel>
            ))}
          </div>
        )}

        {status === 'loading' && (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>
            Loading worklist…
          </div>
        )}

        {status === 'error' && (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: '#93431F' }}>
            Could not load the worklist. Please try again.
          </div>
        )}

        {status === 'ready' && rows.length === 0 && (
          <div style={{ padding: '40px 16px', textAlign: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>
            No jobs in this view
          </div>
        )}

        {status === 'ready' && isMobile &&
          rows.map((j, i) => (
            <div
              key={j.id}
              className="cs-rowhover ec-press"
              onClick={() => onOpenJob(j)}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                padding: '13px 14px',
                cursor: 'pointer',
                borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
                background: 'transparent',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>{j.address}</div>
                  <div className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 1 }}>
                    {j.job_number} · {j.state || '—'} · {j.client_name || '—'}
                  </div>
                </div>
                <CStatusChip state={j.ui_state} />
              </div>
              {(j.outstanding || []).map((o) => (
                <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: '#93431F' }}>
                  <span style={{ width: 6, height: 6, borderRadius: 99, background: '#B06F3A', flexShrink: 0 }} />
                  {o}
                </div>
              ))}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap', fontSize: 12, color: 'var(--ink-soft)' }}>
                <span style={{ fontWeight: 700, color: j.flags ? '#93431F' : 'var(--ink-soft)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {j.flags ? <span style={{ width: 7, height: 7, borderRadius: 99, background: '#B06F3A' }} /> : null}
                  {j.flags ? `${j.flags} flagged` : 'No flags'}
                </span>
                <span className="cs-mono">{j.photos_done} of {j.photos_total ?? 4} photos</span>
                <span>Due {formatDue(j.due)}</span>
              </div>
            </div>
          ))}

        {status === 'ready' && !isMobile &&
          rows.map((j, i) => (
            <div
              key={j.id}
              className="cs-rowhover ec-press"
              onClick={() => onOpenJob(j)}
              style={{
                display: 'grid',
                gridTemplateColumns: GRID,
                gap: 12,
                padding: '11px 16px',
                alignItems: 'center',
                cursor: 'pointer',
                borderBottom: i < rows.length - 1 ? '1px solid var(--line)' : 'none',
                background: 'transparent',
              }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {j.address}
                </div>
                <div className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 1 }}>
                  {j.job_number} · {j.state || '—'} template
                </div>
              </div>
              <div style={{ fontSize: 12.5, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {j.client_name || '—'}
              </div>
              <div>
                <CStatusChip state={j.ui_state} />
                {/* outstanding case-level requests (§6) — derived by the backend,
                    shown until cleared so the row flags what's still blocking sign-off */}
                {(j.outstanding || []).map((o) => (
                  <div key={o} style={{ display: 'flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: 11, fontWeight: 600, color: '#93431F' }}>
                    <span style={{ width: 6, height: 6, borderRadius: 99, background: '#B06F3A', flexShrink: 0 }} />
                    {o}
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 12.5, fontWeight: 700, color: j.flags ? '#93431F' : 'var(--ink-soft)' }}>
                {j.flags ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ width: 7, height: 7, borderRadius: 99, background: '#B06F3A' }} />
                    {j.flags}
                  </span>
                ) : (
                  '—'
                )}
              </div>
              <div className="cs-mono" style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
                {j.photos_done} of {j.photos_total ?? 4}
              </div>
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', whiteSpace: 'nowrap' }}>{formatDue(j.due)}</div>
              <span style={{ color: 'var(--ink-soft)', display: 'flex' }}>
                <Glyph name="chevronRight" size={15} />
              </span>
            </div>
          ))}
      </div>

      <div style={{ marginTop: 12, fontSize: 11.5, color: 'var(--ink-soft)', display: 'flex', gap: 6, alignItems: 'center' }}>
        <Glyph name="info" size={13} />
        Drafts are system-proposed from public data. Nothing is determined until you sign it.
      </div>
    </div>
  )
}

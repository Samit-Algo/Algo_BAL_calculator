// The application queue. Filter by status; click a row to review it. PENDING is
// the default surface (what needs action), but every state is viewable.
import { useEffect, useState } from 'react'
import { listApplications } from '../lib/adminApi'
import { StatusPill } from '../components/StatusPill'

const FILTERS = ['PENDING', 'APPROVED', 'SUSPENDED', 'REJECTED', 'INACTIVE', 'ALL']

export function QueueScreen({ onOpen }) {
  const [filter, setFilter] = useState('PENDING')
  const [rows, setRows] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    setRows(null)
    setError(null)
    listApplications(filter === 'ALL' ? null : filter)
      .then((r) => { if (!cancelled) setRows(r) })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [filter])

  return (
    <div>
      <h1 style={{ fontWeight: 800, fontSize: 24, margin: '0 0 4px', color: 'var(--ink)' }}>Assessor applications</h1>
      <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--ink-soft)' }}>Review applications and grant or revoke assessor access.</p>

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
        {FILTERS.map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className="a-pill"
            style={{
              cursor: 'pointer',
              border: f === filter ? '1.5px solid var(--euc-deep)' : '1.5px solid var(--line)',
              background: f === filter ? 'color-mix(in oklab, var(--euc-deep) 12%, var(--card))' : 'var(--card)',
              color: f === filter ? 'var(--euc-deep)' : 'var(--ink-soft)',
            }}
          >
            {f === 'ALL' ? 'All' : f.charAt(0) + f.slice(1).toLowerCase()}
          </button>
        ))}
      </div>

      {error && <div style={{ color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}
      {rows === null && !error && <div style={{ color: 'var(--ink-soft)' }}>Loading…</div>}
      {rows && rows.length === 0 && (
        <div className="a-card" style={{ padding: 24, textAlign: 'center', color: 'var(--ink-soft)' }}>
          No applications in this state.
        </div>
      )}

      {rows && rows.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {rows.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r.id)}
              className="a-card"
              style={{ textAlign: 'left', cursor: 'pointer', padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}
            >
              <div style={{ minWidth: 0 }}>
                <div style={{ fontWeight: 700, fontSize: 15, color: 'var(--ink)' }}>
                  {[r.legal_first_name, r.legal_last_name].filter(Boolean).join(' ') || r.user_email || 'Applicant'}
                </div>
                <div style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 2 }}>
                  {[r.business_name, r.accreditation_number, (r.operating_states || []).join('/')].filter(Boolean).join(' · ')}
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 2 }}>
                  {r.user_email} · {r.document_count} document{r.document_count === 1 ? '' : 's'}
                </div>
              </div>
              <StatusPill status={r.status} />
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

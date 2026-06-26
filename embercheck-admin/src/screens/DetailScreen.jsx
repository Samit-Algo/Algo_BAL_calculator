// Application detail + document viewer + the six admin actions.
//
// Actions that change an applicant's standing carry a reason: reject / suspend /
// request-info REQUIRE one (validated client-side before the call, matching the
// backend's 422); approve / reactivate / deactivate take an optional note. The
// action set shown adapts to the current status so the admin only sees the moves
// that make sense.
import { useEffect, useState } from 'react'
import {
  getApplication, getDocumentURL,
  approve, reactivate, deactivate, reject, suspend, requestInfo,
} from '../lib/adminApi'
import { StatusPill } from '../components/StatusPill'

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString()
}

function Row({ label, value }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, padding: '7px 0', borderBottom: '1px solid var(--line)' }}>
      <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{label}</span>
      <span style={{ fontSize: 13.5, color: 'var(--ink)', fontWeight: 600, textAlign: 'right' }}>{value || '—'}</span>
    </div>
  )
}

export function DetailScreen({ id, onBack }) {
  const [app, setApp] = useState(null)
  const [error, setError] = useState(null)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState(null)

  async function load() {
    setError(null)
    try {
      setApp(await getApplication(id))
    } catch (e) {
      setError(e.message)
    }
  }
  useEffect(() => { load() /* eslint-disable-next-line */ }, [id])

  async function run(name, fn, needsReason) {
    if (busy) return
    setActionError(null)
    const r = (reason || '').trim()
    if (needsReason && !r) {
      setActionError('A reason is required for this action.')
      return
    }
    setBusy(true)
    try {
      const updated = await fn(id, needsReason ? r : (r || undefined))
      setApp(updated)
      setReason('')
    } catch (e) {
      setActionError(e.message)
    }
    setBusy(false)
  }

  async function viewDoc(index) {
    const url = await getDocumentURL(id, index)
    if (url) window.open(url, '_blank', 'noopener')
    else setActionError('Could not open that document.')
  }

  if (error) {
    return (
      <div>
        <button className="a-btn a-btn-quiet" onClick={onBack} style={{ minHeight: 32, marginBottom: 16 }}>← Back</button>
        <div className="a-card" style={{ padding: 24, color: 'var(--danger)' }}>{error}</div>
      </div>
    )
  }
  if (!app) return <div style={{ color: 'var(--ink-soft)' }}>Loading…</div>

  const s = app.status
  // Which actions make sense from here.
  const canApprove = s === 'PENDING'
  const canReactivate = s === 'SUSPENDED' || s === 'INACTIVE' || s === 'REJECTED'
  const canReject = s === 'PENDING'
  const canRequestInfo = s === 'PENDING'
  const canSuspend = s === 'APPROVED'
  const canDeactivate = s === 'APPROVED' || s === 'SUSPENDED'

  return (
    <div>
      <button className="a-btn a-btn-quiet" onClick={onBack} style={{ minHeight: 32, marginBottom: 16 }}>← Back to queue</button>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 4 }}>
        <h1 style={{ fontWeight: 800, fontSize: 24, margin: 0, color: 'var(--ink)' }}>
          {[app.legal_first_name, app.legal_last_name].filter(Boolean).join(' ') || app.user_email || 'Applicant'}
        </h1>
        <StatusPill status={s} />
      </div>
      <p style={{ margin: '0 0 18px', fontSize: 14, color: 'var(--ink-soft)' }}>{app.user_email}</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }} className="a-detail-grid">
        <div className="a-card" style={{ padding: '16px 18px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--euc-deep)', margin: '0 0 10px' }}>Applicant</h2>
          <Row label="Phone" value={app.phone} />
          <Row label="Business" value={app.business_name} />
          <Row label="Trading name" value={app.trading_name} />
          <Row label="ABN" value={app.abn} />
          <Row label="Base address" value={app.base_address} />
        </div>
        <div className="a-card" style={{ padding: '16px 18px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--euc-deep)', margin: '0 0 10px' }}>Accreditation</h2>
          <Row label="Number" value={app.accreditation_number} />
          <Row label="Level" value={app.accreditation_level} />
          <Row label="Expiry" value={fmtDate(app.accreditation_expiry)} />
          <Row label="Insurer" value={app.insurer} />
          <Row label="Insurance expiry" value={fmtDate(app.insurance_expiry)} />
        </div>
        <div className="a-card" style={{ padding: '16px 18px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--euc-deep)', margin: '0 0 10px' }}>Operating area</h2>
          <Row label="States" value={(app.operating_states || []).join(', ')} />
          <Row label="LGAs" value={(app.operating_lgas || []).join(', ')} />
          <Row label="Service radius" value={app.service_radius_km ? `${app.service_radius_km} km` : '—'} />
        </div>
        <div className="a-card" style={{ padding: '16px 18px' }}>
          <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--euc-deep)', margin: '0 0 10px' }}>Documents</h2>
          {(app.documents || []).length === 0 ? (
            <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>No documents uploaded.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {app.documents.map((d) => (
                <div key={d.index} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                  <span style={{ fontSize: 13, color: 'var(--ink)' }}>{d.doc_type} <span style={{ color: 'var(--ink-soft)' }}>· {fmtDate(d.uploaded_at)}</span></span>
                  <button className="a-btn a-btn-quiet" onClick={() => viewDoc(d.index)} style={{ minHeight: 30, fontSize: 12.5 }}>View</button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {app.review_reason && (
        <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 10, background: 'color-mix(in oklab, var(--ochre) 12%, var(--card))', border: '1px solid color-mix(in oklab, var(--ochre) 30%, transparent)', fontSize: 13.5, color: 'var(--ink)' }}>
          <strong>Latest reviewer note:</strong> {app.review_reason}
        </div>
      )}

      {/* Action bar */}
      <div className="a-card" style={{ marginTop: 20, padding: '16px 18px' }}>
        <h2 style={{ fontSize: 13, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--euc-deep)', margin: '0 0 10px' }}>Actions</h2>
        <textarea
          className="a-input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Reason (required for reject / suspend / request info)"
          style={{ minHeight: 64, marginBottom: 12, resize: 'vertical' }}
        />
        {actionError && <div style={{ marginBottom: 10, color: 'var(--danger)', fontSize: 13, fontWeight: 600 }}>{actionError}</div>}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          {canApprove && <button className="a-btn a-btn-primary" disabled={busy} onClick={() => run('approve', approve, false)}>Approve</button>}
          {canReactivate && <button className="a-btn a-btn-primary" disabled={busy} onClick={() => run('reactivate', reactivate, false)}>Reactivate</button>}
          {canRequestInfo && <button className="a-btn a-btn-ochre" disabled={busy} onClick={() => run('request-info', requestInfo, true)}>Request info</button>}
          {canSuspend && <button className="a-btn a-btn-danger" disabled={busy} onClick={() => run('suspend', suspend, true)}>Suspend</button>}
          {canReject && <button className="a-btn a-btn-danger" disabled={busy} onClick={() => run('reject', reject, true)}>Reject</button>}
          {canDeactivate && <button className="a-btn a-btn-quiet" disabled={busy} onClick={() => run('deactivate', deactivate, false)}>Deactivate</button>}
        </div>
      </div>
    </div>
  )
}

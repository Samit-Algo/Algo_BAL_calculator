// Report & sign-off — the workspace's "Report & sign-off" tab, ported from the
// mockup's console/report.jsx (ReportScreen). Layout/typography from the mockup;
// the document preview is LIVE (built from the case data + the logged-in
// assessor). READ-ONLY — the case is never signed here, so the preview always
// carries the DRAFT watermark and Sign/Download/Send are present-but-inert.
import { useState } from 'react'
import { CSectionLabel, CBtn, CBALChip, CStatusChip, Wordmark } from '../components/atoms'
import { Glyph } from '../components/Glyph'

const SIDES = ['North', 'East', 'South', 'West']

// Status → the report's review-state line (informational only — nothing is signed).
const REPORT_STATUS_LABEL = {
  SUBMITTED_TO_ASSESSOR: 'Submitted — awaiting review', ANALYSIS_COMPLETE: 'Analysis complete',
  UNDER_REVIEW: 'Under review', NEEDS_MORE_PHOTOS: 'Needs more photos', SITE_VISIT_REQUIRED: 'Site visit required',
  REFERRED_SPECIALIST: 'Referred to specialist', READY_TO_SIGN: 'Ready to sign', CHANGES_REQUESTED: 'Needs more photos',
  APPROVED: 'Ready to sign', COMPLETE: 'Signed · issued', DRAFT: 'Draft',
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
function fmtDay(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function effectiveVeg(s) {
  return s.overrides?.vegetation_class || s.combined_classification || s.gis_draft_classification || '—'
}

export function ReportSignoff({ data, me, onGotoWorkspace }) {
  const [template, setTemplate] = useState('nsw')
  const [attest, setAttest] = useState(false)

  const sectors = data.sectors || []
  const bySide = Object.fromEntries(sectors.map((s) => [s.compass_side, s]))
  const p = data.property || {}
  const reportId = `${data.job_number}-R1`
  // The backend's derived review checklist (CONSOLE-F3.3) — rendered verbatim.
  const checklist = data.review_checklist || []

  return (
    <div className="ec-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: '22px 28px 48px', display: 'flex', gap: 22, alignItems: 'flex-start' }}>
        {/* left: settings + sign-off */}
        <div style={{ width: 330, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '0 0 3px', color: 'var(--ink)' }}>Report &amp; sign-off</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>The system drafted. You determine.</div>
          </div>

          <div className="cs-card" style={{ padding: '14px 16px' }}>
            <CSectionLabel style={{ marginBottom: 10 }}>Template — jurisdiction</CSectionLabel>
            {[
              ['nsw', 'NSW — certifier pack', 'Methodology, evidence per elevation, clause-referenced requirements'],
              ['qld', 'QLD — DA/MCU pack', 'QDC RS templates; bushfire hazard overlay references'],
            ].map(([id, label, sub]) => (
              <button
                key={id}
                className="ec-press"
                onClick={() => setTemplate(id)}
                style={{
                  display: 'flex',
                  gap: 10,
                  width: '100%',
                  textAlign: 'left',
                  padding: '9px 10px',
                  borderRadius: 9,
                  cursor: 'pointer',
                  border: 'none',
                  marginBottom: 4,
                  fontFamily: 'var(--font-ui)',
                  background: template === id ? 'color-mix(in oklab, var(--euc-deep) 9%, transparent)' : 'transparent',
                }}
              >
                <span style={{ width: 16, height: 16, borderRadius: 99, boxSizing: 'border-box', flexShrink: 0, marginTop: 1, border: template === id ? '5px solid var(--euc-deep)' : '1.6px solid color-mix(in oklab, var(--ink) 32%, transparent)' }} />
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{label}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.4 }}>{sub}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="cs-card" style={{ padding: '14px 16px' }}>
            <CSectionLabel style={{ marginBottom: 10 }}>Before you can sign</CSectionLabel>
            {/* the backend's review_checklist, rendered directly (no React-side
                inference) — elevation reviews plus any open request (§2/§3). */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {checklist.map((item) => {
                const isReview = item.key.endsWith('_review')
                return (
                  <div key={item.key} style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                    <span style={{ color: item.complete ? 'var(--euc-deep)' : '#B06F3A', display: 'flex', flexShrink: 0 }}>
                      <Glyph name={item.complete ? 'check' : 'info'} size={14} stroke={2.4} />
                    </span>
                    <span style={{ fontSize: 12.5, color: item.complete ? 'var(--euc-deep)' : '#93431F', flex: 1 }}>
                      {item.label}
                    </span>
                    {!item.complete && isReview && (
                      <CBtn variant="ghost" style={{ minHeight: 22, fontSize: 11, padding: '0 4px' }} onClick={onGotoWorkspace}>Review →</CBtn>
                    )}
                  </div>
                )
              })}
              {checklist.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--ink-soft)' }}>No review tasks for this case.</div>
              )}
            </div>
            {/* why can't I sign? — verbatim from backend blockers */}
            {!data.can_ready_to_sign && (data.ready_to_sign_blockers || []).length > 0 && (
              <div style={{ marginTop: 11, padding: '9px 11px', borderRadius: 9, background: 'color-mix(in oklab, #B06F3A 10%, transparent)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: '#93431F', marginBottom: 5 }}>Cannot sign yet</div>
                {data.ready_to_sign_blockers.map((b, i) => (
                  <div key={i} style={{ display: 'flex', gap: 7, alignItems: 'flex-start', fontSize: 11.5, color: '#7a3a1c', lineHeight: 1.4, marginTop: i ? 4 : 0 }}>
                    <span style={{ width: 5, height: 5, borderRadius: 99, background: '#B06F3A', flexShrink: 0, marginTop: 5 }} />
                    {b}
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="cs-card" style={{ padding: '14px 16px' }}>
            <CSectionLabel style={{ marginBottom: 10 }}>Sign-off</CSectionLabel>
            <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 12 }}>
              <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 2, accentColor: '#3C4733' }} />
              <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink)' }}>
                I have reviewed the evidence and each elevation’s classification. This determination is mine, made under my accreditation.
              </span>
            </label>
            <CBtn variant="primary" disabled title="Signing lands in a later step" style={{ width: '100%', minHeight: 38 }}>
              Sign and issue determination
            </CBtn>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
              Read-only preview — confirming sides &amp; signing land in a later step.
            </div>
          </div>
        </div>

        {/* right: document preview */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {/* review-state banner (CONSOLE-B3.2) — the draft reflects where the case
              sits in the review lifecycle. Informational only; nothing is signed. */}
          <div className="cs-card" style={{ padding: '11px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <CSectionLabel>Review state</CSectionLabel>
            <CStatusChip state={data.ui_state} />
            <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 700 }}>
              {REPORT_STATUS_LABEL[data.status] || data.status}
            </span>
            {data.review_reason && (
              <span style={{ fontSize: 12, color: 'var(--ink-soft)', flexBasis: '100%', lineHeight: 1.45 }}>
                <strong style={{ color: 'var(--ink)' }}>Reason:</strong> {data.review_reason}
                {(data.photo_request_sides || []).length > 0 ? ` (${data.photo_request_sides.join(', ')})` : ''}
              </span>
            )}
          </div>

          <div style={{ background: '#FDFCF6', border: '1px solid var(--line)', borderRadius: 6, boxShadow: '0 14px 40px rgba(40,36,24,0.13)', padding: '38px 44px', position: 'relative', overflow: 'hidden' }}>
            {/* always-on DRAFT watermark (nothing is signed here) */}
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
              <span style={{ transform: 'rotate(-24deg)', fontSize: 38, fontWeight: 800, letterSpacing: '0.14em', color: 'color-mix(in oklab, #B06F3A 26%, transparent)', border: '3px dashed color-mix(in oklab, #B06F3A 30%, transparent)', borderRadius: 12, padding: '10px 28px', whiteSpace: 'nowrap' }}>
                DRAFT — NOT A DETERMINATION
              </span>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '2px solid var(--ink)', paddingBottom: 14, marginBottom: 16 }}>
              <div>
                <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 19, color: 'var(--ink)' }}>Bushfire Attack Level Assessment</div>
                <div className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 2 }}>
                  {template === 'nsw' ? 'NSW certifier pack' : 'QLD DA/MCU pack'} · {reportId} · {fmtDay(data.created_at)}
                </div>
              </div>
              <Wordmark size={20} />
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14, marginBottom: 16 }}>
              <div>
                <CSectionLabel style={{ marginBottom: 3 }}>Subject site</CSectionLabel>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>
                  {p.matched_address || p.address}
                  <br />
                  <span className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{[p.lga ? `${p.lga} LGA` : null, p.state].filter(Boolean).join(' · ')}</span>
                </div>
              </div>
              <div>
                <CSectionLabel style={{ marginBottom: 3 }}>Assessor</CSectionLabel>
                <div style={{ fontSize: 12.5, color: 'var(--ink)', lineHeight: 1.5 }}>
                  {me?.name || me?.email || '—'}
                  <br />
                  <span className="cs-mono" style={{ fontSize: 10.5, color: 'var(--ink-soft)' }}>{me?.jurisdiction ? `${me.jurisdiction} accredited assessor` : 'accredited assessor'}</span>
                </div>
              </div>
            </div>

            <CSectionLabel style={{ marginBottom: 5 }}>Methodology</CSectionLabel>
            <p style={{ margin: '0 0 16px', fontSize: 11.5, lineHeight: 1.6, color: 'var(--ink)' }}>
              Assessed under the simplified procedure of AS 3959 (Method 1), informed by the public datasets tabled below and
              any site photography on file. Machine-derived values are surfaced with their source and confidence; the
              determination is the accredited assessor’s own and is not made until signed.
            </p>

            <CSectionLabel style={{ marginBottom: 5 }}>Data sources</CSectionLabel>
            <table className="cs-doctable" style={{ marginBottom: 16 }}>
              <thead>
                <tr><th>Source</th><th>Vintage</th><th>Resolution</th></tr>
              </thead>
              <tbody>
                <tr><td>NSW SVTM vegetation mapping</td><td className="cs-mono">2019</td><td className="cs-mono">5 m</td></tr>
                <tr><td>LiDAR DEM (terrain / effective slope)</td><td className="cs-mono">2022</td><td className="cs-mono">1 m</td></tr>
                <tr><td>NSW cadastre &amp; road reserves</td><td className="cs-mono">2024</td><td className="cs-mono">±1 m</td></tr>
                <tr><td>Site photography (per elevation, where supplied)</td><td className="cs-mono">on file</td><td className="cs-mono">—</td></tr>
              </tbody>
            </table>

            <CSectionLabel style={{ marginBottom: 5 }}>Determination by elevation</CSectionLabel>
            <table className="cs-doctable" style={{ marginBottom: 18 }}>
              <thead>
                <tr><th>Elevation</th><th>Vegetation</th><th>Slope</th><th>Separation</th><th>BAL</th><th>Basis</th></tr>
              </thead>
              <tbody>
                {SIDES.map((side) => {
                  const s = bySide[side]
                  const basis = s?.overrides?.vegetation_class
                    ? 'overridden by assessor'
                    : s?.reviewed
                      ? 'confirmed by assessor'
                      : 'suggested — unreviewed'
                  return (
                    <tr key={side}>
                      <td style={{ fontWeight: 700 }}>{side[0]}</td>
                      <td>{s ? effectiveVeg(s) : '—'}</td>
                      <td className="cs-mono">{s?.effective_slope_degrees != null ? `${s.effective_slope_degrees}°${s.slope_direction ? ' ' + s.slope_direction : ''}` : '—'}</td>
                      <td className="cs-mono">{s?.distance_m != null ? `${s.distance_m} m` : '—'}</td>
                      <td className="cs-mono" style={{ fontWeight: 700 }}>{s?.final_bal || '—'}</td>
                      <td style={{ color: 'var(--ink-soft)' }}>{basis}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 14, padding: '12px 16px', borderRadius: 8, background: 'color-mix(in oklab, var(--ink) 5%, transparent)', marginBottom: 18 }}>
              <div style={{ fontSize: 12, color: 'var(--ink)' }}>
                <strong>Overall determination</strong> — highest applicable elevation
                {data.governing_compass_side ? ` (${data.governing_compass_side})` : ''}
              </div>
              <CBALChip bal={data.bal_rating} size="lg" suggested />
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', borderTop: '1px solid var(--line)', paddingTop: 14 }}>
              <div>
                <CSectionLabel style={{ marginBottom: 4 }}>Assessor signature</CSectionLabel>
                <div style={{ width: 190, borderBottom: '1.5px solid var(--ink-soft)', height: 24 }} />
                <div className="cs-mono" style={{ fontSize: 10, color: 'var(--ink-soft)', marginTop: 3 }}>Unsigned</div>
              </div>
              <div className="cs-mono" style={{ fontSize: 9.5, color: 'var(--ink-soft)', textAlign: 'right', maxWidth: 280, lineHeight: 1.5 }}>
                Prepared with EmberCheck Console. The system proposes; the accredited assessor determines.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

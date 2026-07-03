// Report & sign-off — the workspace's "Report & sign-off" tab, ported from the
// mockup's console/report.jsx (ReportScreen). Layout/typography from the mockup;
// the document preview is LIVE (built from the case data + the logged-in
// assessor). READ-ONLY — the case is never signed here, so the preview always
// carries the DRAFT watermark and Sign/Download/Send are present-but-inert.
import { useState } from 'react'
import { CSectionLabel, CBtn, CStatusChip } from '../components/atoms'
import { Glyph } from '../components/Glyph'
import { signCase, getCaseReport } from '../lib/consoleApi'
import { reportSignature, useReportPreview, ReportPreviewFrame } from '../components/ReportPreview'

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

export function ReportSignoff({ data, onGotoWorkspace, isMobile, caseId, onSigned, onBack }) {
  const [attest, setAttest] = useState(false)
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState(null)
  const [downloading, setDownloading] = useState(false)

  const signed = data.status === 'COMPLETE'
  const signoff = data.signoff || null
  // The live server-rendered preview (shared hook) — the SAME saved template the
  // Preview page confirmed. Refetches whenever the case's report fields change.
  const { html: previewHtml, error: previewError } = useReportPreview(caseId, reportSignature(data))

  async function handleSign() {
    if (signing || signed) return
    setSigning(true)
    setSignError(null)
    try {
      const resp = await signCase(caseId, { attestation: true })
      onSigned?.(resp)
    } catch (e) {
      setSignError(e.message)
    } finally {
      setSigning(false)
    }
  }

  // Download the report PDF — the backend renders the SAME report shown in the
  // preview to PDF (the signed certificate once signed, else the current
  // preliminary report). This is the one document the end-user also receives.
  async function handleDownload() {
    if (downloading) return
    setDownloading(true)
    setSignError(null)
    try {
      const url = await getCaseReport(caseId)
      if (url) {
        const a = document.createElement('a')
        a.href = url
        a.download = `EmberCheck-${data.job_number || caseId}-report.pdf`
        document.body.appendChild(a)
        a.click()
        a.remove()
        setTimeout(() => URL.revokeObjectURL(url), 60000)
      } else {
        setSignError('Could not generate the report. Please try again.')
      }
    } finally {
      setDownloading(false)
    }
  }

  // The backend's derived review checklist (CONSOLE-F3.3) — rendered verbatim.
  const checklist = data.review_checklist || []

  return (
    <div className="ec-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: isMobile ? '18px 14px 40px' : '22px 28px 48px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 22, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        {/* left: settings + sign-off */}
        <div style={{ width: isMobile ? '100%' : 330, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '0 0 3px', color: 'var(--ink)' }}>Report &amp; sign-off</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>The system drafted. You determine.</div>
            {onBack && !signed && (
              <button
                className="ec-press"
                onClick={onBack}
                style={{ marginTop: 6, background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--euc-deep)', fontSize: 12, fontWeight: 700, fontFamily: 'var(--font-ui)' }}
              >
                ← Back to preview / change template
              </button>
            )}
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

            {signed ? (
              <>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  <span style={{ display: 'flex', color: 'var(--euc-deep)' }}><Glyph name="check" size={16} stroke={2.6} /></span>
                  <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--euc-deep)' }}>Signed &amp; issued</span>
                </div>
                <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.5, marginBottom: 12 }}>
                  {signoff?.report_number && (
                    <div className="cs-mono" style={{ color: 'var(--ink)' }}>{signoff.report_number}</div>
                  )}
                  {signoff?.signed_at && <div>Issued {fmtDay(signoff.signed_at)}</div>}
                  {signoff?.assessor_name && <div>By {signoff.assessor_name}</div>}
                </div>
                <CBtn variant="primary" icon="doc" onClick={handleDownload} disabled={downloading} style={{ width: '100%', minHeight: 38 }}>
                  {downloading ? 'Preparing…' : 'Download PDF'}
                </CBtn>
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
                  This is the issued determination — the same PDF the client receives. The case is locked to further edits.
                </div>
              </>
            ) : (
              <>
                <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', cursor: 'pointer', marginBottom: 12 }}>
                  <input type="checkbox" checked={attest} onChange={(e) => setAttest(e.target.checked)} style={{ marginTop: 2, accentColor: '#3C4733' }} />
                  <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--ink)' }}>
                    I have reviewed the evidence and each elevation’s classification. This determination is mine, made under my accreditation.
                  </span>
                </label>
                <CBtn
                  variant="primary"
                  onClick={handleSign}
                  disabled={!attest || !data.can_ready_to_sign || signing}
                  title={!data.can_ready_to_sign ? 'Resolve the outstanding tasks before signing' : 'Sign and issue the determination'}
                  style={{ width: '100%', minHeight: 38 }}
                >
                  {signing ? 'Signing…' : 'Sign and issue determination'}
                </CBtn>
                {signError && (
                  <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600 }}>
                    {signError}
                  </div>
                )}
                <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
                  {data.can_ready_to_sign
                    ? 'Signing freezes the determination and issues the PDF to the client.'
                    : 'Mark every elevation reviewed and clear open requests to enable signing.'}
                </div>
                {/* Download the current report as a PDF before signing — it is
                    the same document (marked PRELIMINARY) that signing will issue. */}
                <div style={{ borderTop: '1px solid var(--line)', margin: '12px 0 10px' }} />
                <CBtn variant="ghost" icon="doc" onClick={handleDownload} disabled={downloading || !previewHtml} style={{ width: '100%', minHeight: 36 }}>
                  {downloading ? 'Preparing…' : 'Download PDF (preview)'}
                </CBtn>
              </>
            )}
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

          {/* LIVE document preview — the SAME shared iframe the Preview page uses;
              the server renders the report template (also the eventual PDF, so
              they can't drift). We do NOT rebuild the report in React. */}
          <ReportPreviewFrame html={previewHtml} error={previewError} isMobile={isMobile} />
          <div className="cs-mono" style={{ marginTop: 8, fontSize: 9.5, color: 'var(--ink-soft)', textAlign: 'right', lineHeight: 1.5 }}>
            Live preview rendered from the report template · the same template fills the issued PDF · the system proposes, the accredited assessor determines.
          </div>
        </div>
      </div>
    </div>
  )
}

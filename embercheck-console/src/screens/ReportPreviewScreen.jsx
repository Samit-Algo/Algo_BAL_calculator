// Report Preview page (step 1 of the report flow): pick a template and confirm.
// Left = the two templates as selectable cards; right = the LIVE server-rendered
// preview (shared iframe, not rebuilt in React). Picking a template PATCHes the
// saved choice and refetches the preview so the right side updates. "Confirm &
// continue" advances to the Sign-off page, which renders the same saved template.
import { useState } from 'react'
import { CSectionLabel, CBtn, CStatusChip } from '../components/atoms'
import {
  REPORT_TEMPLATES,
  reportSignature,
  detectTemplateId,
  useReportPreview,
  ReportPreviewFrame,
} from '../components/ReportPreview'
import { setReportTemplate } from '../lib/consoleApi'
import nswThumb from '../assets/report-thumbs/nsw_certifier.png'
import ownerThumb from '../assets/report-thumbs/owner_summary.png'

// Real cover screenshots per template (generated offline by
// scripts/gen_template_thumbs.py), keyed by the backend template id.
const THUMBS = { nsw_certifier: nswThumb, owner_summary: ownerThumb }

export function ReportPreviewScreen({ data, caseId, isMobile, onContinue }) {
  const [tick, setTick] = useState(0) // bump to force a preview refetch after a save
  const [selected, setSelected] = useState(null) // user intent; falls back to detected
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)

  const { html, error } = useReportPreview(caseId, `${reportSignature(data)}:${tick}`)
  // What's actually rendered right now (derived from the HTML the server returned),
  // overridden by the user's in-flight pick so the highlight feels instant.
  const active = selected || detectTemplateId(html) || 'nsw_certifier'
  const signed = data.status === 'COMPLETE'

  async function pick(id) {
    if (saving || id === active) return
    setSaving(true)
    setSaveError(null)
    setSelected(id) // optimistic highlight
    try {
      await setReportTemplate(caseId, id)
      setTick((t) => t + 1) // refetch → right side shows the new template
    } catch (e) {
      setSaveError(e.message)
      setSelected(null) // revert to whatever the server actually has
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ec-scroll" style={{ position: 'absolute', inset: 0, overflowY: 'auto' }}>
      <div style={{ maxWidth: 1060, margin: '0 auto', padding: isMobile ? '18px 14px 40px' : '22px 28px 48px', display: 'flex', flexDirection: isMobile ? 'column' : 'row', gap: isMobile ? 16 : 22, alignItems: isMobile ? 'stretch' : 'flex-start' }}>
        {/* left: template picker + continue */}
        <div style={{ width: isMobile ? '100%' : 330, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div>
            <h2 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 21, margin: '0 0 3px', color: 'var(--ink)' }}>Report preview</h2>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>Choose a template, review it, then continue to sign-off.</div>
          </div>

          <div className="cs-card" style={{ padding: '14px 16px' }}>
            <CSectionLabel style={{ marginBottom: 10 }}>Report template</CSectionLabel>
            {REPORT_TEMPLATES.map((t) => (
              <button
                key={t.id}
                className="ec-press"
                onClick={() => pick(t.id)}
                disabled={saving || signed}
                style={{
                  display: 'flex', gap: 10, width: '100%', textAlign: 'left', padding: '9px 10px',
                  borderRadius: 9, cursor: saving || signed ? 'default' : 'pointer', border: 'none',
                  marginBottom: 4, fontFamily: 'var(--font-ui)',
                  background: active === t.id ? 'color-mix(in oklab, var(--euc-deep) 9%, transparent)' : 'transparent',
                }}
              >
                <span style={{ width: 16, height: 16, borderRadius: 99, boxSizing: 'border-box', flexShrink: 0, marginTop: 1, border: active === t.id ? '5px solid var(--euc-deep)' : '1.6px solid color-mix(in oklab, var(--ink) 32%, transparent)' }} />
                {THUMBS[t.id] && (
                  <img
                    src={THUMBS[t.id]}
                    alt=""
                    width={110}
                    style={{ width: 110, height: 'auto', display: 'block', alignSelf: 'flex-start', borderRadius: 8, border: '1px solid var(--line)', flexShrink: 0 }}
                  />
                )}
                <span>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>{t.name}</span>
                  <span style={{ display: 'block', fontSize: 11, color: 'var(--ink-soft)', lineHeight: 1.4 }}>{t.desc}</span>
                </span>
              </button>
            ))}
            {saveError && (
              <div style={{ marginTop: 8, padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600 }}>
                {saveError}
              </div>
            )}
            {signed && (
              <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
                This case is signed — the template is locked to the issued determination.
              </div>
            )}
          </div>

          <div className="cs-card" style={{ padding: '14px 16px' }}>
            <CSectionLabel style={{ marginBottom: 10 }}>Continue</CSectionLabel>
            <CBtn variant="primary" onClick={onContinue} disabled={saving} style={{ width: '100%', minHeight: 38 }}>
              Confirm &amp; continue →
            </CBtn>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--ink-soft)' }}>
              The sign-off page will show this exact template for review and signing.
            </div>
          </div>
        </div>

        {/* right: live document preview (shared iframe) */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          <div className="cs-card" style={{ padding: '11px 14px', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <CSectionLabel>Preview</CSectionLabel>
            <CStatusChip state={data.ui_state} />
            <span style={{ fontSize: 12.5, color: 'var(--ink)', fontWeight: 700 }}>
              {(REPORT_TEMPLATES.find((t) => t.id === active) || {}).name}
            </span>
            {saving && <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>Updating…</span>}
          </div>
          <ReportPreviewFrame html={html} error={error} isMobile={isMobile} />
          <div className="cs-mono" style={{ marginTop: 8, fontSize: 9.5, color: 'var(--ink-soft)', textAlign: 'right', lineHeight: 1.5 }}>
            Live preview rendered from the report template · the same template fills the issued PDF · the system proposes, the accredited assessor determines.
          </div>
        </div>
      </div>
    </div>
  )
}

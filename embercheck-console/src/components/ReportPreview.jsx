// Shared report-preview pieces used by BOTH the Preview page and the Sign-off
// page, so the fetch + <iframe srcDoc> live in one place (no forked copies).
// The report is rendered SERVER-side (GET /console/cases/{id}/report/preview) and
// shown verbatim in an iframe — we never rebuild the report in React.
import { useEffect, useState } from 'react'
import { getReportPreview } from '../lib/consoleApi'

// The two backend templates (ids must match app/services/report_render.py).
export const REPORT_TEMPLATES = [
  {
    id: 'nsw_certifier',
    name: 'NSW — certifier pack',
    desc: 'Full report — methodology, per-elevation photo evidence, FDI & BAL tables, clause-referenced construction sections.',
  },
  {
    id: 'owner_summary',
    name: 'Owner summary',
    desc: 'Short form — cover, site details, the final BAL and the disclaimer only.',
  },
]

// A signature of the case fields that change the rendered report, so the live
// preview refetches the instant an override/confirm/status edit lands (the parent
// patches `data` in place after every write — §8 live sync).
export function reportSignature(data) {
  const sides = (data.sectors || []).map((s) =>
    [s.compass_side, s.effective_classification, s.final_bal, s.distance_m, s.effective_slope_degrees,
     s.slope_direction, s.value_sources?.vegetation, (s.review_flags || []).join('|'),
     s.overrides?.vegetation_class].join(':'),
  )
  return [data.id, data.status, data.bal_rating, data.governing_compass_side, ...sides].join('~')
}

// Which template the server rendered, derived from the returned HTML (the case
// read does not expose report_template_id). The owner-summary layout is the only
// one whose title carries "BAL Summary"; everything else is the certifier pack.
export function detectTemplateId(html) {
  if (!html) return null
  return html.includes('BAL Summary') || html.includes('Owner Summary') ? 'owner_summary' : 'nsw_certifier'
}

// Fetch (and refetch) the server-rendered preview HTML. `dep` is any string that,
// when it changes, forces a refetch (case signature, a template-change tick, …).
export function useReportPreview(caseId, dep) {
  const [html, setHtml] = useState(null)
  const [error, setError] = useState(null)
  useEffect(() => {
    let cancelled = false
    getReportPreview(caseId)
      .then((h) => { if (!cancelled) { setHtml(h); setError(null) } })
      .catch((e) => { if (!cancelled) setError(e.message) })
    return () => { cancelled = true }
  }, [caseId, dep])
  return { html, error }
}

// The document preview surface — server HTML in a self-sizing iframe, plus the
// loading / error states. Identical rendering for both pages.
export function ReportPreviewFrame({ html, error, isMobile }) {
  return (
    <div style={{ background: '#FDFCF6', border: '1px solid var(--line)', borderRadius: 6, boxShadow: '0 14px 40px rgba(40,36,24,0.13)', overflow: 'hidden', minHeight: 480 }}>
      {error ? (
        <div style={{ padding: '40px 28px', textAlign: 'center', color: '#93431F', fontSize: 13 }}>{error}</div>
      ) : html == null ? (
        <div style={{ padding: '40px 28px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 13 }}>Loading report preview…</div>
      ) : (
        <iframe
          title="BAL report preview"
          srcDoc={html}
          onLoad={(e) => {
            // Size the frame to its content so the whole report shows without an
            // inner scrollbar (srcDoc is same-origin).
            try {
              const doc = e.target.contentDocument
              if (doc) e.target.style.height = doc.body.scrollHeight + 24 + 'px'
            } catch { /* cross-origin guard — keep the fallback height */ }
          }}
          style={{ display: 'block', width: '100%', height: isMobile ? 700 : 900, border: 'none', background: '#fff' }}
        />
      )}
    </div>
  )
}

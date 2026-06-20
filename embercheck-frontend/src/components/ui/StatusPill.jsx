// A small status pill for a case's place in the consumer -> assessor workflow
// (Phase 1, Step 5b-ii). Colour-coded; falls back to a title-cased label for any
// status not explicitly mapped.

const STATUS_META = {
  DRAFT: { label: 'Draft', fg: 'var(--ink-soft)', bg: 'color-mix(in oklab, var(--ink) 10%, transparent)' },
  ANALYSIS_COMPLETE: { label: 'Analysis complete', fg: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc) 20%, transparent)' },
  SUBMITTED_TO_ASSESSOR: { label: 'Submitted', fg: '#7a5418', bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)' },
  UNDER_REVIEW: { label: 'Under review', fg: '#7a5418', bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)' },
  CHANGES_REQUESTED: { label: 'Changes requested', fg: '#7a2418', bg: 'color-mix(in oklab, #b3402c 16%, transparent)' },
  SITE_VISIT_REQUIRED: { label: 'Site visit required', fg: '#7a5418', bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)' },
  REFERRED_SPECIALIST: { label: 'Referred to specialist', fg: '#7a5418', bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)' },
  APPROVED: { label: 'Approved', fg: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc) 20%, transparent)' },
  COMPLETE: { label: 'Complete', fg: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc) 20%, transparent)' },
}

function statusLabel(status) {
  return (
    STATUS_META[status]?.label ||
    String(status || '')
      .toLowerCase()
      .replace(/_/g, ' ')
      .replace(/^\w/, (c) => c.toUpperCase())
  )
}

export default function StatusPill({ status }) {
  const meta = STATUS_META[status] || {
    label: statusLabel(status),
    fg: 'var(--ink-soft)',
    bg: 'color-mix(in oklab, var(--ink) 10%, transparent)',
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '3px 10px',
        borderRadius: 99,
        background: meta.bg,
        color: meta.fg,
        fontSize: 12,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {meta.label}
    </span>
  )
}

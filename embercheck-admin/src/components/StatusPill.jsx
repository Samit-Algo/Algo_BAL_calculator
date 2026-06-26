// Status pill colour-coded by assessor application state.
const META = {
  PENDING: { fg: '#7a5418', bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)' },
  APPROVED: { fg: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc-deep) 16%, transparent)' },
  REJECTED: { fg: '#7a2418', bg: 'color-mix(in oklab, #b3402c 16%, transparent)' },
  SUSPENDED: { fg: '#7a2418', bg: 'color-mix(in oklab, #b3402c 16%, transparent)' },
  INACTIVE: { fg: 'var(--ink-soft)', bg: 'color-mix(in oklab, var(--ink) 10%, transparent)' },
}

export function StatusPill({ status }) {
  const m = META[status] || META.INACTIVE
  const label = String(status || '').charAt(0) + String(status || '').slice(1).toLowerCase()
  return <span className="a-pill" style={{ color: m.fg, background: m.bg, flexShrink: 0 }}>{label}</span>
}

// Soft paper card + the numbered "eyebrow" label that titles each section of
// the result story. Ported from the reference design.
export function ECCard({ children, tone = 'card', style, className }) {
  return (
    <div
      className={className}
      style={{
        background:
          tone === 'ochre'
            ? 'color-mix(in oklab, var(--ochre) 13%, var(--card))'
            : 'var(--card)',
        border: '1px solid var(--line)',
        borderRadius: 22,
        padding: '22px 22px',
        boxShadow: '0 4px 18px rgba(40,36,24,0.07)',
        ...style,
      }}
    >
      {children}
    </div>
  )
}

export function ECEyebrow({ children, n }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
      {n && (
        <span
          style={{
            width: 24,
            height: 24,
            borderRadius: 99,
            background: 'var(--euc-deep)',
            color: 'var(--paper)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 12.5,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {n}
        </span>
      )}
      <span
        style={{
          fontSize: 11.5,
          fontWeight: 800,
          letterSpacing: '0.12em',
          textTransform: 'uppercase',
          color: 'var(--euc-deep)',
        }}
      >
        {children}
      </span>
    </div>
  )
}

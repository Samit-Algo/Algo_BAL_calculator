// The "honesty treatment" — a dashed ochre pill that marks every result as a
// preliminary screening, never a certified assessment. Ported from the reference.
export default function PrelimBadge({ compact = false }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: compact ? '4px 10px' : '5px 12px',
        borderRadius: 999,
        border: '1.5px dashed var(--ochre)',
        background: 'color-mix(in oklab, var(--ochre) 10%, transparent)',
        color: 'var(--ink)',
        fontSize: compact ? 10.5 : 11.5,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: 99,
          background: 'var(--ochre)',
          flexShrink: 0,
        }}
      ></span>
      {compact ? 'Preliminary' : 'Preliminary — not a certified assessment'}
    </span>
  )
}

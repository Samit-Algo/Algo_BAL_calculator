// EmberCheck wordmark — concentric contour mark + name. Ported from the
// reference design. `tagline` adds the "bushfire exposure, made legible" line.
export default function Wordmark({ size = 28, stacked = false, tagline = false }) {
  const mark = (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <circle
        cx="16"
        cy="17"
        r="13"
        fill="none"
        stroke="var(--euc-deep)"
        strokeWidth="1.6"
        strokeDasharray="62 20"
        strokeLinecap="round"
        transform="rotate(-40 16 17)"
      />
      <circle
        cx="16"
        cy="17"
        r="8"
        fill="none"
        stroke="var(--ochre)"
        strokeWidth="1.6"
        strokeDasharray="36 14"
        strokeLinecap="round"
        transform="rotate(70 16 17)"
      />
      <circle cx="16" cy="17" r="3" fill="var(--euc-deep)" />
    </svg>
  )
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexDirection: stacked ? 'column' : 'row',
      }}
    >
      {mark}
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.05 }}>
        <span
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: size * 0.78,
            color: 'var(--ink)',
            letterSpacing: '-0.01em',
          }}
        >
          EmberCheck
        </span>
        {tagline && (
          <span style={{ fontSize: size * 0.34, color: 'var(--ink-soft)', fontWeight: 500 }}>
            bushfire exposure, made legible
          </span>
        )}
      </div>
    </div>
  )
}

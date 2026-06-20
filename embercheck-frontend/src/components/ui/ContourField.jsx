import { useMemo } from 'react'

// Topographic contour-line background field. Sits behind content as a subtle
// "map" texture. Ported from the reference design.
export default function ContourField({ lines = 12, amp = 30, opacity = 1, style }) {
  const paths = useMemo(() => {
    const out = []
    const W = 1440
    const H = 920
    for (let i = 0; i < lines; i++) {
      const y0 = (H / (lines + 1)) * (i + 1)
      const seed = i * 37.7
      let d = ''
      for (let x = -20; x <= W + 20; x += 18) {
        const y =
          y0 +
          Math.sin(seed + x * 0.0055) * amp +
          Math.sin(seed * 1.71 + x * 0.013) * amp * 0.42
        d += (d ? ' L ' : 'M ') + x + ' ' + y.toFixed(1)
      }
      out.push(d)
    }
    return out
  }, [lines, amp])
  return (
    <svg
      viewBox="0 0 1440 920"
      preserveAspectRatio="xMidYMid slice"
      style={{
        position: 'absolute',
        inset: 0,
        width: '100%',
        height: '100%',
        opacity,
        pointerEvents: 'none',
        ...style,
      }}
      aria-hidden="true"
    >
      {paths.map((d, i) => (
        <path
          key={i}
          d={d}
          fill="none"
          stroke="var(--contour)"
          strokeWidth={i % 4 === 0 ? 1.4 : 0.8}
        />
      ))}
    </svg>
  )
}

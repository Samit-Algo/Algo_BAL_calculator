import { useEffect, useState } from 'react'
import { EC_BAL } from '../../lib/ec'

// The BAL spectrum scale with a highlighted band. lo/hi are indices into
// EC_BAL; for a single rating pass lo === hi. Ported from the reference design.
export default function BALScale({ lo, hi, caption }) {
  const [band, setBand] = useState([lo, hi])
  useEffect(() => {
    const t = setTimeout(() => setBand([lo, hi]), 200)
    return () => clearTimeout(t)
  }, [lo, hi])

  const safeLo = Math.max(0, band[0])
  const safeHi = Math.max(safeLo, band[1])
  const left = (safeLo / 6) * 100
  const width = ((safeHi - safeLo + 1) / 6) * 100

  return (
    <div>
      <div style={{ position: 'relative', padding: '6px 0' }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {EC_BAL.map((l, i) => {
            const inBand = i >= safeLo && i <= safeHi
            return (
              <div
                key={l.id}
                style={{
                  flex: 1,
                  height: 18,
                  borderRadius: 6,
                  background: l.color,
                  opacity: inBand ? 1 : 0.22,
                  transition: 'opacity .7s ease',
                }}
              ></div>
            )
          })}
        </div>
        {lo >= 0 && (
          <div
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `calc(${left}% - 3px)`,
              width: `calc(${width}% + 6px)`,
              border: '2.5px solid var(--ink)',
              borderRadius: 10,
              boxShadow: '0 2px 8px rgba(40,36,24,.18)',
              transition:
                'left .9s cubic-bezier(.3,.8,.25,1), width .9s cubic-bezier(.3,.8,.25,1)',
              pointerEvents: 'none',
            }}
          ></div>
        )}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
        {EC_BAL.map((l, i) => {
          const inBand = i >= safeLo && i <= safeHi
          return (
            <div
              key={l.id}
              style={{
                flex: 1,
                textAlign: 'center',
                fontSize: 12,
                fontWeight: inBand ? 700 : 500,
                color: inBand
                  ? 'var(--ink)'
                  : 'color-mix(in oklab, var(--ink) 40%, transparent)',
                transition: 'color .7s ease',
              }}
            >
              {l.label}
            </div>
          )
        })}
      </div>
      {caption && (
        <div
          style={{
            marginTop: 10,
            fontSize: 13.5,
            lineHeight: 1.45,
            color: 'var(--ink-soft)',
          }}
        >
          {caption}
        </div>
      )}
    </div>
  )
}

import Glyph from './ui/Glyph'

// The pipeline stages, in order, with a friendly label each. Status/detail come
// live from the backend stream (see assessStream in lib/api.js).
const STAGES = [
  { key: 'address', label: 'Finding your block' },
  { key: 'lga', label: 'Locating the council area' },
  { key: 'fdi', label: 'Reading the fire danger index' },
  { key: 'vegetation', label: 'Scanning nearby vegetation' },
  { key: 'slope', label: 'Measuring terrain and slope' },
  { key: 'bal', label: 'Calculating the BAL rating' },
]

// One stage row: a status marker (done check / active spinner / pending dot),
// the label, and any live detail from the backend.
function StageRow({ label, status, detail }) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
      <span
        style={{
          display: 'flex',
          height: 22,
          width: 22,
          flexShrink: 0,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        {status === 'done' && (
          <span
            style={{
              width: 22,
              height: 22,
              borderRadius: 99,
              background: 'var(--euc-deep)',
              color: 'var(--paper)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Glyph name="check" size={13} stroke={3} />
          </span>
        )}
        {status === 'active' && (
          <span
            style={{
              width: 16,
              height: 16,
              borderRadius: 99,
              border: '2px solid var(--ochre)',
              borderTopColor: 'transparent',
              animation: 'ecSpin 0.9s linear infinite',
            }}
          />
        )}
        {status === 'pending' && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: 99,
              background: 'color-mix(in oklab, var(--ink) 22%, transparent)',
            }}
          />
        )}
      </span>
      <span style={{ flex: 1 }}>
        <span
          style={{
            fontSize: 14.5,
            fontWeight: status === 'pending' ? 500 : 700,
            color: status === 'pending' ? 'color-mix(in oklab, var(--ink) 42%, transparent)' : 'var(--ink)',
          }}
        >
          {label}
        </span>
        {detail && (
          <span style={{ display: 'block', fontSize: 12.5, color: 'var(--ink-soft)' }}>
            {detail}
          </span>
        )}
      </span>
    </li>
  )
}

// The analyzing view: the concentric EmberCheck rings spinning over a live
// checklist of the real backend stages.
export default function LoadingState({ stages = {}, address }) {
  const firstPendingIndex = STAGES.findIndex((s) => stages[s.key]?.status !== 'done')

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 28,
        padding: '40px 24px',
      }}
    >
      {/* concentric rings */}
      <div style={{ position: 'relative', width: 150, height: 150 }}>
        {[54, 38, 23].map((r, i) => (
          <svg
            key={r}
            viewBox="0 0 150 150"
            style={{
              position: 'absolute',
              inset: 0,
              animation: `ecSpin ${7 + i * 3}s linear infinite ${i % 2 ? 'reverse' : ''}`,
            }}
          >
            <circle
              cx="75"
              cy="75"
              r={r}
              fill="none"
              stroke={i === 1 ? 'var(--ochre)' : 'var(--euc-deep)'}
              strokeWidth="1.6"
              strokeDasharray={`${r * 4.4} ${r * 1.9}`}
              strokeLinecap="round"
              opacity={0.85 - i * 0.12}
            />
          </svg>
        ))}
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <span
            style={{
              width: 11,
              height: 11,
              borderRadius: 99,
              background: 'var(--euc-deep)',
              boxShadow: '0 0 0 6px color-mix(in oklab, var(--euc-deep) 18%, transparent)',
              animation: 'ecPulse 1.6s ease-in-out infinite',
            }}
          ></span>
        </div>
      </div>

      <div style={{ textAlign: 'center' }}>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 21,
            color: 'var(--ink)',
            marginBottom: 4,
          }}
        >
          Reading the public record…
        </div>
        {address && (
          <div style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{address}</div>
        )}
      </div>

      <ul
        style={{
          width: '100%',
          maxWidth: 340,
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: 14,
        }}
        aria-live="polite"
      >
        {STAGES.map((stage, i) => {
          const reported = stages[stage.key]
          let status = 'pending'
          if (reported?.status === 'done') status = 'done'
          else if (i === firstPendingIndex) status = 'active'
          return (
            <StageRow key={stage.key} label={stage.label} status={status} detail={reported?.detail} />
          )
        })}
      </ul>

      <div
        style={{
          fontSize: 12.5,
          color: 'var(--ink-soft)',
          textAlign: 'center',
          maxWidth: 380,
          lineHeight: 1.5,
        }}
      >
        Public data: NSW terrain · vegetation mapping · bushfire-prone land map
      </div>
    </div>
  )
}

import { buildTransectRows } from '../lib/report'

// The per-transect breakdown table for the BAR-style report: one row per side,
// reading around the boundary. Mirrors a real BAR's vegetation + distance + BAL
// tables. Pure presentation - pass an /assess `result` (boundary mode) and it
// builds the rows, or pass pre-built `rows` directly (used for sample data).

// A small uppercase tag (e.g. "Governs", "Review"), tinted by tone.
function Tag({ children, tone = 'ink' }) {
  const tones = {
    govern: { bg: 'color-mix(in oklab, var(--ember) 20%, transparent)', fg: '#7A1F1F' },
    ochre: { bg: 'color-mix(in oklab, var(--ochre) 22%, transparent)', fg: '#7a5418' },
    ink: { bg: 'color-mix(in oklab, var(--ink) 10%, transparent)', fg: 'var(--ink-soft)' },
  }
  const t = tones[tone] || tones.ink
  return (
    <span
      style={{
        marginLeft: 6,
        padding: '1px 6px',
        borderRadius: 5,
        background: t.bg,
        color: t.fg,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
      }}
    >
      {children}
    </span>
  )
}

// A filled BAL pill in the rating's tone colour.
function BalPill({ rating, color }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 99,
        background: color,
        color: '#FFF',
        fontSize: 12,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {rating || '—'}
    </span>
  )
}

function formatSlope(row) {
  if (row.slopeDegrees == null) return '—'
  const dir =
    row.slopeDirection && row.slopeDirection !== 'flat' ? ` ${row.slopeDirection}` : ''
  return `${row.slopeDegrees}°${dir}`
}

function formatDistance(row) {
  if (!row.hasHazard) return '—'
  return row.distanceM != null ? `${row.distanceM} m` : '—'
}

const TH = {
  textAlign: 'left',
  padding: '8px 10px',
  fontSize: 11,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase',
  color: 'var(--euc-deep)',
  borderBottom: '1.5px solid var(--line)',
  whiteSpace: 'nowrap',
}

const TD = {
  padding: '9px 10px',
  fontSize: 13.5,
  color: 'var(--ink)',
  borderBottom: '1px solid var(--line)',
  verticalAlign: 'top',
}

export default function TransectTable({ result, rows }) {
  const data = rows ?? buildTransectRows(result)
  if (!data.length) return null

  return (
    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
      <thead>
        <tr>
          <th style={TH}>Transect</th>
          <th style={TH}>Direction</th>
          <th style={TH}>Vegetation</th>
          <th style={TH}>Eff. slope</th>
          <th style={TH}>Distance</th>
          <th style={TH}>BAL</th>
        </tr>
      </thead>
      <tbody>
        {data.map((row) => {
          // The governing (worst) side is emphasised: tinted background and a
          // red left border, the same treatment the map gives the governing patch.
          const rowStyle = row.isGoverning
            ? {
                background: 'color-mix(in oklab, var(--ember) 7%, transparent)',
                boxShadow: 'inset 3px 0 0 0 #7A1F1F',
              }
            : undefined
          const idWeight = row.isGoverning ? 800 : 600
          return (
            <tr key={row.id} style={rowStyle}>
              <td style={{ ...TD, fontWeight: idWeight, whiteSpace: 'nowrap' }}>
                {row.id}
                {row.isGoverning && <Tag tone="govern">Governs</Tag>}
              </td>
              <td style={{ ...TD, color: 'var(--ink-soft)' }}>{row.side ?? '—'}</td>
              <td style={TD}>
                {row.vegetationClass ?? (
                  <span style={{ color: 'var(--ink-soft)' }}>No hazard</span>
                )}
              </td>
              <td style={TD}>{formatSlope(row)}</td>
              <td style={{ ...TD, whiteSpace: 'nowrap' }}>{formatDistance(row)}</td>
              <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                <BalPill rating={row.bal} color={row.balColor} />
                {row.requiresReview && <Tag tone="ochre">Review</Tag>}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

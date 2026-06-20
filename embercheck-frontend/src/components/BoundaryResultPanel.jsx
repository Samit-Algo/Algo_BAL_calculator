import { balDescription } from '../lib/bal'
import { balToneColor } from '../lib/ec'
import { buildSideSummaries } from '../lib/report'
import { ECCard, ECEyebrow } from './ui/ECCard'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'

// A BAL chip tinted by the rating's tone colour (matches the map chips).
function BalChip({ rating }) {
  const color = balToneColor(rating)
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 7,
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
        fontSize: 12.5,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {rating || '—'}
    </span>
  )
}

// One compass side: its governing transect's vegetation + distance + slope + BAL.
// Hovering it asks the map to highlight that side's transects in real time.
function SideCard({ summary, onHover }) {
  const row = summary.representative
  const tone = balToneColor(row.bal)
  const governing = summary.isGoverningSide

  return (
    <div
      onMouseEnter={() => onHover?.(summary.side)}
      onMouseLeave={() => onHover?.(null)}
      style={{
        padding: 12,
        borderRadius: 14,
        border: governing
          ? '1.5px solid color-mix(in oklab, var(--ember, #7A1F1F) 55%, transparent)'
          : '1px solid var(--line)',
        background: governing
          ? 'color-mix(in oklab, var(--ember, #7A1F1F) 6%, var(--card))'
          : 'var(--card)',
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        {/* side badge, tinted by the BAL tone */}
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 52,
            padding: '3px 9px',
            borderRadius: 99,
            background: `color-mix(in oklab, ${tone} 16%, transparent)`,
            color: tone,
            fontSize: 12.5,
            fontWeight: 800,
          }}
        >
          {summary.side}
        </span>
        <BalChip rating={row.bal} />
        {governing && (
          <span
            style={{
              padding: '1px 7px',
              borderRadius: 5,
              background: 'color-mix(in oklab, var(--ember, #7A1F1F) 18%, transparent)',
              color: '#7A1F1F',
              fontSize: 10,
              fontWeight: 800,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}
          >
            Governs
          </span>
        )}
        {summary.requiresReview && (
          <span title="Needs review" style={{ color: 'var(--ochre)', display: 'inline-flex' }}>
            <Glyph name="warn" size={15} />
          </span>
        )}
      </div>

      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)', marginTop: 6 }}>
        {row.hasHazard ? row.vegetationClass : 'No hazardous vegetation'}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
        {row.hasHazard
          ? `${row.distanceM} m away · ${row.slopeDegrees}° ${row.slopeDirection || ''} slope`
          : 'none within range'}
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 4 }}>
        {summary.transectCount} transect{summary.transectCount === 1 ? '' : 's'} on this side
        {summary.hazardCount > 0 && summary.hazardCount < summary.transectCount
          ? ` · ${summary.hazardCount} found vegetation`
          : ''}
      </div>
    </div>
  )
}

// The boundary-mode result: per-side cards (worst transect each), the overall
// BAL, and a way back to the address (point) prediction. Hovering a card asks
// the map to highlight that side via onHoverSide.
export default function BoundaryResultPanel({ result, onHoverSide, onBack }) {
  if (!result) return null
  const summaries = buildSideSummaries(result)
  const tone = balToneColor(result.bal_rating)

  return (
    <ECCard>
      <div style={{ marginBottom: 12 }}>
        <ECButton variant="ghost" icon="chevronLeft" onClick={onBack}>
          Back to My Properties
        </ECButton>
      </div>

      <ECEyebrow>Assessed from your boundary</ECEyebrow>
      <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
        Each side of your block, measured from the boundary edge. The worst side governs the
        overall rating.
      </p>

      {/* one card per compass side, worst transect each */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {summaries.map((summary) => (
          <SideCard key={summary.side} summary={summary} onHover={onHoverSide} />
        ))}
      </div>

      {/* overall BAL — worst side governs */}
      <div
        style={{
          marginTop: 18,
          padding: '16px 18px',
          borderRadius: 16,
          border: `1.5px solid color-mix(in oklab, ${tone} 45%, transparent)`,
          background: `color-mix(in oklab, ${tone} 8%, var(--card))`,
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--euc-deep)',
            marginBottom: 8,
          }}
        >
          Final BAL — worst side governs
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 40,
              letterSpacing: '-0.01em',
              color: tone,
            }}
          >
            {result.bal_rating}
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>
            governed by{' '}
            <strong style={{ color: 'var(--ink)' }}>{result.governing_direction}</strong>
          </span>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
          {balDescription(result.bal_rating)}
        </p>
      </div>
    </ECCard>
  )
}

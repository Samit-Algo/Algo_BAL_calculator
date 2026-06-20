import { balDescription, governingVegetation } from '../lib/bal'
import { balIndex, balToneColor } from '../lib/ec'
import { ECCard, ECEyebrow } from './ui/ECCard'
import BALScale from './ui/BALScale'
import PrelimBadge from './ui/PrelimBadge'
import Glyph from './ui/Glyph'

// A confidence pill, tinted by level.
function ConfidenceBadge({ level }) {
  const tones = {
    High: { bg: 'color-mix(in oklab, var(--euc) 18%, transparent)', fg: 'var(--euc-deep)' },
    Medium: { bg: 'color-mix(in oklab, var(--ochre) 18%, transparent)', fg: '#7a5418' },
    Low: { bg: 'color-mix(in oklab, var(--ochre) 26%, transparent)', fg: '#7a5418' },
    Unknown: { bg: 'color-mix(in oklab, var(--ink) 10%, transparent)', fg: 'var(--ink-soft)' },
  }
  const t = tones[level] || tones.Unknown
  return (
    <span
      style={{
        padding: '3px 10px',
        borderRadius: 99,
        background: t.bg,
        color: t.fg,
        fontSize: 12,
        fontWeight: 700,
      }}
    >
      {level}
    </span>
  )
}

// One labelled detail row in the subordinate facts table.
function Row({ label, children }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        gap: 12,
        padding: '9px 0',
        borderBottom: '1px solid var(--line)',
      }}
    >
      <span style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>{label}</span>
      <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)', textAlign: 'right' }}>
        {children}
      </span>
    </div>
  )
}

function OverriddenTag() {
  return (
    <span
      style={{
        marginLeft: 6,
        padding: '1px 6px',
        borderRadius: 5,
        background: 'color-mix(in oklab, var(--ochre) 22%, transparent)',
        color: '#7a5418',
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
      }}
    >
      overridden
    </span>
  )
}

export default function ResultPanel({ result, overrides = {} }) {
  if (!result) return null

  const idx = balIndex(result.bal_rating)
  const tone = balToneColor(result.bal_rating)
  const distance = result.nearest_vegetation_distance_m
  // The governing side's vegetation (e.g. "Woodland") so we never surface the
  // top-level "Not classified".
  const veg = governingVegetation(result) || result.as3959_vegetation_class

  return (
    <ECCard>
      <ECEyebrow n="1">The indicative read</ECEyebrow>

      {/* the rating headline */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 6 }}>
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
        <span
          style={{
            width: 12,
            height: 12,
            borderRadius: 99,
            background: tone,
            boxShadow: `0 0 0 5px color-mix(in oklab, ${tone} 22%, transparent)`,
          }}
        />
      </div>
      <p style={{ margin: '0 0 14px', fontSize: 15, lineHeight: 1.5, color: 'var(--ink)' }}>
        {balDescription(result.bal_rating)}
      </p>

      {/* prominent preliminary indicator, right by the headline BAL */}
      <div style={{ marginBottom: 16 }}>
        <PrelimBadge />
      </div>

      {/* the spectrum */}
      <BALScale lo={idx} hi={idx} />

      {/* the honesty / review treatment — dashed ochre, first-class */}
      <div
        style={{
          marginTop: 20,
          padding: '16px',
          borderRadius: 16,
          background: 'color-mix(in oklab, var(--ochre) 14%, transparent)',
          border: '1.5px dashed color-mix(in oklab, var(--ochre) 65%, transparent)',
          display: 'flex',
          gap: 12,
        }}
      >
        <span style={{ color: 'var(--ochre)', flexShrink: 0, marginTop: 1 }}>
          <Glyph name={result.requires_manual_review ? 'warn' : 'info'} size={21} />
        </span>
        <div>
          <div style={{ fontSize: 14.5, fontWeight: 700, color: 'var(--ink)', marginBottom: 3 }}>
            {result.requires_manual_review
              ? 'Flagged for manual review'
              : 'A screening read — not a certificate'}
          </div>
          <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
            {result.requires_manual_review ? (
              <>
                This block sits near a threshold the public data can&apos;t resolve confidently. A
                qualified assessor should confirm it on the ground.
              </>
            ) : (
              <>
                Built from public mapping — terrain, vegetation and the bushfire-prone overlay. A
                formal BAL assessment by an accredited consultant is still required for a development
                application.
              </>
            )}
          </p>
        </div>
      </div>

      {/* subordinate facts */}
      <div style={{ marginTop: 18 }}>
        <div
          style={{
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: 'var(--euc-deep)',
            marginBottom: 6,
          }}
        >
          The data behind it
        </div>
        <Row label="AS 3959 vegetation">{veg}</Row>
        {result.svtm_vegetation_class && (
          <Row label="SVTM class">{result.svtm_vegetation_class}</Row>
        )}
        {result.pbp_formation && <Row label="Formation (PBP)">{result.pbp_formation}</Row>}
        {result.vegetation_pct_id != null && (
          <Row label="Plant community (PCT)">
            #{result.vegetation_pct_id}
            {result.vegetation_pct_name && (
              <span style={{ display: 'block', fontWeight: 400, color: 'var(--ink-soft)' }}>
                {result.vegetation_pct_name}
              </span>
            )}
          </Row>
        )}
        <Row label="Vegetation confidence">
          <ConfidenceBadge level={result.vegetation_confidence} />
        </Row>
        <Row label="Nearest vegetation">
          {result.vegetation_found_within_range && distance != null
            ? `${distance} m`
            : 'None within 150 m'}
        </Row>
        <Row label="Slope">
          {result.slope_degrees}° {result.slope_direction}
        </Row>
        <Row label="Effective slope (AS 3959)">
          {result.effective_slope_degrees}°{overrides.slope != null && <OverriddenTag />}
        </Row>
        <Row label="Slope band">{result.bal_slope_band}</Row>
        <Row label="Fire Danger Index">
          {result.fire_danger_index}
          {overrides.fireDanger != null && <OverriddenTag />}
        </Row>
      </div>
    </ECCard>
  )
}

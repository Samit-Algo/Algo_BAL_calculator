import { balColor, balDescription } from '../lib/bal'
import { photoUnreadable } from '../lib/report'
import { plog } from '../lib/debug'
import { ECCard, ECEyebrow } from './ui/ECCard'
import Glyph from './ui/Glyph'

const DIR_LABEL = { north: 'North', east: 'East', south: 'South', west: 'West' }

// A neutral grey pill for a side whose photo couldn't be read.
function UnclearChip() {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: 7,
        background: 'color-mix(in oklab, var(--ink) 10%, transparent)',
        color: 'var(--ink-soft)',
        fontSize: 12.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      Photo unclear
    </span>
  )
}

// Coloured BAL chip.
function BalChip({ rating, size = 'sm' }) {
  const color = balColor(rating)
  const big = size === 'lg'
  return (
    <span
      style={{
        display: 'inline-block',
        padding: big ? '4px 12px' : '2px 8px',
        borderRadius: big ? 10 : 7,
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
        fontSize: big ? 18 : 12.5,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {rating}
    </span>
  )
}

// Provenance pill: map reading, photo (VLM) reading, or a manual override.
function SourcePill({ source }) {
  const kind =
    source === 'override'
      ? { icon: 'doc', label: 'edited', bg: 'color-mix(in oklab, var(--ochre) 20%, transparent)', fg: '#7a5418' }
      : source === 'photo'
        ? { icon: 'camera', label: 'photo', bg: 'color-mix(in oklab, var(--euc) 20%, transparent)', fg: 'var(--euc-deep)' }
        : { icon: 'locate', label: 'map', bg: 'color-mix(in oklab, var(--ink) 9%, transparent)', fg: 'var(--ink-soft)' }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '2px 7px',
        borderRadius: 99,
        background: kind.bg,
        color: kind.fg,
        fontSize: 11,
        fontWeight: 700,
      }}
    >
      <Glyph name={kind.icon} size={11} />
      {kind.label}
    </span>
  )
}

// One captured side: its photo + the BAL we gave that direction.
function PhotoCard({ side, image }) {
  // recalc results use `source`; the original /assess/photos uses `class_source`.
  const source = side.class_source || side.source || 'map'
  const read = side.photo_read
  const why = source === 'photo' && read ? read.condition || read.limits : null
  // The VLM couldn't read this side's photo: say so directly with its limit,
  // rather than showing the map's fallback vegetation as a photo finding.
  const unreadable = photoUnreadable(side)
  return (
    <div
      style={{
        display: 'flex',
        gap: 12,
        padding: 10,
        borderRadius: 14,
        border: '1px solid var(--line)',
        background: 'var(--card)',
      }}
    >
      {/* the photo */}
      <div
        style={{
          position: 'relative',
          width: 96,
          flexShrink: 0,
          aspectRatio: '3 / 4',
          borderRadius: 10,
          overflow: 'hidden',
          background: 'var(--paper-deep)',
        }}
      >
        {image ? (
          <img
            src={image}
            alt={DIR_LABEL[side.direction?.toLowerCase()] || side.direction}
            style={{ width: '100%', height: '100%', objectFit: 'cover' }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--ink-soft)',
              fontSize: 11,
              textAlign: 'center',
              padding: 6,
            }}
          >
            No photo
          </div>
        )}
        <span
          style={{
            position: 'absolute',
            top: 6,
            left: 6,
            padding: '2px 8px',
            borderRadius: 99,
            background: 'rgba(20,18,11,0.6)',
            color: '#F7F2E2',
            fontSize: 11,
            fontWeight: 800,
            letterSpacing: '0.03em',
          }}
        >
          {DIR_LABEL[side.direction?.toLowerCase()] || side.direction}
        </span>
      </div>

      {/* its details */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {unreadable ? (
          <>
            <div style={{ marginBottom: 6 }}>
              <UnclearChip />
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              Couldn’t identify vegetation in this photo
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2, lineHeight: 1.4 }}>
              {read?.limits ||
                'The photo doesn’t show an outdoor vegetation scene, so it can’t be classified.'}
            </div>
          </>
        ) : (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, flexWrap: 'wrap' }}>
              <BalChip rating={side.bal_rating} />
              <SourcePill source={source} />
              {side.requires_manual_review && (
                <span title="Needs review" style={{ color: 'var(--ochre)', display: 'inline-flex' }}>
                  <Glyph name="warn" size={15} />
                </span>
              )}
            </div>
            <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--ink)' }}>
              {side.vegetation_found || side.needs_distance
                ? side.vegetation_class
                : 'No hazardous vegetation'}
            </div>
            <div style={{ fontSize: 12.5, color: 'var(--ink-soft)', marginTop: 2 }}>
              {side.needs_distance ? (
                <span style={{ color: '#7a5418', fontWeight: 600 }}>
                  Seen in your photo — not in the map. Add a distance on “Adjust the inputs” to rate it.
                </span>
              ) : side.vegetation_found ? (
                `${side.distance_m} m away · ${side.effective_slope_degrees}° slope`
              ) : (
                'none within 150 m'
              )}
            </div>
            {why && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4, marginTop: 4 }}>
                {why}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function SharpenedResultPanel({ result, photos = [] }) {
  if (!result) return null
  const tone = balColor(result.bal_rating)
  const sides = result.per_direction || []

  // Match each side to its captured photo by direction.
  const imageByDir = {}
  for (const p of photos || []) {
    if (p?.intended_direction) imageByDir[p.intended_direction.toLowerCase()] = p.image
  }
  plog(
    'SharpenedResultPanel img src by side',
    sides.map((s) => ({ dir: s.direction, src: imageByDir[s.direction?.toLowerCase()] || '(none)' })),
  )

  return (
    <ECCard>
      <ECEyebrow n="✓">Sharpened with your photos</ECEyebrow>

      <p style={{ margin: '0 0 16px', fontSize: 14, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
        Each photo, read on its own — the vegetation we found that way and the BAL it earns for that
        side.
      </p>

      {/* one card per side, showing the photo + its own BAL */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {sides.map((side) => (
          <PhotoCard
            key={side.direction}
            side={side}
            image={imageByDir[side.direction?.toLowerCase()]}
          />
        ))}
      </div>

      {/* the final, overall BAL */}
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
            governed by <strong style={{ color: 'var(--ink)' }}>{result.governing_direction}</strong>
          </span>
        </div>
        <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
          {balDescription(result.bal_rating)}
        </p>
      </div>

      {result.requires_manual_review && (
        <div
          style={{
            marginTop: 14,
            padding: '12px 14px',
            borderRadius: 14,
            background: 'color-mix(in oklab, var(--ochre) 14%, transparent)',
            border: '1.5px dashed color-mix(in oklab, var(--ochre) 65%, transparent)',
            display: 'flex',
            gap: 10,
            fontSize: 13.5,
            lineHeight: 1.5,
            color: 'var(--ink)',
          }}
        >
          <span style={{ color: 'var(--ochre)', flexShrink: 0, marginTop: 1 }}>
            <Glyph name="warn" size={18} />
          </span>
          <span>
            One or more sides need a human to confirm — flagged above with a warning icon.
          </span>
        </div>
      )}
    </ECCard>
  )
}

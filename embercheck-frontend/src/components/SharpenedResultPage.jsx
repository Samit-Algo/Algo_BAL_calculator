import { useEffect, useMemo, useState } from 'react'
import { balColor, balDescription } from '../lib/bal'
import { photoUnreadable } from '../lib/report'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'
import { recalculateBal } from '../lib/api'

const DIR_LABEL = { north: 'North', east: 'East', south: 'South', west: 'West' }

// AS 3959 vegetation types the user can pick from when the read looks wrong.
const VEG_OPTIONS = [
  ['Forest', 'Forest'],
  ['Woodland', 'Woodland'],
  ['Shrubland', 'Shrubland'],
  ['Scrub', 'Scrub'],
  ['Mallee/Heath', 'Mallee / Heath'],
  ['Rainforest', 'Rainforest'],
  ['Grassland', 'Grassland'],
  ['low_risk', 'Low risk / none'],
]

function BalChip({ rating, big }) {
  const color = balColor(rating)
  return (
    <span
      style={{
        display: 'inline-block',
        padding: big ? '4px 12px' : '2px 9px',
        borderRadius: big ? 10 : 7,
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
        fontSize: big ? 19 : 12.5,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {rating}
    </span>
  )
}

const fieldStyle = {
  width: '100%',
  padding: '7px 9px',
  borderRadius: 9,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 13,
  fontFamily: 'var(--font-ui)',
}

function Label({ children, overridden }) {
  return (
    <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', marginBottom: 3, display: 'flex', gap: 5, alignItems: 'center' }}>
      {children}
      {overridden && (
        <span style={{ color: '#7a5418', fontSize: 9.5, fontWeight: 800, letterSpacing: '0.05em' }}>
          ● OVERRIDDEN
        </span>
      )}
    </div>
  )
}

// One side: photo + its current BAL + the override controls.
function SideEditor({ base, side, image, override, onChange, onSlope }) {
  const dirKey = base.direction.toLowerCase()
  // The VLM couldn't read this side's photo and the user hasn't manually picked
  // a vegetation - say so honestly instead of showing the map's fallback class.
  const unreadable = photoUnreadable(base) && override.vegetation_class == null
  return (
    <div style={{ padding: 12, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--card)' }}>
      <div style={{ display: 'flex', gap: 12, marginBottom: 10 }}>
        <div
          style={{
            width: 64,
            flexShrink: 0,
            aspectRatio: '3 / 4',
            borderRadius: 9,
            overflow: 'hidden',
            background: 'var(--paper-deep)',
            position: 'relative',
          }}
        >
          {image && (
            <img src={image} alt={base.direction} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <strong style={{ fontSize: 15, color: 'var(--ink)' }}>{DIR_LABEL[dirKey] || base.direction}</strong>
            {unreadable ? (
              <span
                style={{
                  padding: '2px 8px',
                  borderRadius: 7,
                  background: 'color-mix(in oklab, var(--ink) 10%, transparent)',
                  color: 'var(--ink-soft)',
                  fontSize: 12,
                  fontWeight: 700,
                }}
              >
                Photo unclear
              </span>
            ) : (
              <BalChip rating={side.bal_rating} />
            )}
            {!unreadable && side.requires_manual_review && (
              <span title="Needs review" style={{ color: 'var(--ochre)', display: 'inline-flex' }}>
                <Glyph name="warn" size={14} />
              </span>
            )}
          </div>
          <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 3, lineHeight: 1.4 }}>
            {unreadable
              ? `Couldn’t identify vegetation in this photo${
                  base.photo_read?.limits ? ` — ${base.photo_read.limits}` : ''
                }. Pick a vegetation below if you want to rate this side.`
              : side.vegetation_found
                ? `${side.vegetation_class} · ${side.distance_m} m · ${side.effective_slope_degrees}° slope`
                : side.needs_distance
                  ? `${side.vegetation_class} seen in photo — set a distance to rate this side`
                  : 'No hazardous vegetation'}
          </div>
        </div>
      </div>

      {/* override controls: vegetation + distance */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 8 }}>
        <div>
          <Label overridden={override.vegetation_class != null}>Vegetation</Label>
          <select
            style={fieldStyle}
            value={override.vegetation_class ?? ''}
            onChange={(e) => onChange(dirKey, 'vegetation_class', e.target.value || null)}
          >
            <option value="">
              {unreadable
                ? 'Couldn’t identify — pick one'
                : base.vegetation_found || base.needs_distance
                  ? base.vegetation_class
                  : 'Use map'}
            </option>
            {VEG_OPTIONS.map(([v, label]) => (
              <option key={v} value={v}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label overridden={override.distance_m != null}>Distance m</Label>
          <input
            type="number"
            min="0"
            style={fieldStyle}
            placeholder={base.distance_m != null ? String(base.distance_m) : '—'}
            value={override.distance_m ?? ''}
            onChange={(e) =>
              onChange(dirKey, 'distance_m', e.target.value === '' ? null : Number(e.target.value))
            }
          />
        </div>
      </div>

      {/* slope: direction (toward the vegetation) + downslope angle. AS 3959
          treats upslope/flat as 0deg, so the degrees box is only for downslope. */}
      <div style={{ marginTop: 8 }}>
        <Label overridden={override.effective_slope_degrees != null}>Slope toward the vegetation</Label>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            style={{ ...fieldStyle, flex: 1.6 }}
            value={override.slope_dir ?? ''}
            onChange={(e) => onSlope(dirKey, e.target.value || null, override.slope_deg)}
          >
            <option value="">Use map ({base.slope_direction || 'flat'})</option>
            <option value="downslope">Downslope — bush below you</option>
            <option value="upslope">Upslope — bush above you</option>
            <option value="flat">Flat</option>
          </select>
          <input
            type="number"
            min="0"
            max="45"
            style={{ ...fieldStyle, flex: 1, opacity: override.slope_dir === 'downslope' ? 1 : 0.5 }}
            placeholder={String(base.effective_slope_degrees ?? 0)}
            value={override.slope_deg ?? ''}
            disabled={override.slope_dir !== 'downslope'}
            onChange={(e) =>
              onSlope(dirKey, 'downslope', e.target.value === '' ? null : Number(e.target.value))
            }
          />
          <span style={{ fontSize: 13, color: 'var(--ink-soft)' }}>°</span>
        </div>
        {override.slope_dir && override.slope_dir !== 'downslope' && (
          <div style={{ fontSize: 11, color: 'var(--ink-soft)', marginTop: 3 }}>
            Upslope or flat counts as 0° in AS 3959 — it doesn’t raise the BAL.
          </div>
        )}
      </div>
    </div>
  )
}

export default function SharpenedResultPage({ base, photos = [], onClose, onApply }) {
  const [fdiOverride, setFdiOverride] = useState(null)
  const [sideOverrides, setSideOverrides] = useState({}) // { north: {field: value} }
  const [result, setResult] = useState(base)
  const [error, setError] = useState(null)

  const imageByDir = useMemo(() => {
    const map = {}
    for (const p of photos || []) {
      if (p?.intended_direction) map[p.intended_direction.toLowerCase()] = p.image
    }
    return map
  }, [photos])

  // Only real backend overrides count as "adjusted" (e.g. picking a slope
  // direction without yet typing the degrees isn't a change).
  const hasOverrides =
    fdiOverride != null || Object.keys(pruneOverrides(sideOverrides)).length > 0

  // Recompute whenever an override changes (debounced). With no overrides we
  // simply show the original base result - that's the reset state.
  const overridesKey = JSON.stringify({ fdiOverride, sideOverrides })
  useEffect(() => {
    if (!hasOverrides) {
      setResult(base)
      setError(null)
      return
    }
    const timer = setTimeout(async () => {
      try {
        const data = await recalculateBal({
          fireDanger: base.fire_danger_index,
          fireDangerOverride: fdiOverride,
          perDirection: base.per_direction,
          overrides: pruneOverrides(sideOverrides),
        })
        setResult(data)
        setError(null)
      } catch (err) {
        setError(err.message)
      }
    }, 350)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overridesKey])

  // Surface the latest result to the parent so its summary stays in sync.
  useEffect(() => {
    onApply?.(hasOverrides ? result : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result])

  function changeSide(dir, field, value) {
    setSideOverrides((prev) => {
      const next = { ...prev, [dir]: { ...prev[dir] } }
      if (value == null || Number.isNaN(value)) delete next[dir][field]
      else next[dir][field] = value
      if (Object.keys(next[dir]).length === 0) delete next[dir]
      return next
    })
  }

  // Slope is captured as direction + degrees. AS 3959 effective slope =
  // the angle when downslope, 0 when upslope/flat. slope_dir / slope_deg are
  // UI-only fields (stripped before sending); effective_slope_degrees is sent.
  function changeSlope(dir, slopeDir, slopeDeg) {
    setSideOverrides((prev) => {
      const next = { ...prev, [dir]: { ...prev[dir] } }
      const entry = next[dir]
      if (!slopeDir) {
        delete entry.slope_dir
        delete entry.slope_deg
        delete entry.effective_slope_degrees
      } else if (slopeDir === 'downslope') {
        entry.slope_dir = 'downslope'
        entry.slope_deg = slopeDeg
        if (slopeDeg == null || Number.isNaN(slopeDeg)) delete entry.effective_slope_degrees
        else entry.effective_slope_degrees = slopeDeg
      } else {
        // upslope / flat -> AS 3959 effective slope is 0.
        entry.slope_dir = slopeDir
        delete entry.slope_deg
        entry.effective_slope_degrees = 0
      }
      if (Object.keys(entry).length === 0) delete next[dir]
      return next
    })
  }

  function reset() {
    setFdiOverride(null)
    setSideOverrides({})
    setResult(base)
    setError(null)
  }

  const tone = balColor(result.bal_rating)
  const sides = result.per_direction || []
  const sideOf = (dir) => sides.find((s) => s.direction === dir.direction) || dir

  return (
    <div className="ec-capture-overlay" role="dialog" aria-modal="true">
      <div className="ec-capture-panel" style={{ overflowY: 'auto' }}>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 30, width: 38, height: 38,
            borderRadius: 99, border: 'none', background: 'rgba(20,18,11,0.12)',
            color: 'var(--ink)', cursor: 'pointer', fontSize: 18, lineHeight: 1,
          }}
        >
          ×
        </button>

        <div style={{ padding: '54px 22px 28px' }}>
          <div
            style={{
              fontSize: 11, fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase',
              color: 'var(--euc-deep)', marginBottom: 10,
            }}
          >
            Sharpened result
          </div>

          {/* final BAL */}
          <div
            style={{
              padding: '16px 18px', borderRadius: 16, marginBottom: 8,
              border: `1.5px solid color-mix(in oklab, ${tone} 45%, transparent)`,
              background: `color-mix(in oklab, ${tone} 8%, var(--card))`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
              <span style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 40, color: tone }}>
                {result.bal_rating}
              </span>
              <span style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>
                worst side governs ·{' '}
                <strong style={{ color: 'var(--ink)' }}>{result.governing_direction}</strong>
              </span>
              {hasOverrides && (
                <span style={{ fontSize: 11, fontWeight: 800, color: '#7a5418', letterSpacing: '0.05em' }}>
                  ADJUSTED
                </span>
              )}
            </div>
            <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
              {balDescription(result.bal_rating)}
            </p>
          </div>

          <p style={{ margin: '0 0 16px', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
            The photo read can mismatch reality. Override any side’s vegetation, distance or slope (or
            the fire danger index) below and the BAL recalculates. Reset returns to the map reading.
          </p>

          {/* FDI override */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>Fire Danger Index</span>
            <select
              style={{ ...fieldStyle, width: 'auto' }}
              value={fdiOverride ?? ''}
              onChange={(e) => setFdiOverride(e.target.value === '' ? null : Number(e.target.value))}
            >
              <option value="">Auto ({base.fire_danger_index})</option>
              {[50, 80, 100].map((v) => (
                <option key={v} value={v}>
                  {v}
                </option>
              ))}
            </select>
          </div>

          {/* per-side editors */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {base.per_direction.map((b) => (
              <SideEditor
                key={b.direction}
                base={b}
                side={sideOf(b)}
                image={imageByDir[b.direction.toLowerCase()]}
                override={sideOverrides[b.direction.toLowerCase()] || {}}
                onChange={changeSide}
                onSlope={changeSlope}
              />
            ))}
          </div>

          {error && (
            <div style={{ marginTop: 12, fontSize: 13, color: '#b3402c', fontWeight: 600 }}>{error}</div>
          )}

          <div style={{ display: 'flex', gap: 10, marginTop: 18 }}>
            <ECButton variant="ghost" icon="refresh" onClick={reset} disabled={!hasOverrides}>
              Reset to map
            </ECButton>
            <ECButton full icon="check" onClick={onClose}>
              Done
            </ECButton>
          </div>
        </div>
      </div>
    </div>
  )
}

// Keep only the fields the backend understands (slope_dir / slope_deg are
// UI-only), dropping empty side entries.
const BACKEND_FIELDS = ['distance_m', 'effective_slope_degrees', 'vegetation_class']
function pruneOverrides(sideOverrides) {
  const out = {}
  for (const [dir, fields] of Object.entries(sideOverrides)) {
    const kept = {}
    for (const k of BACKEND_FIELDS) if (fields[k] != null) kept[k] = fields[k]
    if (Object.keys(kept).length) out[dir] = kept
  }
  return out
}

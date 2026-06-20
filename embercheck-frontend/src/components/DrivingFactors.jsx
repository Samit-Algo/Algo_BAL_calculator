import { directionToVegetation } from '../lib/geo'
import { ECCard, ECEyebrow } from './ui/ECCard'
import DriverSwatch from './ui/DriverSwatch'

// One narrative "driver": a material swatch, a headline + value/tag chips, and a
// plain-English explanation.
function Driver({ kind, title, value, tag, tagTone = 'euc', children }) {
  const tagColor = tagTone === 'ochre' ? 'var(--ochre)' : 'var(--euc-deep)'
  return (
    <div style={{ display: 'flex', gap: 14 }}>
      <DriverSwatch kind={kind} />
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flexWrap: 'wrap',
            marginBottom: 3,
          }}
        >
          <span style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--ink)' }}>{title}</span>
          {value && (
            <span
              style={{
                fontSize: 12,
                fontWeight: 700,
                padding: '2px 9px',
                borderRadius: 99,
                background: 'color-mix(in oklab, var(--euc-deep) 12%, transparent)',
                color: 'var(--euc-deep)',
              }}
            >
              {value}
            </span>
          )}
          {tag && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 800,
                letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: tagColor,
              }}
            >
              {tag}
            </span>
          )}
        </div>
        <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
          {children}
        </p>
      </div>
    </div>
  )
}

export default function DrivingFactors({ result }) {
  if (!result) return null

  const found = result.vegetation_found_within_range
  const distance = result.nearest_vegetation_distance_m
  const direction = directionToVegetation(result.geometry?.distance_line)
  const slopeDir = result.slope_direction
  const effSlope = result.effective_slope_degrees

  return (
    <ECCard>
      <ECEyebrow n="2">What&apos;s driving it</ECEyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
        {/* Main driver: nearest hazardous vegetation. */}
        {found ? (
          <Driver
            kind="forest"
            title={`${result.as3959_vegetation_class}${direction ? ` to the ${direction}` : ''}`}
            value={distance != null ? `${distance} m` : 'within range'}
            tag="Main driver"
            tagTone="ochre"
          >
            A stand of <strong>{result.svtm_vegetation_class || result.as3959_vegetation_class}</strong>
            {direction ? ` sits to the ${direction}, ` : ' sits '}
            {distance != null ? `about ${distance} m` : 'within range'} from the property. Vegetation
            this close is the single biggest driver of your rating.
          </Driver>
        ) : (
          <Driver kind="grass" title="No hazardous vegetation nearby" value="BAL-LOW">
            No hazardous vegetation was found within 150 m of the property, so there&apos;s no
            significant bushfire exposure to drive the rating up.
          </Driver>
        )}

        {/* Slope. */}
        {found && (
          <Driver
            kind="slope"
            title={
              slopeDir === 'downslope'
                ? 'The land falls toward it'
                : slopeDir === 'upslope'
                  ? 'The land rises toward your block'
                  : 'The ground is roughly flat'
            }
            value={`${effSlope}°`}
            tag={slopeDir === 'downslope' ? 'Pushes it up' : undefined}
            tagTone="ochre"
          >
            {slopeDir === 'downslope' && (
              <>
                Your block sits above the vegetation, and fire runs faster uphill. A {effSlope}°
                downslope toward the vegetation pushes the rating up.
              </>
            )}
            {slopeDir === 'upslope' && (
              <>
                The ground rises from the vegetation up to your block, which slows a fire&apos;s
                spread. This works in your favour.
              </>
            )}
            {slopeDir === 'flat' && (
              <>
                The ground between your block and the vegetation is roughly level, so slope
                isn&apos;t adding to the rating.
              </>
            )}
          </Driver>
        )}

        {/* Fire Danger Index context. */}
        <Driver
          kind="grass"
          title="Fire Danger Index"
          value={`FDI ${result.fire_danger_index}`}
          tag={result.fire_danger_index >= 100 ? 'Severe weather' : undefined}
          tagTone="ochre"
        >
          The regulatory Fire Danger Index for {result.lga} is {result.fire_danger_index}. A higher
          FDI assumes more severe fire weather and raises the construction standard.
        </Driver>
      </div>
    </ECCard>
  )
}

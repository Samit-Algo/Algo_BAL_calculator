// Small material chips that stand in for the rating drivers — no icon-slop.
// kind: 'forest' (hatched vegetation), 'slope' (a falling grade), 'grass'
// (low-fuel speckle). Ported from the reference design.
export default function DriverSwatch({ kind }) {
  const base = {
    width: 40,
    height: 40,
    borderRadius: 12,
    flexShrink: 0,
    boxSizing: 'border-box',
    position: 'relative',
    overflow: 'hidden',
  }
  if (kind === 'forest') {
    return (
      <span
        style={{
          ...base,
          background: 'repeating-linear-gradient(-38deg, #44543A 0 3px, #56664A 3px 7px)',
        }}
      ></span>
    )
  }
  if (kind === 'slope') {
    return (
      <span style={{ ...base, background: '#E4DCC6' }}>
        <span
          style={{
            position: 'absolute',
            inset: 0,
            background:
              'linear-gradient(to top right, #B49C66 0%, #B49C66 49.5%, transparent 50%)',
          }}
        ></span>
      </span>
    )
  }
  // grass / low-fuel
  return (
    <span
      style={{
        ...base,
        background:
          'radial-gradient(3px 3px at 25% 30%, #B7A570 50%, transparent 52%), radial-gradient(3px 3px at 65% 60%, #B7A570 50%, transparent 52%), radial-gradient(3px 3px at 40% 75%, #B7A570 50%, transparent 52%), radial-gradient(3px 3px at 78% 25%, #B7A570 50%, transparent 52%), #D8CB9E',
      }}
    ></span>
  )
}

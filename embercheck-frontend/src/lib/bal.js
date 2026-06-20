// Colour lookups for the UI. Kept separate from the data so the backend's
// classification stays the single source of truth and we only map it to colour.

// BAL rating -> colour, low risk (green) through Flame Zone (deep red).
const BAL_COLORS = {
  'BAL-LOW': '#4B8B3B',
  'BAL-12.5': '#E0B33A',
  'BAL-19': '#E08A2E',
  'BAL-29': '#D9662B',
  'BAL-40': '#C23B22',
  'BAL-FZ': '#7A1F1F',
}

export function balColor(rating) {
  return BAL_COLORS[rating] || '#6B7280' // grey fallback for unknown ratings
}

// A short, human description for each BAL rating.
const BAL_DESCRIPTIONS = {
  'BAL-LOW': 'Very low risk — no special construction requirements.',
  'BAL-12.5': 'Risk of ember attack.',
  'BAL-19': 'Increasing ember attack and burning debris, some radiant heat.',
  'BAL-29': 'Increasing ember attack and burning debris, higher radiant heat.',
  'BAL-40': 'Increasing radiant heat with the likelihood of flame contact.',
  'BAL-FZ': 'Flame Zone — direct exposure to flames from the fire front.',
}

export function balDescription(rating) {
  return BAL_DESCRIPTIONS[rating] || ''
}

// AS 3959 vegetation class -> fill colour for the map patches. Kept distinct
// from BAL colours so map styling and risk colouring stay independent.
const VEG_COLORS = {
  Forest: '#2F5D34',
  Woodland: '#5C8A3A',
  Shrubland: '#8FA63A',
  'Scrub': '#8FA63A',
  Heath: '#A9863A',
  'Mallee': '#7A9A4A',
  'Rainforest': '#1F5135',
  'Grassland': '#C9B458',
}

export function vegColor(as3959Class) {
  return VEG_COLORS[as3959Class] || '#6F8F4A'
}

// The GOVERNING side's vegetation class (e.g. "Woodland"), derived from the
// assessment dict the same way the backend does — so the UI shows the side that
// sets the BAL rather than the top-level "Not classified". Returns null if no
// per-direction class is available (callers fall back as they see fit).
export function governingVegetation(result) {
  if (!result) return null
  const sides = result.per_direction || []
  const dir = result.governing_direction
  if (dir) {
    const side = sides.find(
      (s) => String(s.direction).toLowerCase() === String(dir).toLowerCase(),
    )
    if (side?.vegetation_class) return side.vegetation_class
  }
  const any = sides.find((s) => s.vegetation_class)
  return any?.vegetation_class || null
}

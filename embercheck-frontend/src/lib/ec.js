// EmberCheck shared design data — the BAL spectrum used by the BALScale and the
// rating accents. Earthy palette ported from the reference design.
export const EC_BAL = [
  { id: 'LOW', label: 'Low', color: '#8A9670', meaning: 'Very low exposure' },
  { id: '12.5', label: '12.5', color: '#A9A05C', meaning: 'Ember attack possible' },
  { id: '19', label: '19', color: '#C2924A', meaning: 'Tougher glazing & sealing' },
  { id: '29', label: '29', color: '#B06F3A', meaning: 'Tougher glazing, sealing & decking' },
  { id: '40', label: '40', color: '#94512F', meaning: 'Shutters, heavy screening' },
  { id: 'FZ', label: 'FZ', color: '#6E3A26', meaning: 'Flame zone — specialist design' },
]

// Map a backend rating string ("BAL-19", "BAL-FZ", …) to its index in EC_BAL.
// Returns -1 for anything unrecognised.
export function balIndex(rating) {
  if (!rating) return -1
  const id = String(rating).replace(/^BAL-/i, '').toUpperCase()
  return EC_BAL.findIndex((b) => b.id.toUpperCase() === id)
}

// The spectrum colour for a backend rating.
export function balToneColor(rating) {
  const i = balIndex(rating)
  return i >= 0 ? EC_BAL[i].color : '#6B7280'
}

// The worst (highest-severity) rating among those given, by BAL spectrum order;
// null/unknown ratings are ignored. SAFETY: the single property headline uses
// this so it never sits below ANY individual read (point, photo-sharpened
// point, or boundary edge). Returns null when nothing is recognisable.
export function worstBalRating(ratings) {
  let worst = null
  let worstIdx = -1
  for (const rating of ratings) {
    const i = balIndex(rating)
    if (i > worstIdx) {
      worstIdx = i
      worst = rating
    }
  }
  return worst
}

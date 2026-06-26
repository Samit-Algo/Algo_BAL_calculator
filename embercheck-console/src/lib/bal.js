// BAL spectrum + confidence banding — non-component shared values, kept out of
// the component file so fast-refresh stays happy.

// Lifted verbatim from the mockup's embercheck/shared.jsx (EC_BAL).
export const EC_BAL = [
  { id: 'LOW', label: 'Low', color: '#8A9670' },
  { id: '12.5', label: '12.5', color: '#A9A05C' },
  { id: '19', label: '19', color: '#C2924A' },
  { id: '29', label: '29', color: '#B06F3A' },
  { id: '40', label: '40', color: '#94512F' },
  { id: 'FZ', label: 'FZ', color: '#6E3A26' },
]

// Map a 0–1 confidence to the mockup's discrete conf band. 0.7 is the safety
// threshold (below it the conservative value stands).
export function confBand(confidence) {
  if (confidence == null) return null
  if (confidence >= 0.7) return 'high'
  if (confidence >= 0.4) return 'medium'
  return 'low'
}

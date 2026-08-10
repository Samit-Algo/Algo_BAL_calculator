// Display formatting. A missing value is always shown as an em dash rather than
// a zero, so "unknown" never reads as "none".

export const EMPTY_VALUE = "—";

export function formatMetres(value, suffix = " m") {
  if (value === null || value === undefined) return EMPTY_VALUE;
  return Number(value).toFixed(2) + suffix;
}

export function formatDepthAboveGround(level, groundLevel) {
  if (level === null || level === undefined) return EMPTY_VALUE;
  if (groundLevel === null || groundLevel === undefined) return EMPTY_VALUE;
  return Math.max(0, level - groundLevel).toFixed(2) + " m";
}

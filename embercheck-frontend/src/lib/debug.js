// Temporary instrumentation for the "photo on resume" investigation.
// To silence ALL [photo] logging, flip PHOTO_DEBUG to false (this one line).
export const PHOTO_DEBUG = true

export function plog(...args) {
  if (PHOTO_DEBUG) console.debug('[photo]', ...args)
}

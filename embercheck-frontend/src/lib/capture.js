// Guided-capture helpers: the four directions, compass/heading math, and the
// on-device photo quality checks. Pure functions — no React, no I/O.

export const DIRECTIONS = [
  { key: 'north', label: 'North', short: 'N', target: 0 },
  { key: 'east', label: 'East', short: 'E', target: 90 },
  { key: 'south', label: 'South', short: 'S', target: 180 },
  { key: 'west', label: 'West', short: 'W', target: 270 },
]

// Smallest absolute angle (0–180) between two compass bearings.
export function angularDiff(a, b) {
  const d = Math.abs((((a - b) % 360) + 360) % 360)
  return d > 180 ? 360 - d : d
}

// Signed turn (−180…180) from `heading` to `target`. Positive = turn right
// (clockwise), negative = turn left.
export function signedTurn(heading, target) {
  return (((target - heading + 540) % 360) - 180)
}

export const ALIGN_TOLERANCE = 25 // degrees — "roughly facing" the target

export function isAligned(heading, target) {
  return heading != null && angularDiff(heading, target) <= ALIGN_TOLERANCE
}

// User-facing reasons when a quality check rejects a frame.
export const REJECT_MESSAGES = {
  brightness: 'Too dark — find more light or try again.',
  sharpness: 'Looks blurry — hold steady and retake.',
}

const BRIGHTNESS_MIN = 40 // 0–255 average luminance
const SHARPNESS_MIN = 55 // variance of a Laplacian over the downscaled frame

// Capture the current video frame: returns the full-res JPEG dataURL plus the
// brightness/sharpness measures used by evaluateQuality. Returns null if the
// video has no dimensions yet.
export function captureFrame(video) {
  const w = video.videoWidth
  const h = video.videoHeight
  if (!w || !h) return null

  // Full-resolution JPEG for storage.
  const full = document.createElement('canvas')
  full.width = w
  full.height = h
  full.getContext('2d').drawImage(video, 0, 0, w, h)
  const dataURL = full.toDataURL('image/jpeg', 0.85)

  // Downscaled greyscale copy for the cheap on-device analysis.
  const sw = 160
  const sh = Math.max(1, Math.round((h / w) * 160))
  const sc = document.createElement('canvas')
  sc.width = sw
  sc.height = sh
  const sx = sc.getContext('2d', { willReadFrequently: true })
  sx.drawImage(video, 0, 0, sw, sh)
  const { data } = sx.getImageData(0, 0, sw, sh)

  const gray = new Float32Array(sw * sh)
  let sum = 0
  for (let i = 0; i < sw * sh; i++) {
    const y = 0.299 * data[i * 4] + 0.587 * data[i * 4 + 1] + 0.114 * data[i * 4 + 2]
    gray[i] = y
    sum += y
  }
  const brightness = sum / (sw * sh)

  // Variance of the Laplacian (edge energy) — a standard cheap blur measure.
  let n = 0
  let mean = 0
  let M2 = 0
  for (let y = 1; y < sh - 1; y++) {
    for (let x = 1; x < sw - 1; x++) {
      const i = y * sw + x
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - sw] - gray[i + sw]
      n++
      const d = lap - mean
      mean += d / n
      M2 += d * (lap - mean)
    }
  }
  const sharpness = n ? M2 / n : 0

  return { dataURL, brightness, sharpness, width: w, height: h }
}

// Turn the raw measures into the named pass/fail checks stored on each photo.
export function evaluateQuality(frame) {
  return [
    {
      name: 'brightness',
      passed: frame.brightness >= BRIGHTNESS_MIN,
      value: Math.round(frame.brightness),
    },
    {
      name: 'sharpness',
      passed: frame.sharpness >= SHARPNESS_MIN,
      value: Math.round(frame.sharpness),
    },
  ]
}

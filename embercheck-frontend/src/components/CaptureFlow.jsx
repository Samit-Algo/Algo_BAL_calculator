import { useCallback, useEffect, useRef, useState } from 'react'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'
import {
  DIRECTIONS,
  isAligned,
  signedTurn,
  captureFrame,
  evaluateQuality,
  REJECT_MESSAGES,
} from '../lib/capture'

// True when the page isn't in a secure context, where camera/compass are blocked.
function notSecure() {
  return typeof window !== 'undefined' && window.isSecureContext === false
}

// Compass bearing (0–360, 0 = north) that the BACK camera is pointing, derived
// from the full device orientation. We project the device's −Z axis (out the
// back of the phone) onto the horizontal plane and take its azimuth. Because it
// depends on where the camera points — not on the device's top edge — it stays
// correct whether the phone is held portrait or landscape (rolling about the
// viewing axis doesn't change the camera direction).
function cameraBearing(alphaDeg, betaDeg, gammaDeg) {
  const d2r = Math.PI / 180
  const a = alphaDeg * d2r
  const b = betaDeg * d2r
  const g = gammaDeg * d2r
  const cA = Math.cos(a)
  const sA = Math.sin(a)
  const sB = Math.sin(b)
  const cG = Math.cos(g)
  const sG = Math.sin(g)
  // World (East, North) components of the device +Z axis (screen normal).
  const zEast = cA * sG + sA * sB * cG
  const zNorth = sA * sG - cA * sB * cG
  // The camera points along −Z; bearing is the azimuth of that direction.
  const deg = Math.atan2(-zEast, -zNorth) * (180 / Math.PI)
  return ((deg % 360) + 360) % 360
}

const EMPTY4 = [null, null, null, null]

export default function CaptureFlow({ onClose, onComplete }) {
  const [phase, setPhase] = useState('intro') // intro | capturing | review
  const [stepIndex, setStepIndex] = useState(0)
  const [photos, setPhotos] = useState(EMPTY4)
  const [heading, setHeading] = useState(null)
  const [headingSupported, setHeadingSupported] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [stream, setStream] = useState(null)
  const [cameraError, setCameraError] = useState(null)
  const [reject, setReject] = useState(null)
  const [location, setLocation] = useState(null)
  const [showManual, setShowManual] = useState(false)
  const [manualPick, setManualPick] = useState(false)
  const [starting, setStarting] = useState(false)

  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const dir = DIRECTIONS[stepIndex]
  const aligned = headingSupported ? isAligned(heading, dir.target) : true
  const captureReady = videoReady && !cameraError && aligned

  // ── Orientation handler (stable identity for add/removeEventListener) ──
  const onOrientation = useCallback((e) => {
    // North-referenced alpha: iOS exposes a calibrated compass heading we convert
    // back to an alpha; Android's absolute orientation already gives one.
    let alpha = null
    if (typeof e.webkitCompassHeading === 'number' && !Number.isNaN(e.webkitCompassHeading)) {
      alpha = 360 - e.webkitCompassHeading
    } else if (e.absolute === true && typeof e.alpha === 'number') {
      alpha = e.alpha
    }
    if (alpha == null) return

    if (typeof e.beta === 'number' && typeof e.gamma === 'number') {
      setHeading(cameraBearing(alpha, e.beta, e.gamma))
    } else {
      // No tilt data — fall back to the flat top-edge heading.
      setHeading(((360 - alpha) % 360 + 360) % 360)
    }
    setHeadingSupported(true)
  }, [])
  const onOrientationRef = useRef(null)
  useEffect(() => {
    onOrientationRef.current = onOrientation
  }, [onOrientation])

  // ── Permission requests (must run on the Start tap) ──
  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error('no-camera')
    }
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
    streamRef.current = s
    setStream(s)
  }

  async function requestOrientation() {
    try {
      const DOE = window.DeviceOrientationEvent
      if (typeof DOE === 'undefined') return
      if (typeof DOE.requestPermission === 'function') {
        const res = await DOE.requestPermission()
        if (res !== 'granted') return
      }
      window.addEventListener('deviceorientationabsolute', onOrientationRef.current, true)
      window.addEventListener('deviceorientation', onOrientationRef.current, true)
    } catch {
      /* unsupported / denied → manual fallback kicks in */
    }
  }

  function requestLocation() {
    if (!('geolocation' in navigator)) return
    navigator.geolocation.getCurrentPosition(
      (pos) =>
        setLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracy_in_metres: pos.coords.accuracy,
        }),
      () => setLocation(null),
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 },
    )
  }

  async function handleStart() {
    setStarting(true)
    setVideoReady(false)
    setCameraError(null)
    try {
      await startCamera()
    } catch {
      setCameraError(
        notSecure()
          ? 'Your browser blocked the camera. Camera access needs a secure (https) connection.'
          : 'We couldn’t open your camera. Check the browser’s camera permission and try again.',
      )
    }
    await requestOrientation()
    requestLocation()
    setStepIndex(photos.findIndex((p) => !p) === -1 ? 0 : photos.findIndex((p) => !p))
    setPhase('capturing')
    setStarting(false)
  }

  async function retryCamera() {
    setCameraError(null)
    setVideoReady(false)
    try {
      await startCamera()
    } catch {
      setCameraError(
        'Still no camera. Open this site over https and allow camera access in your browser.',
      )
    }
  }

  // Attach the stream to the <video> whenever we're capturing.
  useEffect(() => {
    const v = videoRef.current
    if (phase === 'capturing' && v && stream) {
      v.srcObject = stream
      v.play().catch(() => {})
    }
  }, [phase, stream])

  // Lock body scroll + tidy everything up on unmount (stop tracks/listeners).
  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
      window.removeEventListener('deviceorientation', onOrientationRef.current, true)
      window.removeEventListener('deviceorientationabsolute', onOrientationRef.current, true)
    }
  }, [])

  function handleCapture() {
    const v = videoRef.current
    if (!v) return
    const frame = captureFrame(v)
    if (!frame) {
      setReject('Camera’s still warming up — give it a second and try again.')
      return
    }
    const checks = evaluateQuality(frame)
    const failed = checks.find((c) => !c.passed)
    if (failed) {
      setReject(REJECT_MESSAGES[failed.name] || 'Please retake.')
      return
    }
    const photo = {
      intended_direction: dir.key,
      compass_heading_at_capture: heading != null ? Math.round(heading) : null,
      location,
      captured_at: new Date().toISOString(),
      direction_source: headingSupported && !manualPick ? 'compass' : 'manual',
      quality_check_results: checks,
      image: frame.dataURL,
    }
    const next = [...photos]
    next[stepIndex] = photo
    setPhotos(next)
    setReject(null)
    setManualPick(false)
    setShowManual(false)
    const nextIdx = next.findIndex((p) => !p)
    if (nextIdx === -1) setPhase('review')
    else setStepIndex(nextIdx)
  }

  function pickDirection(i) {
    setStepIndex(i)
    setManualPick(true)
    setShowManual(false)
    setReject(null)
  }

  function retake(i) {
    setStepIndex(i)
    setManualPick(false)
    setReject(null)
    setVideoReady(false)
    setPhase('capturing')
  }

  function finish() {
    onComplete?.(photos.filter(Boolean))
    onClose?.()
  }

  // ── Render ──
  return (
    <div className="ec-capture-overlay" role="dialog" aria-modal="true">
      <div className="ec-capture-panel">
        <CloseButton onClose={onClose} />
        {phase === 'intro' && <IntroScreen onStart={handleStart} starting={starting} />}
        {phase === 'capturing' && (
          <CaptureScreen
            dir={dir}
            stepIndex={stepIndex}
            photos={photos}
            videoRef={videoRef}
            onVideoReady={() => setVideoReady(true)}
            cameraError={cameraError}
            onRetryCamera={retryCamera}
            heading={heading}
            headingSupported={headingSupported}
            aligned={aligned}
            captureReady={captureReady}
            reject={reject}
            showManual={showManual}
            onToggleManual={() => setShowManual((s) => !s)}
            onPickDirection={pickDirection}
            onCapture={handleCapture}
          />
        )}
        {phase === 'review' && (
          <ReviewScreen photos={photos} onRetake={retake} onFinish={finish} />
        )}
      </div>
    </div>
  )
}

function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      style={{
        position: 'absolute',
        top: 14,
        right: 14,
        zIndex: 30,
        width: 38,
        height: 38,
        borderRadius: 99,
        border: 'none',
        background: 'rgba(20,18,11,0.45)',
        color: '#F7F2E2',
        cursor: 'pointer',
        fontSize: 18,
        lineHeight: 1,
      }}
    >
      ×
    </button>
  )
}

// ── Intro ──────────────────────────────────────────────────────────
function IntroScreen({ onStart, starting }) {
  const perms = [
    { icon: 'camera', label: 'Camera', sub: 'to take the four photos' },
    { icon: 'locate', label: 'Compass', sub: 'to help you aim each one' },
    { icon: 'locate', label: 'Location', sub: 'to pin them to your block' },
  ]
  return (
    <div
      style={{
        flex: 1,
        overflowY: 'auto',
        padding: '64px 24px 28px',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ flex: 0.6 }} />
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 28,
          lineHeight: 1.1,
          color: 'var(--ink)',
          margin: '0 0 12px',
        }}
      >
        Four photos, one from each direction
      </h2>
      <p style={{ fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-soft)', margin: '0 0 24px' }}>
        Stand where the house is. We’ll guide you to face north, east, south and west, and
        photograph the trees, bushes or grass around you. Takes about two minutes.
      </p>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
        {perms.map((p) => (
          <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <span
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                flexShrink: 0,
                background: 'color-mix(in oklab, var(--euc-deep) 12%, transparent)',
                color: 'var(--euc-deep)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Glyph name={p.icon} size={22} />
            </span>
            <div>
              <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--ink)' }}>{p.label}</div>
              <div style={{ fontSize: 13, color: 'var(--ink-soft)' }}>{p.sub}</div>
            </div>
          </div>
        ))}
      </div>

      {notSecure() && (
        <div
          style={{
            marginBottom: 16,
            padding: '11px 14px',
            borderRadius: 12,
            background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
            border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
            color: '#7a2418',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          The camera and compass need a secure (https) connection — they may be blocked here.
        </div>
      )}

      <div style={{ flex: 1 }} />
      <ECButton full icon="camera" onClick={onStart} disabled={starting}>
        {starting ? 'Getting ready…' : 'Start'}
      </ECButton>
      <p
        style={{
          margin: '12px 4px 0',
          fontSize: 12.5,
          lineHeight: 1.5,
          color: 'var(--ink-soft)',
          textAlign: 'center',
        }}
      >
        Your photos stay on your device until you choose to use them.
      </p>
    </div>
  )
}

// ── Capture ────────────────────────────────────────────────────────
function CaptureScreen({
  dir,
  stepIndex,
  photos,
  videoRef,
  onVideoReady,
  cameraError,
  onRetryCamera,
  heading,
  headingSupported,
  aligned,
  captureReady,
  reject,
  showManual,
  onToggleManual,
  onPickDirection,
  onCapture,
}) {
  const turn = headingSupported && heading != null ? signedTurn(heading, dir.target) : 0
  const turnHint = aligned
    ? `You’re facing ${dir.label.toLowerCase()} — hold steady`
    : turn > 0
      ? `Turn right to face ${dir.label.toLowerCase()}`
      : `Turn left to face ${dir.label.toLowerCase()}`

  return (
    <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', background: '#14130d' }}>
      {/* live preview */}
      <video
        ref={videoRef}
        playsInline
        muted
        autoPlay
        onLoadedMetadata={onVideoReady}
        onPlaying={onVideoReady}
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }}
      />

      {/* framing guide */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden="true"
        style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
      >
        <rect x="8" y="14" width="84" height="72" fill="none" stroke="rgba(247,242,226,0.6)" strokeWidth="0.6" />
        <line x1="8" y1="50" x2="92" y2="50" stroke="rgba(247,242,226,0.45)" strokeWidth="0.5" strokeDasharray="2 2" />
      </svg>

      {/* top progress bar */}
      <div style={{ position: 'relative', zIndex: 10, padding: '16px 16px 0' }}>
        <div
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 12px',
            borderRadius: 99,
            background: 'rgba(20,18,11,0.55)',
            color: '#F7F2E2',
            fontSize: 13,
            fontWeight: 700,
          }}
        >
          Photo {stepIndex + 1} of 4
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          {DIRECTIONS.map((d, i) => {
            const done = !!photos[i]
            const active = i === stepIndex
            return (
              <div
                key={d.key}
                style={{
                  flex: 1,
                  height: 6,
                  borderRadius: 99,
                  background: done
                    ? '#9FB87E'
                    : active
                      ? 'rgba(247,242,226,0.85)'
                      : 'rgba(247,242,226,0.3)',
                }}
              />
            )
          })}
        </div>
      </div>

      {/* instruction */}
      <div style={{ position: 'relative', zIndex: 10, padding: '12px 16px' }}>
        <div
          style={{
            background: 'rgba(20,18,11,0.62)',
            backdropFilter: 'blur(8px)',
            WebkitBackdropFilter: 'blur(8px)',
            borderRadius: 16,
            padding: '12px 14px',
            color: '#F7F2E2',
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, marginBottom: 3 }}>
            Face {dir.label.toUpperCase()} and photograph the trees, bushes or grass
          </div>
          <div style={{ fontSize: 12.5, color: 'rgba(247,242,226,0.78)', lineHeight: 1.4 }}>
            Fit the whole spread in — get the sky and the ground, and the full height of the
            vegetation. Too close? Step back.
          </div>
        </div>
      </div>

      <div style={{ flex: 1 }} />

      {/* camera error overlay */}
      {cameraError && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 20,
            background: 'rgba(16,15,10,0.9)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 16,
            padding: 28,
            textAlign: 'center',
          }}
        >
          <span style={{ color: '#E8C87D' }}>
            <Glyph name="warn" size={40} />
          </span>
          <div style={{ color: '#F7F2E2', fontSize: 15, lineHeight: 1.5, maxWidth: 300 }}>
            {cameraError}
          </div>
          <ECButton variant="ochre" icon="refresh" onClick={onRetryCamera}>
            Try the camera again
          </ECButton>
        </div>
      )}

      {/* bottom controls */}
      <div
        style={{
          position: 'relative',
          zIndex: 10,
          padding: '0 16px 24px',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 14,
        }}
      >
        {/* compass OR manual selector */}
        {headingSupported ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 8 }}>
            <CompassDial heading={heading || 0} target={dir.target} aligned={aligned} />
            <div
              style={{
                fontSize: 13,
                fontWeight: 700,
                color: aligned ? '#C8DBA2' : 'rgba(247,242,226,0.92)',
                textAlign: 'center',
              }}
            >
              {turnHint}
            </div>
          </div>
        ) : (
          <ManualSelector dir={dir} onPick={onPickDirection} />
        )}

        {reject && (
          <div
            style={{
              padding: '8px 14px',
              borderRadius: 99,
              background: 'rgba(179,64,44,0.92)',
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              textAlign: 'center',
            }}
          >
            {reject}
          </div>
        )}

        {/* shutter */}
        <button
          type="button"
          className="ec-press"
          onClick={onCapture}
          disabled={!captureReady}
          aria-label={`Capture ${dir.label}`}
          style={{
            width: 76,
            height: 76,
            borderRadius: 99,
            border: '4px solid rgba(247,242,226,0.9)',
            background: 'transparent',
            cursor: captureReady ? 'pointer' : 'default',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 0,
            opacity: captureReady ? 1 : 0.5,
          }}
        >
          <span
            style={{
              width: 58,
              height: 58,
              borderRadius: 99,
              background: captureReady ? '#9FB87E' : 'rgba(247,242,226,0.55)',
              transition: 'background .25s ease',
            }}
          />
        </button>

        {headingSupported && (
          <button
            type="button"
            onClick={onToggleManual}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'rgba(247,242,226,0.85)',
              fontSize: 13,
              fontWeight: 600,
              textDecoration: 'underline',
              cursor: 'pointer',
            }}
          >
            Compass off? Pick the direction yourself
          </button>
        )}
        {headingSupported && showManual && (
          <ManualSelector dir={dir} onPick={onPickDirection} compact />
        )}
      </div>
    </div>
  )
}

// A simple compass card: the rose rotates under a fixed pointer; the target
// letter turns green when you're roughly facing it.
function CompassDial({ heading, target, aligned }) {
  const cards = [
    ['N', 0],
    ['E', 90],
    ['S', 180],
    ['W', 270],
  ]
  const size = 120
  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      {/* fixed pointer */}
      <div
        style={{
          position: 'absolute',
          top: -2,
          left: '50%',
          transform: 'translateX(-50%)',
          width: 0,
          height: 0,
          borderLeft: '7px solid transparent',
          borderRight: '7px solid transparent',
          borderTop: `12px solid ${aligned ? '#9FB87E' : '#E8C87D'}`,
          zIndex: 3,
        }}
      />
      <div
        style={{
          position: 'absolute',
          inset: 0,
          borderRadius: '50%',
          border: `2px solid ${aligned ? 'rgba(159,184,126,0.9)' : 'rgba(247,242,226,0.4)'}`,
          background: 'rgba(20,18,11,0.5)',
          transform: `rotate(${-heading}deg)`,
          transition: 'transform .15s linear, border-color .25s ease',
        }}
      >
        {cards.map(([c, deg]) => {
          const isTarget = deg === target
          return (
            <div
              key={c}
              style={{ position: 'absolute', inset: 0, transform: `rotate(${deg}deg)` }}
            >
              <span
                style={{
                  position: 'absolute',
                  top: 8,
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontFamily: 'var(--font-ui)',
                  fontWeight: 800,
                  fontSize: 14,
                  color: isTarget ? (aligned ? '#C8DBA2' : '#E8C87D') : 'rgba(247,242,226,0.8)',
                }}
              >
                {c}
              </span>
            </div>
          )
        })}
      </div>
      <span
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: 6,
          height: 6,
          borderRadius: 99,
          background: 'rgba(247,242,226,0.7)',
          transform: 'translate(-50%,-50%)',
        }}
      />
    </div>
  )
}

function ManualSelector({ dir, onPick, compact }) {
  return (
    <div style={{ textAlign: 'center' }}>
      {!compact && (
        <div style={{ fontSize: 13, fontWeight: 700, color: 'rgba(247,242,226,0.92)', marginBottom: 8 }}>
          No compass — which way are you facing?
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
        {DIRECTIONS.map((d, i) => {
          const active = d.key === dir.key
          return (
            <button
              key={d.key}
              type="button"
              className="ec-press"
              onClick={() => onPick(i)}
              style={{
                width: 44,
                height: 44,
                borderRadius: 12,
                border: active ? '2px solid #9FB87E' : '2px solid rgba(247,242,226,0.35)',
                background: active ? 'rgba(159,184,126,0.2)' : 'rgba(20,18,11,0.5)',
                color: '#F7F2E2',
                fontSize: 16,
                fontWeight: 800,
                cursor: 'pointer',
              }}
            >
              {d.short}
            </button>
          )
        })}
      </div>
    </div>
  )
}

// ── Review ─────────────────────────────────────────────────────────
function ReviewScreen({ photos, onRetake, onFinish }) {
  const located = photos.some((p) => p?.location)
  const compassUsed = photos.some((p) => p?.direction_source === 'compass')
  return (
    <div style={{ flex: 1, overflowY: 'auto', padding: '64px 24px 28px' }}>
      <h2
        style={{
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: 26,
          lineHeight: 1.12,
          color: 'var(--ink)',
          margin: '0 0 6px',
        }}
      >
        All four — looking good
      </h2>
      <p style={{ fontSize: 14.5, lineHeight: 1.5, color: 'var(--ink-soft)', margin: '0 0 20px' }}>
        Check them over. Retake any that didn’t come out, then they’re ready for the report step.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
        {DIRECTIONS.map((d, i) => {
          const photo = photos[i]
          return (
            <div key={d.key} style={{ position: 'relative' }}>
              <div
                style={{
                  position: 'relative',
                  aspectRatio: '3 / 4',
                  borderRadius: 16,
                  overflow: 'hidden',
                  background: 'var(--paper-deep)',
                  border: '1px solid var(--line)',
                }}
              >
                {photo?.image && (
                  <img
                    src={photo.image}
                    alt={d.label}
                    style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                  />
                )}
                <span
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: 8,
                    padding: '3px 9px',
                    borderRadius: 99,
                    background: 'rgba(20,18,11,0.6)',
                    color: '#F7F2E2',
                    fontSize: 12,
                    fontWeight: 800,
                    letterSpacing: '0.04em',
                  }}
                >
                  {d.label}
                </span>
                <span
                  style={{
                    position: 'absolute',
                    top: 8,
                    right: 8,
                    width: 24,
                    height: 24,
                    borderRadius: 99,
                    background: '#3C4733',
                    color: '#F7F2E2',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Glyph name="check" size={14} stroke={3} />
                </span>
              </div>
              <button
                type="button"
                onClick={() => onRetake(i)}
                className="ec-press"
                style={{
                  marginTop: 8,
                  width: '100%',
                  padding: '8px 0',
                  borderRadius: 10,
                  border: '1.5px solid var(--line)',
                  background: 'var(--card)',
                  color: 'var(--ink)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 6,
                }}
              >
                <Glyph name="refresh" size={15} /> Retake
              </button>
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 16, fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
        {compassUsed ? 'Compass heading recorded · ' : 'Direction set manually · '}
        {located ? 'GPS location attached.' : 'Location unavailable — that’s okay.'}
      </div>

      <div style={{ marginTop: 22 }}>
        <ECButton full icon="check" onClick={onFinish}>
          Use these four photos
        </ECButton>
      </div>
    </div>
  )
}

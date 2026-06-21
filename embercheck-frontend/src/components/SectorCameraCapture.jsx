import { useEffect, useRef, useState } from 'react'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'
import { captureFrame, evaluateQuality, REJECT_MESSAGES } from '../lib/capture'

// True when the page isn't in a secure context, where camera access is blocked.
function notSecure() {
  return typeof window !== 'undefined' && window.isSecureContext === false
}

// Turn a captured frame's JPEG dataURL into a File, so it can go through the
// SAME upload path as a file-picker selection (uploadSectorPhotos expects Files).
function dataURLToFile(dataURL, filename) {
  const [header, base64] = dataURL.split(',')
  const mime = header.match(/:(.*?);/)[1]
  const bytes = atob(base64)
  const buffer = new Uint8Array(bytes.length)
  for (let i = 0; i < bytes.length; i++) buffer[i] = bytes.charCodeAt(i)
  return new File([buffer], filename, { type: mime })
}

// One-shot live-camera capture for a single compass side, alongside the existing
// file-upload input. Reuses the SAME capture mechanics as the point-mode guided
// flow (captureFrame + evaluateQuality from lib/capture.js) and mirrors that
// flow's polished intro + framed capture UI — but scoped to the ONE known side,
// so there's no 4-direction state machine, no compass aiming, and no N/E/S/W
// picker. CaptureFlow (point mode) is intentionally left untouched.
export default function SectorCameraCapture({ compassSide, onClose, onCapture }) {
  const [phase, setPhase] = useState('intro') // intro | capturing
  const [starting, setStarting] = useState(false)
  const [videoReady, setVideoReady] = useState(false)
  const [stream, setStream] = useState(null)
  const [cameraError, setCameraError] = useState(null)
  const [reject, setReject] = useState(null)
  const videoRef = useRef(null)
  const streamRef = useRef(null)

  const sideUpper = (compassSide || '').toUpperCase()
  const sideLower = (compassSide || '').toLowerCase()
  const captureReady = videoReady && !cameraError

  async function startCamera() {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('no-camera')
    const s = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: { ideal: 'environment' } },
      audio: false,
    })
    streamRef.current = s
    setStream(s)
  }

  async function handleStart() {
    setStarting(true)
    setVideoReady(false)
    setCameraError(null)
    try {
      await startCamera()
      setPhase('capturing')
    } catch {
      setCameraError(
        notSecure()
          ? 'Your browser blocked the camera. Camera access needs a secure (https) connection.'
          : 'We couldn’t open your camera. Check the browser’s camera permission and try again.',
      )
    }
    setStarting(false)
  }

  async function retryCamera() {
    setCameraError(null)
    setVideoReady(false)
    try {
      await startCamera()
    } catch {
      setCameraError('Still no camera. Open this site over https and allow camera access in your browser.')
    }
  }

  useEffect(() => {
    const v = videoRef.current
    if (phase === 'capturing' && v && stream) {
      v.srcObject = stream
      v.play().catch(() => {})
    }
  }, [phase, stream])

  useEffect(() => {
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prevOverflow
      if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
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
    // Same handoff as before: dataURL -> File -> onCapture -> uploadFiles, so a
    // captured photo is downstream-identical to an uploaded one.
    const file = dataURLToFile(frame.dataURL, `${sideLower}-${Date.now()}.jpg`)
    if (streamRef.current) streamRef.current.getTracks().forEach((t) => t.stop())
    onCapture?.(file)
    onClose?.()
  }

  return (
    <div className="ec-capture-overlay" role="dialog" aria-modal="true">
      <div className="ec-capture-panel">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            position: 'absolute', top: 14, right: 14, zIndex: 30,
            width: 38, height: 38, borderRadius: 99, border: 'none',
            background: 'rgba(20,18,11,0.45)', color: '#F7F2E2',
            cursor: 'pointer', fontSize: 18, lineHeight: 1,
          }}
        >
          ×
        </button>

        {phase === 'intro' && (
          <div
            style={{
              flex: 1, overflowY: 'auto', padding: '64px 24px 28px',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ flex: 0.6 }} />
            <h2
              style={{
                fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 28,
                lineHeight: 1.1, color: 'var(--ink)', margin: '0 0 12px',
              }}
            >
              Photograph the {compassSide} side
            </h2>
            <p style={{ fontSize: 15.5, lineHeight: 1.55, color: 'var(--ink-soft)', margin: '0 0 24px' }}>
              Stand on the {sideLower} side of your block and point your camera at the trees, bushes
              or grass. One clear photo is all we need.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginBottom: 24 }}>
              {[
                { icon: 'camera', label: 'Camera', sub: 'to take the photo' },
                { icon: 'sun', label: 'Good light', sub: 'photograph in daylight if you can' },
              ].map((p) => (
                <div key={p.label} style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <span
                    style={{
                      width: 42, height: 42, borderRadius: 12, flexShrink: 0,
                      background: 'color-mix(in oklab, var(--euc-deep) 12%, transparent)',
                      color: 'var(--euc-deep)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
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

            {(notSecure() || cameraError) && (
              <div
                style={{
                  marginBottom: 16, padding: '11px 14px', borderRadius: 12,
                  background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
                  border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
                  color: '#7a2418', fontSize: 13, fontWeight: 600,
                }}
              >
                {cameraError || 'The camera needs a secure (https) connection — it may be blocked here.'}
              </div>
            )}

            <div style={{ flex: 1 }} />
            <ECButton full icon="camera" onClick={handleStart} disabled={starting}>
              {starting ? 'Opening camera…' : 'Open camera'}
            </ECButton>
            <p
              style={{
                margin: '12px 4px 0', fontSize: 12.5, lineHeight: 1.5,
                color: 'var(--ink-soft)', textAlign: 'center',
              }}
            >
              You can also close this and upload a photo instead. Your photo stays on your device
              until you choose to use it.
            </p>
          </div>
        )}

        {phase === 'capturing' && (
          <div style={{ flex: 1, position: 'relative', display: 'flex', flexDirection: 'column', background: '#14130d' }}>
            {/* live preview */}
            <video
              ref={videoRef}
              playsInline
              muted
              autoPlay
              onLoadedMetadata={() => setVideoReady(true)}
              onPlaying={() => setVideoReady(true)}
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

            {/* side pill */}
            <div style={{ position: 'relative', zIndex: 10, padding: '16px 16px 0' }}>
              <div
                style={{
                  display: 'inline-flex', alignItems: 'center', gap: 8,
                  padding: '6px 12px', borderRadius: 99,
                  background: 'rgba(20,18,11,0.55)', color: '#F7F2E2',
                  fontSize: 13, fontWeight: 700,
                }}
              >
                {compassSide} side
              </div>
            </div>

            {/* instruction */}
            <div style={{ position: 'relative', zIndex: 10, padding: '12px 16px' }}>
              <div
                style={{
                  background: 'rgba(20,18,11,0.62)',
                  backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
                  borderRadius: 16, padding: '12px 14px', color: '#F7F2E2',
                }}
              >
                <div style={{ fontSize: 15, fontWeight: 700, lineHeight: 1.3, marginBottom: 3 }}>
                  Face {sideUpper} and photograph the trees, bushes or grass
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
                  position: 'absolute', inset: 0, zIndex: 20,
                  background: 'rgba(16,15,10,0.9)',
                  display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center',
                  gap: 16, padding: 28, textAlign: 'center',
                }}
              >
                <span style={{ color: '#E8C87D' }}>
                  <Glyph name="warn" size={40} />
                </span>
                <div style={{ color: '#F7F2E2', fontSize: 15, lineHeight: 1.5, maxWidth: 300 }}>
                  {cameraError}
                </div>
                <ECButton variant="ochre" icon="refresh" onClick={retryCamera}>
                  Try the camera again
                </ECButton>
              </div>
            )}

            {/* bottom controls: just the shutter (side is already known) */}
            <div
              style={{
                position: 'relative', zIndex: 10, padding: '0 16px 24px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
              }}
            >
              {reject && (
                <div
                  style={{
                    padding: '8px 14px', borderRadius: 99,
                    background: 'rgba(179,64,44,0.92)', color: '#fff',
                    fontSize: 13, fontWeight: 600, textAlign: 'center',
                  }}
                >
                  {reject}
                </div>
              )}

              <button
                type="button"
                className="ec-press"
                onClick={handleCapture}
                disabled={!captureReady}
                aria-label={`Capture ${compassSide}`}
                style={{
                  width: 76, height: 76, borderRadius: 99,
                  border: '4px solid rgba(247,242,226,0.9)', background: 'transparent',
                  cursor: captureReady ? 'pointer' : 'default',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  padding: 0, opacity: captureReady ? 1 : 0.5,
                }}
              >
                <span
                  style={{
                    width: 58, height: 58, borderRadius: 99,
                    background: captureReady ? '#9FB87E' : 'rgba(247,242,226,0.55)',
                    transition: 'background .25s ease',
                  }}
                />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

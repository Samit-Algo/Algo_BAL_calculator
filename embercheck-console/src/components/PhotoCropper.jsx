// LinkedIn-style profile-photo adjuster. After the assessor picks an image, this
// modal lets them PAN (drag) and ZOOM (slider / wheel) to position it within the
// circular avatar before it's uploaded. On save it renders the visible circle to
// a square canvas and hands back a JPEG blob — the parent uploads that, so the
// stored photo already matches what the assessor framed.
import { useEffect, useRef, useState } from 'react'
import { CSectionLabel, CBtn } from './atoms'
import { Glyph } from './Glyph'

const VIEW = 280 // on-screen crop circle diameter (CSS px)
const OUT = 512 // exported image size (square px)
const MAX_ZOOM = 3

export default function PhotoCropper({ file, busy, onCancel, onSave }) {
  const [url, setUrl] = useState(null)
  const imgRef = useRef(null)
  const [nat, setNat] = useState(null) // { w, h }
  const [baseScale, setBaseScale] = useState(1) // scale that just covers the circle
  const [scale, setScale] = useState(1)
  const [off, setOff] = useState({ x: 0, y: 0 }) // image top-left within the viewport
  const drag = useRef(null)

  // Object URL for the picked file; revoked on unmount / file change.
  useEffect(() => {
    const u = URL.createObjectURL(file)
    setUrl(u)
    return () => URL.revokeObjectURL(u)
  }, [file])

  // Keep the image covering the circle: clamp so no gap shows.
  function clamp(o, s, w, h) {
    const dw = w * s
    const dh = h * s
    return {
      x: Math.min(0, Math.max(VIEW - dw, o.x)),
      y: Math.min(0, Math.max(VIEW - dh, o.y)),
    }
  }

  function onImgLoad(e) {
    const w = e.target.naturalWidth
    const h = e.target.naturalHeight
    const base = Math.max(VIEW / w, VIEW / h) // cover
    setNat({ w, h })
    setBaseScale(base)
    setScale(base)
    // Centre the image in the circle.
    setOff({ x: (VIEW - w * base) / 2, y: (VIEW - h * base) / 2 })
  }

  // Change scale while keeping the circle's centre point anchored, then clamp.
  function applyScale(newScale) {
    if (!nat) return
    const s = Math.min(baseScale * MAX_ZOOM, Math.max(baseScale, newScale))
    setOff((prev) => {
      const cx = (VIEW / 2 - prev.x) / scale
      const cy = (VIEW / 2 - prev.y) / scale
      const next = { x: VIEW / 2 - cx * s, y: VIEW / 2 - cy * s }
      return clamp(next, s, nat.w, nat.h)
    })
    setScale(s)
  }

  function onPointerDown(e) {
    if (busy) return
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { px: e.clientX, py: e.clientY, ox: off.x, oy: off.y }
  }
  function onPointerMove(e) {
    if (!drag.current || !nat) return
    const nx = drag.current.ox + (e.clientX - drag.current.px)
    const ny = drag.current.oy + (e.clientY - drag.current.py)
    setOff(clamp({ x: nx, y: ny }, scale, nat.w, nat.h))
  }
  function onPointerUp() {
    drag.current = null
  }
  function onWheel(e) {
    if (busy) return
    e.preventDefault()
    applyScale(scale * (e.deltaY < 0 ? 1.06 : 0.94))
  }

  async function handleSave() {
    if (!nat || busy) return
    const canvas = document.createElement('canvas')
    canvas.width = OUT
    canvas.height = OUT
    const ctx = canvas.getContext('2d')
    ctx.fillStyle = '#efede2'
    ctx.fillRect(0, 0, OUT, OUT)
    const k = OUT / VIEW // viewport px -> output px
    ctx.drawImage(imgRef.current, off.x * k, off.y * k, nat.w * scale * k, nat.h * scale * k)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/jpeg', 0.9))
    if (blob) onSave(blob)
  }

  const zoomPct = nat ? scale / baseScale : 1

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Adjust photo"
      onClick={busy ? undefined : onCancel}
      style={{
        position: 'fixed', inset: 0, zIndex: 210, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 20, background: 'rgba(28,25,16,0.5)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cs-card"
        style={{ maxWidth: 380, width: '100%', padding: '22px 22px 20px', boxShadow: '0 24px 60px rgba(40,36,24,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
          <CSectionLabel style={{ fontSize: 12 }}>Adjust photo</CSectionLabel>
          <button onClick={busy ? undefined : onCancel} aria-label="Close" className="ec-press" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
        </div>
        <p style={{ margin: '0 0 16px', fontSize: 12.5, color: 'var(--ink-soft)' }}>Drag to reposition · scroll or use the slider to zoom.</p>

        {/* Crop circle */}
        <div style={{ display: 'grid', placeItems: 'center', marginBottom: 18 }}>
          <div
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onWheel={onWheel}
            style={{
              position: 'relative', width: VIEW, height: VIEW, borderRadius: '50%', overflow: 'hidden',
              cursor: busy ? 'default' : 'grab', touchAction: 'none', background: 'var(--panel)',
              boxShadow: 'inset 0 0 0 3px color-mix(in oklab, var(--euc-deep) 30%, transparent), 0 8px 24px -12px rgba(38,39,31,0.5)',
              userSelect: 'none',
            }}
          >
            {url && (
              <img
                ref={imgRef}
                src={url}
                alt=""
                draggable={false}
                onLoad={onImgLoad}
                style={{
                  position: 'absolute',
                  left: off.x,
                  top: off.y,
                  width: nat ? nat.w * scale : 'auto',
                  height: nat ? nat.h * scale : 'auto',
                  pointerEvents: 'none',
                  maxWidth: 'none',
                }}
              />
            )}
          </div>
        </div>

        {/* Zoom control */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 18 }}>
          <span style={{ color: 'var(--ink-soft)', display: 'flex' }}><Glyph name="image" size={15} /></span>
          <input
            type="range"
            min={1}
            max={MAX_ZOOM}
            step={0.01}
            value={zoomPct}
            disabled={busy || !nat}
            onChange={(e) => applyScale(baseScale * Number(e.target.value))}
            style={{ flex: 1, accentColor: 'var(--euc-deep)' }}
          />
        </div>

        <div style={{ display: 'flex', gap: 10 }}>
          <CBtn variant="primary" icon="check" disabled={busy || !nat} onClick={handleSave}>
            {busy ? 'Saving…' : 'Save photo'}
          </CBtn>
          <CBtn variant="quiet" disabled={busy} onClick={onCancel}>Cancel</CBtn>
        </div>
      </div>
    </div>
  )
}

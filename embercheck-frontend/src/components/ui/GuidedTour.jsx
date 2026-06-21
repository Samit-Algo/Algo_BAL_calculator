import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ECButton from './ECButton'

// A small, self-contained spotlight tour (no external library). Each step names
// a real on-screen control via a CSS selector; the tour dims the page, cuts out
// (highlights) that control, and shows a caption card near it. Next/Back move
// stepwise, Skip/Esc/backdrop exit. It is PURELY an overlay — it never clicks,
// draws, saves, or otherwise drives the underlying controls; tapping the
// highlighted control is swallowed (neither acts on it nor skips).
//
// Reuses the same modal mechanics as ConfirmModal/ImageViewerModal: portal to
// body, Esc to exit, focus trapped in the caption, focus restored on exit, body
// scroll locked. onClose is called on Skip, Done, Esc, or backdrop.
const PAD = 8

export default function GuidedTour({ steps, onClose }) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState(null)
  const cardRef = useRef(null)
  const previouslyFocused = useRef(null)

  const step = steps[index]
  const isLast = index === steps.length - 1

  // Measure the current target's on-screen box. setRect is only ever called from
  // a rAF/listener callback (never synchronously in the effect body), so this is
  // a layout-sync, not a render cascade. Re-measures on step change + resize/scroll.
  useEffect(() => {
    const selector = step?.selector
    let raf = 0
    const measure = () => {
      const el = selector ? document.querySelector(selector) : null
      setRect(el ? el.getBoundingClientRect() : null)
    }
    raf = requestAnimationFrame(measure)
    const onChange = () => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(measure)
    }
    window.addEventListener('resize', onChange)
    window.addEventListener('scroll', onChange, true)
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('resize', onChange)
      window.removeEventListener('scroll', onChange, true)
    }
  }, [step?.selector])

  // Focus the primary action on open, trap Tab in the caption, Esc exits, and
  // restore focus + body scroll on unmount.
  useEffect(() => {
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const raf = requestAnimationFrame(() => {
      const btns = cardRef.current?.querySelectorAll('button:not([disabled])')
      btns?.[btns.length - 1]?.focus()
    })
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = cardRef.current?.querySelectorAll('button:not([disabled])')
      if (!focusable || focusable.length === 0) return
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [onClose])

  if (!step) return null

  const vw = window.innerWidth
  const vh = window.innerHeight
  const cardW = Math.min(340, vw - 24)
  const CARD_EST_H = 230

  let cardStyle
  if (rect) {
    const below = rect.bottom + 12 + CARD_EST_H < vh
    const top = below ? rect.bottom + 12 : Math.max(12, rect.top - 12 - CARD_EST_H)
    const left = Math.min(Math.max(12, rect.left), vw - cardW - 12)
    cardStyle = { top, left }
  } else {
    cardStyle = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)' }
  }

  const skipStyle = {
    background: 'none',
    border: 'none',
    color: 'var(--ink-soft)',
    fontSize: 12.5,
    fontWeight: 700,
    cursor: 'pointer',
    padding: 0,
    fontFamily: 'var(--font-ui)',
  }

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Guided tour"
      onMouseDown={(event) => {
        // Backdrop (the dim area) click exits. The hole-guard and caption are
        // separate targets that stop propagation, so they don't trigger this.
        if (event.target === event.currentTarget) onClose?.()
      }}
      style={{ position: 'fixed', inset: 0, zIndex: 1000 }}
    >
      {/* Spotlight: dim everything except a cut-out over the target. When the
          target isn't measured yet, fall back to a plain full dim. Visual only. */}
      {rect ? (
        <div
          style={{
            position: 'fixed',
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 12,
            boxShadow: '0 0 0 9999px rgba(20,18,11,0.62), 0 0 0 2px rgba(247,242,226,0.9)',
            pointerEvents: 'none',
          }}
        />
      ) : (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,18,11,0.62)', pointerEvents: 'none' }} />
      )}

      {/* Hole-guard: swallow clicks over the highlighted control so tapping it
          neither drives the control (no draw/clear/assess) nor exits the tour. */}
      {rect && (
        <div
          onMouseDown={(event) => event.stopPropagation()}
          style={{
            position: 'fixed',
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            borderRadius: 12,
          }}
        />
      )}

      {/* Caption card */}
      <div
        ref={cardRef}
        onMouseDown={(event) => event.stopPropagation()}
        style={{
          position: 'fixed',
          width: cardW,
          ...cardStyle,
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 16,
          padding: '16px 18px',
          boxShadow: '0 18px 50px rgba(0,0,0,0.35)',
        }}
      >
        <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', letterSpacing: '0.06em', marginBottom: 6 }}>
          {index + 1} of {steps.length}
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 18, color: 'var(--ink)', margin: '0 0 6px' }}>
          {step.title}
        </div>
        <p style={{ margin: '0 0 14px', fontSize: 13.5, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
          {step.body}
        </p>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <button type="button" onClick={onClose} style={skipStyle}>
            Skip tour
          </button>
          <div style={{ display: 'flex', gap: 8 }}>
            {index > 0 && (
              <ECButton small variant="secondary" onClick={() => setIndex((i) => i - 1)}>
                Back
              </ECButton>
            )}
            {isLast ? (
              <ECButton small onClick={onClose}>
                Got it
              </ECButton>
            ) : (
              <ECButton small onClick={() => setIndex((i) => i + 1)}>
                Next
              </ECButton>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

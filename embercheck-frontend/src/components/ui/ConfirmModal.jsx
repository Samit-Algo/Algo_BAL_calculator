import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import ECButton from './ECButton'
import Glyph from './Glyph'

// Reusable, ember-themed confirmation dialog. Controlled component (parent owns
// `isOpen`), matching the existing pattern (e.g. BoundaryStepCard). Replaces the
// native window.confirm() so destructive actions read in the app's voice.
//
// onConfirm MAY return a promise: while it's pending we disable both buttons,
// show a spinner on the confirm action, block dismissal (backdrop/Esc), and
// surface an error if it rejects. (Step 3 wires only delete-photo, which is
// synchronous, but the async path is baked in for step 8's backend DELETE.)
//
// Props:
//   isOpen        — whether the dialog is shown
//   title         — heading text
//   message       — string | node body
//   confirmLabel  — confirm button text (default "Confirm")
//   cancelLabel   — cancel button text (default "Cancel")
//   tone          — "default" | "danger" (default "default"); danger = ember
//   onConfirm     — called on confirm; may return a promise
//   onCancel/onClose — called on cancel / backdrop / Esc (when not pending)
export default function ConfirmModal({
  isOpen,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
  onClose,
}) {
  const [pending, setPending] = useState(false)
  const [error, setError] = useState(null)
  const panelRef = useRef(null)
  const confirmRef = useRef(null)
  const previouslyFocused = useRef(null)

  const dismiss = useCallback(() => {
    if (pending) return
    // Clear any prior error so a later reopen starts clean (the component stays
    // mounted across open/close as a controlled child).
    setError(null)
    ;(onCancel || onClose)?.()
  }, [pending, onCancel, onClose])

  async function handleConfirm() {
    setError(null)
    try {
      const result = onConfirm?.()
      if (result && typeof result.then === 'function') {
        setPending(true)
        await result
      }
    } catch (err) {
      setError(err?.message || 'Something went wrong. Please try again.')
    } finally {
      setPending(false)
    }
  }

  // Capture the element to restore focus to, each time the dialog opens, and
  // focus the confirm button. (pending/error are reset by the confirm/dismiss
  // flows, not here, to avoid a setState-in-effect cascade.)
  useEffect(() => {
    if (!isOpen) return undefined
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    // Defer so the button exists and isn't stolen by the click that opened us.
    const id = requestAnimationFrame(() => confirmRef.current?.focus())
    return () => {
      cancelAnimationFrame(id)
      previouslyFocused.current?.focus?.()
    }
  }, [isOpen])

  // Esc to dismiss (only when not pending) and a simple focus trap on Tab.
  useEffect(() => {
    if (!isOpen) return undefined
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        dismiss()
        return
      }
      if (event.key !== 'Tab') return
      const focusable = panelRef.current?.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )
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
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [isOpen, dismiss])

  if (!isOpen) return null

  const danger = tone === 'danger'
  const confirmStyle = danger
    ? {
        background: 'var(--ember, #7A1F1F)',
        color: '#F7F2E2',
        boxShadow: '0 6px 18px color-mix(in oklab, var(--ember, #7A1F1F) 32%, transparent)',
      }
    : undefined

  return createPortal(
    <div
      className="ec-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        // Backdrop click only (not clicks that bubble up from the panel).
        if (event.target === event.currentTarget) dismiss()
      }}
    >
      <div
        ref={panelRef}
        className="ec-confirm-panel"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="ec-confirm-title"
        aria-describedby="ec-confirm-message"
      >
        <h2
          id="ec-confirm-title"
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 21,
            lineHeight: 1.2,
            color: 'var(--ink)',
            margin: '0 0 8px',
          }}
        >
          {title}
        </h2>

        <div
          id="ec-confirm-message"
          style={{ margin: '0 0 18px', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}
        >
          {message}
        </div>

        {error && (
          <div
            role="alert"
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
              border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
              fontSize: 13.5,
              fontWeight: 600,
              color: '#7a2418',
            }}
          >
            {error}
          </div>
        )}

        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <ECButton variant="secondary" small onClick={dismiss} disabled={pending}>
            {cancelLabel}
          </ECButton>
          <button
            ref={confirmRef}
            type="button"
            className="ec-press"
            onClick={pending ? undefined : handleConfirm}
            disabled={pending}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 44,
              padding: '0 18px',
              borderRadius: 16,
              fontFamily: 'var(--font-ui)',
              fontSize: 15,
              fontWeight: 600,
              cursor: pending ? 'wait' : 'pointer',
              border: '1.5px solid transparent',
              opacity: pending ? 0.7 : 1,
              WebkitTapHighlightColor: 'transparent',
              boxSizing: 'border-box',
              ...(confirmStyle || {
                background: 'var(--euc-deep)',
                color: 'var(--paper)',
                boxShadow: '0 6px 18px color-mix(in oklab, var(--euc-deep) 32%, transparent)',
              }),
            }}
          >
            {pending && (
              <span className="ec-spin" aria-hidden="true" style={{ display: 'inline-flex' }}>
                <Glyph name="refresh" size={18} />
              </span>
            )}
            <span>{pending ? 'Working…' : confirmLabel}</span>
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

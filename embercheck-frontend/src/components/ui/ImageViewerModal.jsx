import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'

// A plain, view-only full-image viewer: just the image on a dark backdrop.
// Reuses the same modal mechanics as ConfirmModal (portal to body, backdrop +
// Esc to close, focus the close button on open, restore focus on close, lock
// body scroll) but has NO confirm/cancel/destructive actions — opening or
// closing it never mutates, re-uploads, re-analyzes, or deletes the photo.
export default function ImageViewerModal({ src, alt = 'Photo', onClose }) {
  const closeRef = useRef(null)
  const previouslyFocused = useRef(null)

  useEffect(() => {
    if (!src) return undefined
    previouslyFocused.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null
    const raf = requestAnimationFrame(() => closeRef.current?.focus())
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault()
        onClose?.()
      }
    }
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKeyDown, true)
      document.body.style.overflow = prevOverflow
      previouslyFocused.current?.focus?.()
    }
  }, [src, onClose])

  if (!src) return null

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Photo viewer"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 300,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        background: 'rgba(20, 18, 11, 0.85)',
      }}
    >
      <button
        ref={closeRef}
        type="button"
        onClick={onClose}
        aria-label="Close"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          width: 40,
          height: 40,
          borderRadius: 99,
          border: 'none',
          background: 'rgba(20,18,11,0.55)',
          color: '#F7F2E2',
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span style={{ fontSize: 20, lineHeight: 1 }}>×</span>
      </button>
      <img
        src={src}
        alt={alt}
        style={{
          maxWidth: '92vw',
          maxHeight: '88vh',
          objectFit: 'contain',
          borderRadius: 12,
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
        }}
      />
    </div>,
    document.body,
  )
}

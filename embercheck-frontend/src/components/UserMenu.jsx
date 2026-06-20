// Logged-in user control (Phase 1, Step 5a): one tidy button — avatar (initial)
// + name — that toggles a small dropdown menu. The menu currently holds just
// "Log out"; Step 5b adds a "My Properties" link in the same menu. Presentation
// only — it calls the existing logout() from useAuth.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import Glyph from './ui/Glyph'

export default function UserMenu({ onMyProperties }) {
  const { user, logout } = useAuth()
  const [open, setOpen] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)
  const wrapRef = useRef(null)

  // Close on outside-click and Escape while open.
  useEffect(() => {
    if (!open) return
    function onPointer(e) {
      if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false)
    }
    function onKey(e) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)
    try {
      await logout()
    } finally {
      setLoggingOut(false)
      setOpen(false)
    }
  }

  const label = user?.name || user?.email || ''
  const initial = (label || '?').trim().charAt(0).toUpperCase()

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <button
        type="button"
        className="ec-press"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '6px 10px 6px 6px',
          borderRadius: 99,
          background: 'color-mix(in oklab, var(--card) 92%, transparent)',
          border: '1px solid var(--line)',
          boxShadow: '0 2px 8px rgba(40,36,24,0.08)',
          cursor: 'pointer',
          fontFamily: 'var(--font-ui)',
          maxWidth: '46vw',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: 28,
            height: 28,
            borderRadius: 99,
            background: 'var(--euc-deep)',
            color: 'var(--paper)',
            fontSize: 13,
            fontWeight: 800,
            flexShrink: 0,
          }}
        >
          {initial}
        </span>
        <span
          style={{
            fontSize: 14,
            fontWeight: 600,
            color: 'var(--ink)',
            maxWidth: 140,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {label}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          aria-hidden="true"
          style={{
            color: 'var(--ink-soft)',
            transform: open ? 'rotate(180deg)' : 'none',
            transition: 'transform 0.18s ease',
            flexShrink: 0,
          }}
        >
          <path d="M6 9.5 L12 15.5 L18 9.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Account menu"
          className="ec-screen-in"
          style={{
            position: 'absolute',
            top: 'calc(100% + 8px)',
            right: 0,
            minWidth: 200,
            zIndex: 70,
            background: 'var(--card)',
            border: '1px solid var(--line)',
            borderRadius: 14,
            boxShadow: '0 16px 40px rgba(40,36,24,0.20)',
            overflow: 'hidden',
            padding: 6,
          }}
        >
          <div
            style={{
              padding: '8px 10px 10px',
              borderBottom: '1px solid var(--line)',
              marginBottom: 6,
            }}
          >
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.name || 'Signed in'}
            </div>
            <div style={{ fontSize: 12, color: 'var(--ink-soft)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {user?.email}
            </div>
          </div>

          {onMyProperties && (
            <button
              type="button"
              role="menuitem"
              className="ec-press"
              onClick={() => {
                setOpen(false)
                onMyProperties()
              }}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                width: '100%',
                textAlign: 'left',
                padding: '10px 10px',
                borderRadius: 9,
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                fontFamily: 'var(--font-ui)',
                fontSize: 14,
                fontWeight: 600,
                color: 'var(--ink)',
              }}
            >
              <span style={{ display: 'inline-flex', color: 'var(--ink-soft)' }}>
                <Glyph name="doc" size={16} />
              </span>
              My Properties
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            className="ec-press"
            onClick={handleLogout}
            disabled={loggingOut}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              width: '100%',
              textAlign: 'left',
              padding: '10px 10px',
              borderRadius: 9,
              border: 'none',
              background: 'transparent',
              cursor: loggingOut ? 'default' : 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 14,
              fontWeight: 600,
              color: 'var(--ink)',
              opacity: loggingOut ? 0.6 : 1,
            }}
          >
            <span style={{ display: 'inline-flex', color: 'var(--ink-soft)' }}>
              <Glyph name="arrowRight" size={16} />
            </span>
            {loggingOut ? 'Logging out…' : 'Log out'}
          </button>
        </div>
      )}
    </div>
  )
}

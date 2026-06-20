// The real app header (Phase 1, Step 5a): one in-flow bar used on BOTH the entry
// and results screens — EmberCheck logo lockup on the LEFT, auth controls on the
// RIGHT. Replaces the old fixed top-right overlay (.ec-auth-widget).
//
// Logged out -> a single "Log in" pill that opens the shared auth modal.
// Logged in  -> a single UserMenu (avatar + name + dropdown). Presentation only:
// the buttons call the existing openAuthModal() / logout() from useAuth.

import { useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import Wordmark from './ui/Wordmark'
import Glyph from './ui/Glyph'
import UserMenu from './UserMenu'

// Drop the wordmark tagline below this width so the header stays clean on phones.
const TAGLINE_QUERY = '(min-width: 600px)'

export default function AppHeader({ sticky = false, onBack = null, onMyProperties = null }) {
  const { user, status, openAuthModal } = useAuth()
  const [showTagline, setShowTagline] = useState(
    () => (typeof window === 'undefined' ? true : window.matchMedia(TAGLINE_QUERY).matches),
  )

  useEffect(() => {
    const mq = window.matchMedia(TAGLINE_QUERY)
    const onChange = (e) => setShowTagline(e.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])

  const headerStyle = sticky
    ? {
        position: 'sticky',
        top: 0,
        zIndex: 30,
        background: 'color-mix(in oklab, var(--paper) 88%, transparent)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
        borderBottom: '1px solid var(--line)',
      }
    : { position: 'relative', zIndex: 30 }

  return (
    <header style={headerStyle}>
      <div
        className="ec-app-header-inner"
        style={{
          maxWidth: 1180,
          margin: '0 auto',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        {/* left: optional back button + logo lockup */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          {onBack && (
            <button
              type="button"
              className="ec-press"
              onClick={onBack}
              aria-label="Check another address"
              title="Check another address"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 42,
                height: 42,
                borderRadius: 99,
                border: 'none',
                background: 'color-mix(in oklab, var(--ink) 7%, transparent)',
                color: 'var(--ink)',
                cursor: 'pointer',
                flexShrink: 0,
              }}
            >
              <Glyph name="chevronLeft" size={20} />
            </button>
          )}
          <Wordmark size={26} tagline={showTagline} />
        </div>

        {/* right: auth controls (single control either way) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
          {status !== 'bootstrapping' &&
            (user ? (
              <UserMenu onMyProperties={onMyProperties} />
            ) : (
              <button
                type="button"
                className="ec-press"
                onClick={openAuthModal}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '10px 18px',
                  borderRadius: 99,
                  border: 'none',
                  background: 'var(--euc-deep)',
                  color: 'var(--paper)',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  boxShadow: '0 6px 18px color-mix(in oklab, var(--euc-deep) 32%, transparent)',
                }}
              >
                Log in
              </button>
            ))}
        </div>
      </div>
    </header>
  )
}

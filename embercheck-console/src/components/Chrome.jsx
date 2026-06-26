// Top bar — lifted from the mockup's app shell (console/app.jsx → ConsoleApp top
// bar). Wordmark + "Console" lockup on the left, assessor identity on the right.
// A breadcrumb appears when a job is open; a quiet "Sign out" replaces the demo's
// static accreditation line action.
import { Wordmark, CSectionLabel } from './atoms'
import { Glyph } from './Glyph'

function initials(name, email) {
  const src = (name || email || '').trim()
  if (!src) return '··'
  const parts = src.split(/[\s.@]+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)
  return letters.toUpperCase()
}

export function Chrome({ me, breadcrumb, onHome, onSignOut, children, fill = false }) {
  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', minWidth: 1080, fontFamily: 'var(--font-ui)' }}>
      <div
        style={{
          height: 46,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 14,
          padding: '0 16px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel)',
        }}
      >
        <button
          className="ec-press"
          onClick={onHome}
          style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', cursor: 'pointer', padding: 0 }}
        >
          <Wordmark size={19} />
          <span
            style={{
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.1em',
              textTransform: 'uppercase',
              color: 'var(--ink-soft)',
              borderLeft: '1px solid var(--line)',
              paddingLeft: 10,
            }}
          >
            Console
          </span>
        </button>

        {breadcrumb && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-soft)', minWidth: 0 }}>
            <button
              className="ec-press"
              onClick={onHome}
              style={{ border: 'none', background: 'transparent', cursor: 'pointer', color: 'var(--euc-deep)', fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600, padding: 0 }}
            >
              Worklist
            </button>
            <Glyph name="chevronRight" size={12} />
            <span style={{ color: 'var(--ink)', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {breadcrumb}
            </span>
          </div>
        )}

        <div style={{ flex: 1 }} />

        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 26,
              height: 26,
              borderRadius: 99,
              background: 'var(--euc-deep)',
              color: 'var(--paper)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 11,
              fontWeight: 800,
            }}
          >
            {initials(me?.name, me?.email)}
          </span>
          <span style={{ fontSize: 12, color: 'var(--ink)', fontWeight: 600 }}>
            {me?.name || me?.email}{' '}
            <span className="cs-mono" style={{ color: 'var(--ink-soft)', fontWeight: 400, fontSize: 10.5 }}>
              · {me?.jurisdiction || '—'} assessor
            </span>
          </span>
          <button
            className="ec-press"
            onClick={onSignOut}
            style={{
              marginLeft: 4,
              border: '1px solid color-mix(in oklab, var(--ink) 18%, transparent)',
              background: 'transparent',
              cursor: 'pointer',
              borderRadius: 8,
              padding: '4px 10px',
              fontFamily: 'var(--font-ui)',
              fontSize: 11.5,
              fontWeight: 600,
              color: 'var(--ink-soft)',
            }}
          >
            Sign out
          </button>
        </div>
      </div>

      {fill ? (
        // Cockpit mode: no outer scroll — the workspace's two panes manage their
        // own scrolling, exactly as the mockup's full-height shell does.
        <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
          {children}
        </div>
      ) : (
        <div className="ec-scroll" style={{ flex: 1, overflowY: 'auto' }}>
          {children}
        </div>
      )}
    </div>
  )
}

// Re-export so screens can pull the section label from one place if needed.
export { CSectionLabel }

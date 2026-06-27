// Assessor login — email + password → POST /auth/login. Styled with the
// mockup's tokens (paper field, cs-card, Wordmark, euc-deep primary button) so it
// sits in the same design language as the worklist.
import { useEffect, useRef, useState } from 'react'
import { login, loginWithGoogle } from '../lib/consoleApi'
import { Wordmark, CBtn } from '../components/atoms'

export function LoginScreen({ onAuthed, notice }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const googleButtonRef = useRef(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(email.trim(), password)
      onAuthed()
    } catch (err) {
      setError(err.message || 'Could not sign in.')
      setBusy(false)
    }
  }

  // Render Google Identity Services button (same /auth/google flow as the
  // consumer app). Lets Google-only assessors — who never set a password — in.
  useEffect(() => {
    if (!googleClientId || !googleButtonRef.current) return

    let cancelled = false
    async function loadGoogleIdentity() {
      if (!window.google?.accounts?.id) {
        await new Promise((resolve, reject) => {
          const existing = document.querySelector('script[data-ec-google-identity]')
          if (existing) {
            existing.addEventListener('load', resolve, { once: true })
            existing.addEventListener('error', reject, { once: true })
            return
          }
          const script = document.createElement('script')
          script.src = 'https://accounts.google.com/gsi/client'
          script.async = true
          script.defer = true
          script.dataset.ecGoogleIdentity = 'true'
          script.onload = resolve
          script.onerror = reject
          document.head.appendChild(script)
        })
      }
      if (cancelled || !window.google?.accounts?.id || !googleButtonRef.current) return

      window.google.accounts.id.initialize({
        client_id: googleClientId,
        callback: async (response) => {
          if (!response?.credential) return
          setBusy(true)
          setError(null)
          try {
            await loginWithGoogle(response.credential)
            onAuthed()
          } catch (err) {
            setError(err.message || 'Google sign-in failed. Please try again.')
            setBusy(false)
          }
        },
      })
      googleButtonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'signin_with',
        shape: 'pill',
        width: Math.min(328, googleButtonRef.current.clientWidth || 328),
      })
    }

    loadGoogleIdentity().catch(() => {
      if (!cancelled) setError('Google sign-in could not be loaded.')
    })
    return () => {
      cancelled = true
    }
  }, [googleClientId, onAuthed])

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--paper)' }}>
      <div className="cs-card" style={{ width: '100%', maxWidth: 380, padding: '26px 26px 24px', background: 'var(--panel)', boxShadow: '0 18px 50px rgba(38,39,31,0.12)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 18 }}>
          <Wordmark size={22} />
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
        </div>

        <h1 style={{ fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 22, margin: '0 0 4px', color: 'var(--ink)', letterSpacing: '-0.01em' }}>
          Assessor sign-in
        </h1>
        <p style={{ margin: '0 0 18px', fontSize: 12.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          For accredited assessors. Sign in to review submitted assessments in your jurisdiction.
        </p>

        {notice && (
          <div
            style={{
              marginBottom: 14,
              padding: '10px 12px',
              borderRadius: 9,
              fontSize: 12.5,
              lineHeight: 1.45,
              color: '#93431F',
              background: 'color-mix(in oklab, #B06F3A 14%, transparent)',
              border: '1px solid color-mix(in oklab, #B06F3A 30%, transparent)',
            }}
          >
            {notice}
          </div>
        )}

        {googleClientId && (
          <>
            <div
              ref={googleButtonRef}
              aria-label="Sign in with Google"
              style={{ minHeight: 40, display: 'flex', justifyContent: 'center', marginBottom: 16 }}
            />
            <div
              style={{
                margin: '0 0 16px',
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                color: 'var(--ink-soft)',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.08em',
                textTransform: 'uppercase',
              }}
            >
              <span style={{ height: 1, flex: 1, background: 'var(--line)' }} />
              <span>or</span>
              <span style={{ height: 1, flex: 1, background: 'var(--line)' }} />
            </div>
          </>
        )}

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 5 }}>
            Email
          </label>
          <input
            className="cs-input"
            type="email"
            autoComplete="username"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            style={{ width: '100%', marginBottom: 12, fontSize: 13 }}
            required
          />

          <label style={{ display: 'block', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 5 }}>
            Password
          </label>
          <input
            className="cs-input"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="••••••••"
            style={{ width: '100%', marginBottom: 16, fontSize: 13 }}
            required
          />

          {error && <div style={{ marginBottom: 12, fontSize: 12.5, color: '#93431F', fontWeight: 600 }}>{error}</div>}

          <CBtn type="submit" variant="primary" disabled={busy} style={{ width: '100%', minHeight: 38, fontSize: 13.5 }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </CBtn>
        </form>
      </div>
    </div>
  )
}

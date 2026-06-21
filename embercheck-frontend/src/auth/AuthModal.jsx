// Login / signup modal (Phase 1, Step 3b-i). One panel, a toggle between the two
// modes. Styled with the ember palette + the app's CSS tokens to match.
//
// Mounted only while open (the parent conditionally renders it), so each open
// starts from fresh state — no reset effect needed.

import { useEffect, useRef, useState } from 'react'
import { useAuth } from './AuthContext'
import ECButton from '../components/ui/ECButton'

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 52,
  padding: '0 16px',
  borderRadius: 14,
  background: 'var(--card)',
  border: '2px solid color-mix(in oklab, var(--ink) 16%, transparent)',
  fontFamily: 'var(--font-ui)',
  fontSize: 16,
  color: 'var(--ink)',
  outline: 'none',
}

const labelStyle = {
  display: 'block',
  fontFamily: 'var(--font-ui)',
  fontSize: 13.5,
  fontWeight: 600,
  color: 'var(--ink-soft)',
  margin: '0 0 6px 2px',
}

export default function AuthModal({ onSuccess, onCancel }) {
  const { login, signup, loginWithGoogle } = useAuth()
  const [mode, setMode] = useState('login') // 'login' | 'signup'
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const emailRef = useRef(null)
  const googleButtonRef = useRef(null)
  const googleClientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || ''

  // Focus the email field on open (mount).
  useEffect(() => {
    const id = setTimeout(() => emailRef.current?.focus(), 40)
    return () => clearTimeout(id)
  }, [])

  // Cancel on Escape.
  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape' && !submitting) onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [submitting, onCancel])

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
          setSubmitting(true)
          setError(null)
          try {
            await loginWithGoogle(response.credential)
            onSuccess()
          } catch (err) {
            setError(err.message || 'Google sign-in failed. Please try again.')
          } finally {
            setSubmitting(false)
          }
        },
      })
      googleButtonRef.current.innerHTML = ''
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'pill',
        width: Math.min(368, googleButtonRef.current.clientWidth || 368),
      })
    }

    loadGoogleIdentity().catch(() => {
      if (!cancelled) setError('Google sign-in could not be loaded.')
    })
    return () => {
      cancelled = true
    }
  }, [googleClientId, loginWithGoogle, onSuccess])

  function switchMode(next) {
    setMode(next)
    setError(null)
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return

    const trimmedEmail = email.trim()
    if (!trimmedEmail || !password) {
      setError('Please enter your email and password.')
      return
    }
    // Mirror the backend rule so we can show it before a round-trip on signup.
    if (mode === 'signup' && password.length < 8) {
      setError('Password must be at least 8 characters.')
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      if (mode === 'login') {
        await login(trimmedEmail, password)
      } else {
        await signup(trimmedEmail, password, name.trim())
      }
      onSuccess()
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  const isSignup = mode === 'signup'

  return (
    <div
      className="ec-capture-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={isSignup ? 'Create your account' : 'Log in'}
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !submitting) onCancel()
      }}
      style={{ alignItems: 'center', padding: 20 }}
    >
      <div
        className="ec-screen-in"
        style={{
          width: '100%',
          maxWidth: 420,
          background: 'var(--paper)',
          borderRadius: 24,
          border: '1px solid var(--line)',
          boxShadow: '0 30px 80px rgba(0,0,0,0.35)',
          padding: '28px 26px',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <div>
            <h2
              style={{
                fontFamily: 'var(--font-display)',
                fontWeight: 800,
                fontSize: 26,
                lineHeight: 1.1,
                color: 'var(--ink)',
                margin: 0,
              }}
            >
              {isSignup ? 'Create your account' : 'Welcome back'}
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--ink-soft)' }}>
              {isSignup
                ? 'Save your assessments and unlock photo analysis.'
                : 'Log in to your EmberCheck account.'}
            </p>
          </div>
          <button
            type="button"
            className="ec-press"
            onClick={() => !submitting && onCancel()}
            aria-label="Close"
            style={{
              border: 'none',
              background: 'color-mix(in oklab, var(--ink) 8%, transparent)',
              color: 'var(--ink-soft)',
              width: 34,
              height: 34,
              borderRadius: 99,
              fontSize: 18,
              lineHeight: 1,
              cursor: 'pointer',
              flexShrink: 0,
            }}
          >
            ×
          </button>
        </div>

        <div style={{ marginTop: 22 }}>
          {googleClientId ? (
            <div
              ref={googleButtonRef}
              aria-label="Continue with Google"
              style={{ minHeight: 44, display: 'flex', justifyContent: 'center' }}
            />
          ) : (
            <button
              type="button"
              disabled
              style={{
                width: '100%',
                minHeight: 48,
                borderRadius: 999,
                border: '1px solid var(--line)',
                background: 'var(--card)',
                color: 'var(--ink-soft)',
                fontFamily: 'var(--font-ui)',
                fontSize: 15,
                fontWeight: 700,
              }}
            >
              Google sign-in not configured
            </button>
          )}
        </div>

        <div
          style={{
            margin: '18px 0',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            color: 'var(--ink-soft)',
            fontSize: 12,
            fontWeight: 700,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
          }}
        >
          <span style={{ height: 1, flex: 1, background: 'var(--line)' }} />
          <span>Email</span>
          <span style={{ height: 1, flex: 1, background: 'var(--line)' }} />
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {isSignup && (
            <div>
              <label htmlFor="ec-auth-name" style={labelStyle}>
                Name <span style={{ fontWeight: 400 }}></span>
              </label>
              <input
                id="ec-auth-name"
                type="text"
                autoComplete="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                style={fieldStyle}
              />
            </div>
          )}

          <div>
            <label htmlFor="ec-auth-email" style={labelStyle}>
              Email
            </label>
            <input
              id="ec-auth-email"
              ref={emailRef}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={fieldStyle}
            />
          </div>

          <div>
            <label htmlFor="ec-auth-password" style={labelStyle}>
              Password
            </label>
            <input
              id="ec-auth-password"
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={fieldStyle}
            />
            {isSignup && (
              <p style={{ margin: '6px 2px 0', fontSize: 12.5, color: 'var(--ink-soft)' }}>
                At least 8 characters.
              </p>
            )}
          </div>

          {error && (
            <div
              role="alert"
              style={{
                padding: '11px 14px',
                borderRadius: 12,
                background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
                border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
                color: '#7a2418',
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {error}
            </div>
          )}

          <ECButton type="submit" full disabled={submitting}>
            {submitting
              ? isSignup
                ? 'Creating account…'
                : 'Logging in…'
              : isSignup
                ? 'Create account'
                : 'Log in'}
          </ECButton>
        </form>

        <div style={{ marginTop: 18, textAlign: 'center', fontSize: 14, color: 'var(--ink-soft)' }}>
          {isSignup ? 'Already have an account?' : 'New to EmberCheck?'}{' '}
          <button
            type="button"
            onClick={() => switchMode(isSignup ? 'login' : 'signup')}
            disabled={submitting}
            style={{
              border: 'none',
              background: 'transparent',
              color: 'var(--euc-deep)',
              fontFamily: 'var(--font-ui)',
              fontSize: 14,
              fontWeight: 700,
              cursor: submitting ? 'default' : 'pointer',
              padding: 0,
            }}
          >
            {isSignup ? 'Log in' : 'Create one'}
          </button>
        </div>
      </div>
    </div>
  )
}

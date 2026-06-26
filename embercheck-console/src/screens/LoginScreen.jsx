// Assessor login — email + password → POST /auth/login. Styled with the
// mockup's tokens (paper field, cs-card, Wordmark, euc-deep primary button) so it
// sits in the same design language as the worklist.
import { useState } from 'react'
import { login } from '../lib/consoleApi'
import { Wordmark, CBtn } from '../components/atoms'

export function LoginScreen({ onAuthed, notice }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

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

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--paper)' }}>
      <div className="cs-card" style={{ width: 380, padding: '26px 26px 24px', background: 'var(--panel)', boxShadow: '0 18px 50px rgba(38,39,31,0.12)' }}>
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

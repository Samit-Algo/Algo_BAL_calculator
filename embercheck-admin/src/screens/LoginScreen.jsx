// Admin sign-in — email + password → POST /auth/login. The /admin/me gate then
// decides whether this account is actually an admin.
import { useState } from 'react'
import { login } from '../lib/adminApi'

export function LoginScreen({ onAuthed, notice }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      await login(username.trim(), password)
      onAuthed()
    } catch (err) {
      setError(err.message || 'Could not sign in.')
      setBusy(false)
    }
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24 }}>
      <div className="a-card" style={{ width: '100%', maxWidth: 380, padding: '26px 26px 24px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 16 }}>
          <span style={{ fontWeight: 800, fontSize: 20, color: 'var(--ink)' }}>EmberCheck</span>
          <span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ochre)' }}>Admin</span>
        </div>
        <h1 style={{ fontWeight: 800, fontSize: 22, margin: '0 0 4px', color: 'var(--ink)' }}>Administrator sign-in</h1>
        <p style={{ margin: '0 0 18px', fontSize: 13, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          Review and approve assessor applications.
        </p>
        <p style={{ margin: '-10px 0 16px', fontSize: 12, color: 'var(--ochre)', fontWeight: 700 }}>
          Demo: sign in with admin / admin
        </p>

        {notice && (
          <div style={{ marginBottom: 14, padding: '10px 12px', borderRadius: 9, fontSize: 12.5, lineHeight: 1.45, color: 'var(--danger)', background: 'color-mix(in oklab, var(--danger) 12%, transparent)', border: '1px solid color-mix(in oklab, var(--danger) 30%, transparent)' }}>
            {notice}
          </div>
        )}

        <form onSubmit={onSubmit}>
          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }}>Username</label>
          <input className="a-input" type="text" autoComplete="username" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="admin" style={{ marginBottom: 12 }} required />

          <label style={{ display: 'block', fontSize: 12.5, fontWeight: 600, color: 'var(--ink-soft)', marginBottom: 5 }}>Password</label>
          <input className="a-input" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ marginBottom: 16 }} required />

          {error && <div style={{ marginBottom: 12, fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>{error}</div>}

          <button type="submit" className="a-btn a-btn-primary" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
      </div>
    </div>
  )
}

// A rich, LinkedIn-style public profile for an assessor — the "recruiter viewing
// a candidate" view a property owner opens from the choose-assessor list before
// picking who certifies their case. Data comes from GET /assessor/{id}/public
// (getPublicAssessorProfile), a safe allow-list: no private/contact data, and
// insurance is a presence flag only. No photo field exists, so the avatar shows
// initials. Reuses the consumer app's ECButton / Glyph / CSS tokens; nothing
// private is rendered and there are NO ratings/stars (ratings aren't built yet).
import { useEffect, useRef, useState } from 'react'
import ECButton from './ui/ECButton'
import Glyph from './ui/Glyph'
import {
  getPublicAssessorProfile,
  getAssessorPublicPhotoUrl,
  getAssessorPublicBannerUrl,
} from '../lib/assessor'

// Banner gradient presets — keyed by the SAME ids the backend validates. 'ember'
// is the default. Kept in sync with the Console's GRADIENTS map.
const GRADIENTS = {
  ember:
    'radial-gradient(120% 140% at 78% -10%, color-mix(in oklab, var(--ochre) 60%, var(--euc-deep)) 0%, transparent 55%), linear-gradient(118deg, var(--euc-deep) 0%, color-mix(in oklab, var(--euc-deep) 58%, var(--ochre)) 100%)',
  forest: 'linear-gradient(120deg, #24331f 0%, #3c4733 100%)',
  dusk: 'linear-gradient(120deg, #3c4733 0%, #7a5418 100%)',
  clay: 'linear-gradient(120deg, #93431f 0%, #c28e3f 100%)',
  slate: 'linear-gradient(120deg, #2b2f3a 0%, #5f6052 100%)',
}

// Resolve a profile's banner choice to a CSS background (image → colour →
// gradient preset → default), matching the Console's bannerBackground().
function bannerBackground(profile, bannerUrl) {
  const t = profile.banner_type
  if (t === 'image' && bannerUrl) {
    return { backgroundImage: `url("${bannerUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  if (t === 'color' && profile.banner_value) return { background: profile.banner_value }
  if (t === 'gradient' && GRADIENTS[profile.banner_value]) return { background: GRADIENTS[profile.banner_value] }
  return { background: GRADIENTS.ember }
}

function displayName(p) {
  return p.business_name || p.legal_name || 'Accredited assessor'
}

function initials(p) {
  const src = (p.legal_name || p.business_name || '').trim()
  if (!src) return '··'
  const parts = src.split(/\s+/).filter(Boolean)
  const letters = parts.length >= 2 ? parts[0][0] + parts[1][0] : src.slice(0, 2)
  return letters.toUpperCase()
}

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Empty means genuinely absent: null / undefined / '' — NOT 0 or false.
function isEmpty(v) {
  return v === null || v === undefined || v === ''
}

function Pill({ label, color, bg }) {
  return (
    <span
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 11px',
        borderRadius: 99, background: bg, color, fontSize: 12, fontWeight: 700, whiteSpace: 'nowrap',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: 99, background: 'currentColor', flexShrink: 0 }} />
      {label}
    </span>
  )
}

function Detail({ label, value }) {
  if (isEmpty(value)) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
      <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
        {label}
      </div>
      <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, wordBreak: 'break-word', lineHeight: 1.35 }}>
        {value}
      </div>
    </div>
  )
}

function Section({ title, icon, children }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  if (items.length === 0) return null
  return (
    <div style={{ padding: '16px 16px', borderRadius: 14, border: '1px solid var(--line)', background: 'var(--paper)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 13 }}>
        <span
          style={{
            width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
            background: 'color-mix(in oklab, var(--ochre) 20%, transparent)', color: 'var(--euc-deep)',
          }}
        >
          <Glyph name={icon} size={15} />
        </span>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: '0.11em', textTransform: 'uppercase', color: 'var(--ink-soft)' }}>
          {title}
        </div>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '14px 20px' }}>
        {items}
      </div>
    </div>
  )
}

export default function AssessorProfileModal({ assessorId, onClose }) {
  const [phase, setPhase] = useState('loading') // loading | ready | error
  const [profile, setProfile] = useState(null)
  const [error, setError] = useState(null)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [bannerUrl, setBannerUrl] = useState(null)
  const photoUrlRef = useRef(null)
  const bannerUrlRef = useRef(null)

  useEffect(() => {
    let cancelled = false
    getPublicAssessorProfile(assessorId)
      .then((p) => {
        if (cancelled) return
        setProfile(p)
        setPhase('ready')
        // Load the photo/banner blobs (Bearer-safe) if this assessor has them.
        if (p.has_photo) {
          getAssessorPublicPhotoUrl(assessorId).then((url) => {
            if (cancelled) { if (url) URL.revokeObjectURL(url); return }
            photoUrlRef.current = url
            setPhotoUrl(url)
          })
        }
        if (p.banner_type === 'image' && p.has_banner_image) {
          getAssessorPublicBannerUrl(assessorId).then((url) => {
            if (cancelled) { if (url) URL.revokeObjectURL(url); return }
            bannerUrlRef.current = url
            setBannerUrl(url)
          })
        }
      })
      .catch((e) => {
        if (cancelled) return
        setError(e.message)
        setPhase('error')
      })
    return () => {
      cancelled = true
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
      if (bannerUrlRef.current) URL.revokeObjectURL(bannerUrlRef.current)
    }
  }, [assessorId])

  const radius = profile && profile.service_radius_km != null ? `${profile.service_radius_km} km` : null

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Assessor profile"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 110, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 20, background: 'rgba(28,25,16,0.5)',
        backdropFilter: 'blur(4px)', WebkitBackdropFilter: 'blur(4px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: 'var(--card)', border: '1px solid var(--line)', borderRadius: 22,
          maxWidth: 480, width: '100%', boxShadow: '0 24px 60px rgba(40,36,24,0.28)',
          maxHeight: '88vh', overflowY: 'auto', overflowX: 'hidden', position: 'relative',
        }}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          aria-label="Close"
          className="ec-press"
          style={{
            position: 'absolute', top: 12, right: 12, zIndex: 2, width: 32, height: 32,
            borderRadius: 10, border: 'none', cursor: 'pointer', display: 'grid', placeItems: 'center',
            background: 'color-mix(in oklab, var(--card) 70%, transparent)', color: 'var(--ink)',
            backdropFilter: 'blur(4px)',
          }}
        >
          <span style={{ fontSize: 20, lineHeight: 1 }}>×</span>
        </button>

        {phase === 'loading' && (
          <div style={{ padding: '48px 24px', textAlign: 'center', color: 'var(--ink-soft)', fontSize: 14 }}>
            Loading profile…
          </div>
        )}

        {phase === 'error' && (
          <div style={{ padding: '40px 24px', textAlign: 'center' }}>
            <p style={{ margin: '0 0 18px', color: '#7a2418', fontWeight: 600, fontSize: 14 }}>{error}</p>
            <ECButton full variant="secondary" onClick={onClose}>Close</ECButton>
          </div>
        )}

        {phase === 'ready' && profile && (
          <>
            {/* Banner — the assessor's chosen colour / gradient / image (default
                ember gradient) */}
            <div style={{ height: 118, ...bannerBackground(profile, bannerUrl) }} />
            <div style={{ padding: '0 22px 22px' }}>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div
                  style={{
                    width: 92, height: 92, borderRadius: '50%', marginTop: -46, overflow: 'hidden',
                    background: 'linear-gradient(150deg, var(--euc-deep), color-mix(in oklab, var(--euc-deep) 72%, var(--ochre)))',
                    color: 'var(--paper)', border: '4px solid var(--card)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontFamily: 'var(--font-display)',
                    fontWeight: 800, fontSize: 34, letterSpacing: '0.02em',
                    boxShadow: '0 10px 24px -8px rgba(40,36,24,0.5)',
                  }}
                >
                  {photoUrl ? (
                    <img src={photoUrl} alt="Profile" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    initials(profile)
                  )}
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 14 }}>
                  {profile.status === 'APPROVED' && (
                    <Pill label="Accredited" color="var(--euc-deep)" bg="color-mix(in oklab, var(--euc-deep) 15%, transparent)" />
                  )}
                  {profile.accepting_new_work ? (
                    <Pill label="Accepting new work" color="var(--euc-deep)" bg="color-mix(in oklab, var(--euc-deep) 12%, transparent)" />
                  ) : (
                    <Pill label="Not accepting work" color="var(--ink-soft)" bg="color-mix(in oklab, var(--ink) 8%, transparent)" />
                  )}
                </div>
              </div>

              <h2
                style={{
                  fontFamily: 'var(--font-display)', fontWeight: 800, fontSize: 25, color: 'var(--ink)',
                  margin: '14px 0 4px', letterSpacing: '-0.01em', lineHeight: 1.1,
                }}
              >
                {displayName(profile)}
              </h2>
              {(() => {
                const sub = [
                  profile.business_name && profile.legal_name ? profile.legal_name : null,
                  profile.accreditation_level ? `${profile.accreditation_level} accreditation` : null,
                ].filter(Boolean).join('  ·  ')
                return sub ? <div style={{ fontSize: 13.5, color: 'var(--ink-soft)', fontWeight: 600 }}>{sub}</div> : null
              })()}
              {(profile.operating_states || []).length > 0 && (
                <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
                  <span style={{ color: 'var(--ochre)', display: 'flex' }}><Glyph name="locate" size={14} /></span>
                  {profile.operating_states.join(' · ')}
                </div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 18 }}>
                <Section title="Accreditation" icon="doc">
                  <Detail label="Number" value={profile.accreditation_number} />
                  <Detail label="Level" value={profile.accreditation_level} />
                  <Detail label="Expiry" value={formatDate(profile.accreditation_expiry)} />
                  <Detail label="Qualification" value={profile.qualification} />
                </Section>

                <Section title="Operating area" icon="locate">
                  <Detail label="States" value={(profile.operating_states || []).join(', ')} />
                  <Detail label="LGAs" value={(profile.operating_lgas || []).join(', ')} />
                  <Detail label="Service radius" value={radius} />
                </Section>

                {/* Insurance — presence only, never numbers or files */}
                <div
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', borderRadius: 14,
                    border: '1px solid var(--line)', background: 'var(--paper)',
                  }}
                >
                  <span
                    style={{
                      width: 28, height: 28, borderRadius: 8, flexShrink: 0, display: 'grid', placeItems: 'center',
                      background: profile.insurance_on_file
                        ? 'color-mix(in oklab, var(--euc-deep) 15%, transparent)'
                        : 'color-mix(in oklab, var(--ink) 8%, transparent)',
                      color: profile.insurance_on_file ? 'var(--euc-deep)' : 'var(--ink-soft)',
                    }}
                  >
                    <Glyph name={profile.insurance_on_file ? 'check' : 'info'} size={15} />
                  </span>
                  <span style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--ink)' }}>
                    {profile.insurance_on_file ? 'Insurance on file' : 'No insurance on file'}
                  </span>
                </div>
              </div>

              <div style={{ marginTop: 20 }}>
                <ECButton full variant="secondary" onClick={onClose}>Close</ECButton>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

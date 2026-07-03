// Standalone assessor profile — a premium, LinkedIn-style page for the signed-in
// assessor. Data comes from GET /assessor/me (getMyAssessorProfile), the SAME
// endpoint the consumer app reads; here it powers a proper profile rather than
// the registration status card. No photo URL exists in AssessorProfileRead yet,
// so the avatar renders the assessor's initials. Layout: a gradient banner with
// an overlapping circular avatar, a headline row (name + status/work pills +
// sub-line + contact), then stacked, icon-headed section cards. Ember tokens +
// the console's cs-card / CSectionLabel / Glyph primitives are reused — nothing
// is duplicated.
import { useEffect, useRef, useState } from 'react'
import {
  getMyAssessorProfile,
  updateMyAssessorProfile,
  uploadAssessorProfilePhoto,
  getMyAssessorPhotoUrl,
  uploadAssessorBanner,
  getMyAssessorBannerUrl,
} from '../lib/consoleApi'
import { CSectionLabel, CBtn } from '../components/atoms'
import { Glyph } from '../components/Glyph'
import PhotoCropper from '../components/PhotoCropper'
import { useIsMobile } from '../lib/useIsMobile'

function initials(first, last) {
  const a = (first || '').trim()
  const b = (last || '').trim()
  const letters = (a[0] || '') + (b[0] || '')
  return letters ? letters.toUpperCase() : '··'
}

function formatDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

// Empty means genuinely absent: null / undefined / ''. Crucially NOT 0 or false —
// those are real values (service radius 0, "not accepting new work") and must
// render. Used by both Detail and Section so the two agree on "has content".
function isEmpty(v) {
  return v === null || v === undefined || v === ''
}

// Parse a comma/newline-separated string into a clean list (states, LGAs).
function parseList(raw) {
  return String(raw || '')
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

// Form-field styling — mirrors OverrideEditor's EDIT_FIELD/EDIT_LABEL house style,
// sized up a little for a full profile form.
const FIELD_LABEL = { display: 'block', fontSize: 11, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 6 }
const FIELD = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 42,
  padding: '0 12px',
  borderRadius: 10,
  border: '1px solid color-mix(in oklab, var(--ink) 20%, transparent)',
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-ui)',
  fontSize: 14,
  outline: 'none',
}

function Field({ label, hint, children }) {
  return (
    <label style={{ display: 'block', minWidth: 0 }}>
      <span style={FIELD_LABEL}>{label}</span>
      {children}
      {hint && <span style={{ display: 'block', marginTop: 5, fontSize: 11.5, color: 'var(--ink-soft)' }}>{hint}</span>}
    </label>
  )
}

// Banner gradient presets — keyed by the SAME ids the backend validates
// (ALLOWED_GRADIENT_IDS). 'ember' is the app's default. The backend stores only
// the id; this map turns it into CSS, so no raw CSS ever crosses the wire.
const GRADIENTS = {
  ember:
    'radial-gradient(120% 140% at 78% -10%, color-mix(in oklab, var(--ochre) 62%, var(--euc-deep)) 0%, transparent 55%), linear-gradient(118deg, var(--euc-deep) 0%, color-mix(in oklab, var(--euc-deep) 58%, var(--ochre)) 100%)',
  forest: 'linear-gradient(120deg, #24331f 0%, #3c4733 100%)',
  dusk: 'linear-gradient(120deg, #3c4733 0%, #7a5418 100%)',
  clay: 'linear-gradient(120deg, #93431f 0%, #c28e3f 100%)',
  slate: 'linear-gradient(120deg, #2b2f3a 0%, #5f6052 100%)',
}
// On-brand solid swatches (a custom colour picker sits alongside these).
const BANNER_COLORS = ['#3c4733', '#26271f', '#93431f', '#c28e3f', '#4a5d7a', '#5f6052']

// Resolve a profile's banner choice to a CSS background. Image wins (needs the
// fetched blob URL); then colour; then gradient preset; else the default.
function bannerBackground(profile, bannerUrl) {
  const t = profile.banner_type
  if (t === 'image' && bannerUrl) {
    return { backgroundImage: `url("${bannerUrl}")`, backgroundSize: 'cover', backgroundPosition: 'center' }
  }
  if (t === 'color' && profile.banner_value) return { background: profile.banner_value }
  if (t === 'gradient' && GRADIENTS[profile.banner_value]) return { background: GRADIENTS[profile.banner_value] }
  return { background: GRADIENTS.ember }
}

// status → a friendly pill style. APPROVED reads as the brand green, PENDING as
// ember amber, reject/suspend as the flag rust, inactive as muted ink.
const STATUS_STYLES = {
  APPROVED: { label: 'Approved', color: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc-deep) 15%, transparent)' },
  PENDING: { label: 'Pending review', color: '#8A6420', bg: 'color-mix(in oklab, var(--ochre) 24%, transparent)' },
  REJECTED: { label: 'Not approved', color: '#93431F', bg: 'color-mix(in oklab, #B06F3A 18%, transparent)' },
  SUSPENDED: { label: 'Suspended', color: '#93431F', bg: 'color-mix(in oklab, #B06F3A 18%, transparent)' },
  INACTIVE: { label: 'Inactive', color: 'var(--ink-soft)', bg: 'color-mix(in oklab, var(--ink) 9%, transparent)' },
}

// Friendly labels for the document types the backend tags (accreditation |
// insurance | identity | profile_photo). Anything else is title-cased.
const DOC_LABELS = {
  accreditation: 'Accreditation certificate',
  insurance: 'Insurance certificate',
  identity: 'Identity document',
  profile_photo: 'Profile photo',
}
function docLabel(type) {
  if (DOC_LABELS[type]) return DOC_LABELS[type]
  const t = String(type || 'Document').replace(/_/g, ' ')
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function Pill({ label, color, bg, dot }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 11px',
        borderRadius: 99,
        background: bg,
        color,
        fontSize: 11.5,
        fontWeight: 700,
        whiteSpace: 'nowrap',
      }}
    >
      {dot && <span style={{ width: 7, height: 7, borderRadius: 99, background: 'currentColor', flexShrink: 0 }} />}
      {label}
    </span>
  )
}

// One label/value pair inside a section. Hidden only when the value is truly
// empty (isEmpty) — 0 and false still render.
function Detail({ label, value }) {
  if (isEmpty(value)) return null
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
      <CSectionLabel>{label}</CSectionLabel>
      <div style={{ fontSize: 14, color: 'var(--ink)', fontWeight: 600, wordBreak: 'break-word', lineHeight: 1.35 }}>
        {typeof value === 'boolean' ? (value ? 'Yes' : 'No') : value}
      </div>
    </div>
  )
}

// A stacked profile section with an amber-accented icon chip beside the heading.
// Hidden entirely when it has no renderable children (so empty data → no card).
function Section({ title, icon, children }) {
  const items = (Array.isArray(children) ? children.flat() : [children]).filter(Boolean)
  if (items.length === 0) return null
  return (
    <div
      className="cs-card"
      style={{
        padding: '20px 22px',
        boxShadow: '0 1px 2px rgba(38,39,31,0.05), 0 14px 34px -18px rgba(38,39,31,0.35)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <span
          style={{
            width: 30,
            height: 30,
            borderRadius: 9,
            flexShrink: 0,
            display: 'grid',
            placeItems: 'center',
            background: 'color-mix(in oklab, var(--ochre) 20%, transparent)',
            color: 'var(--euc-deep)',
          }}
        >
          <Glyph name={icon} size={16} stroke={1.9} />
        </span>
        <CSectionLabel style={{ fontSize: 11, letterSpacing: '0.13em' }}>{title}</CSectionLabel>
        <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(190px, 1fr))', gap: '18px 26px' }}>
        {items}
      </div>
    </div>
  )
}

function DocItem({ doc }) {
  const when = formatDate(doc.uploaded_at)
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
      <span
        style={{
          width: 34,
          height: 34,
          borderRadius: 9,
          flexShrink: 0,
          display: 'grid',
          placeItems: 'center',
          background: 'color-mix(in oklab, var(--euc-deep) 10%, transparent)',
          color: 'var(--euc-deep)',
        }}
      >
        <Glyph name="doc" size={16} stroke={1.8} />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--ink)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
          {docLabel(doc.doc_type)}
        </div>
        {when && <div style={{ fontSize: 11.5, color: 'var(--ink-soft)', marginTop: 1 }}>Uploaded {when}</div>}
      </div>
    </div>
  )
}

export function AssessorProfile({ onHome }) {
  const isMobile = useIsMobile()
  const [phase, setPhase] = useState('loading') // 'loading' | 'ready' | 'empty' | 'error'
  const [profile, setProfile] = useState(null)
  const [editing, setEditing] = useState(false)
  const [photoUrl, setPhotoUrl] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [cropFile, setCropFile] = useState(null) // picked photo awaiting crop/adjust
  const photoUrlRef = useRef(null)
  const [bannerUrl, setBannerUrl] = useState(null)
  const bannerUrlRef = useRef(null)
  const [bannerEditing, setBannerEditing] = useState(false)
  const [bannerBusy, setBannerBusy] = useState(false)
  const [bannerError, setBannerError] = useState(null)

  // Swap an object URL, revoking the previous one to avoid leaks.
  function setPhoto(url) {
    if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
    photoUrlRef.current = url
    setPhotoUrl(url)
  }
  function setBanner(url) {
    if (bannerUrlRef.current) URL.revokeObjectURL(bannerUrlRef.current)
    bannerUrlRef.current = url
    setBannerUrl(url)
  }

  async function loadPhoto() {
    try {
      setPhoto(await getMyAssessorPhotoUrl())
    } catch {
      setPhoto(null)
    }
  }
  async function loadBanner() {
    try {
      setBanner(await getMyAssessorBannerUrl())
    } catch {
      setBanner(null)
    }
  }

  // Apply a profile's media side-effects (avatar + banner image blobs).
  function loadMedia(p) {
    if (p.has_photo) loadPhoto()
    else setPhoto(null)
    if (p.banner_type === 'image' && p.has_banner_image) loadBanner()
    else setBanner(null)
  }

  // Fetch (or refetch) the profile, then its media.
  async function load() {
    const p = await getMyAssessorProfile()
    if (!p) {
      setPhase('empty')
      return
    }
    setProfile(p)
    setPhase('ready')
    loadMedia(p)
  }

  useEffect(() => {
    let cancelled = false
    getMyAssessorProfile()
      .then((p) => {
        if (cancelled) return
        if (p) {
          setProfile(p)
          setPhase('ready')
          loadMedia(p)
        } else {
          setPhase('empty')
        }
      })
      .catch(() => {
        if (!cancelled) setPhase('error')
      })
    return () => {
      cancelled = true
      if (photoUrlRef.current) URL.revokeObjectURL(photoUrlRef.current)
      if (bannerUrlRef.current) URL.revokeObjectURL(bannerUrlRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Set a solid colour / gradient preset / reset (null) via PATCH, then refetch.
  async function applyBanner(banner_type, banner_value) {
    setBannerBusy(true)
    setBannerError(null)
    try {
      await updateMyAssessorProfile({ banner_type, banner_value })
      await load()
      setBannerEditing(false)
    } catch (e) {
      setBannerError(e.message || 'Could not update the banner.')
    } finally {
      setBannerBusy(false)
    }
  }

  async function handleBannerUpload(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setBannerBusy(true)
    setBannerError(null)
    try {
      await uploadAssessorBanner(file)
      await load()
      setBannerEditing(false)
    } catch (err) {
      setBannerError(err.message || 'Could not upload the banner.')
    } finally {
      setBannerBusy(false)
    }
  }

  // Picking a photo opens the cropper (LinkedIn-style) rather than uploading raw —
  // the assessor positions it within the circle first.
  function handlePhotoPick(e) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (file) setCropFile(file)
  }

  // The cropper hands back the framed image; upload that, then refetch.
  async function handleCropSave(blob) {
    setUploading(true)
    try {
      await uploadAssessorProfilePhoto(new File([blob], 'avatar.jpg', { type: 'image/jpeg' }))
      await load() // refetch so has_photo + the new image show
      setCropFile(null)
    } catch {
      /* keep the cropper open on failure */
    } finally {
      setUploading(false)
    }
  }

  async function handleSaved() {
    await load()
    setEditing(false)
  }

  if (phase === 'loading') {
    return <Centered>Loading your profile…</Centered>
  }
  if (phase === 'error') {
    return (
      <Centered>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 14, color: '#93431F', fontWeight: 600 }}>Could not load your profile.</div>
          <CBtn onClick={onHome}>Back to worklist</CBtn>
        </div>
      </Centered>
    )
  }
  if (phase === 'empty') {
    return (
      <Centered>
        <div style={{ textAlign: 'center' }}>
          <div style={{ marginBottom: 14, color: 'var(--ink-soft)' }}>No assessor profile on file yet.</div>
          <CBtn onClick={onHome}>Back to worklist</CBtn>
        </div>
      </Centered>
    )
  }

  const name = [profile.legal_first_name, profile.legal_last_name].filter(Boolean).join(' ') || '—'
  const subline = [profile.accreditation_level, profile.business_name || profile.trading_name]
    .filter(Boolean)
    .join('  ·  ')

  const status = STATUS_STYLES[profile.status] || { label: profile.status || 'Unknown', color: 'var(--ink-soft)', bg: 'color-mix(in oklab, var(--ink) 9%, transparent)' }
  const work = profile.accepting_new_work
    ? { label: 'Accepting new work', color: 'var(--euc-deep)', bg: 'color-mix(in oklab, var(--euc-deep) 12%, transparent)' }
    : { label: 'Not accepting new work', color: 'var(--ink-soft)', bg: 'color-mix(in oklab, var(--ink) 8%, transparent)' }

  const pills = (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
      <Pill label={status.label} color={status.color} bg={status.bg} dot />
      <Pill label={work.label} color={work.color} bg={work.bg} dot />
    </div>
  )

  const radius = profile.service_radius_km == null ? null : `${profile.service_radius_km} km radius`
  const docs = Array.isArray(profile.documents) ? profile.documents : []

  return (
    <div data-screen-label="Profile" style={{ maxWidth: 880, margin: '0 auto', padding: isMobile ? '16px 14px 48px' : '26px 28px 60px' }}>
      <BackButton onClick={onHome} />
      {cropFile && (
        <PhotoCropper
          file={cropFile}
          busy={uploading}
          onCancel={() => setCropFile(null)}
          onSave={handleCropSave}
        />
      )}
      {bannerEditing && (
        <BannerEditor
          profile={profile}
          bannerUrl={bannerUrl}
          busy={bannerBusy}
          error={bannerError}
          onApply={applyBanner}
          onUpload={handleBannerUpload}
          onClose={() => setBannerEditing(false)}
        />
      )}
      <div
        className="cs-card"
        style={{
          overflow: 'hidden',
          padding: 0,
          marginBottom: 16,
          boxShadow: '0 1px 2px rgba(38,39,31,0.06), 0 22px 48px -22px rgba(38,39,31,0.4)',
        }}
      >
        {/* Banner strip — customizable (solid colour / gradient / uploaded image),
            with the app's ember gradient as the default. */}
        <div
          style={{
            position: 'relative',
            height: isMobile ? 112 : 158,
            ...bannerBackground(profile, bannerUrl),
          }}
        >
          <button
            className="ec-press"
            onClick={() => { setBannerError(null); setBannerEditing(true) }}
            title="Customize banner"
            style={{
              position: 'absolute',
              top: 12,
              right: 12,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '6px 11px',
              borderRadius: 9,
              cursor: 'pointer',
              border: 'none',
              background: 'color-mix(in oklab, var(--ink) 55%, transparent)',
              color: 'var(--paper)',
              fontFamily: 'var(--font-ui)',
              fontSize: 12,
              fontWeight: 600,
              backdropFilter: 'blur(3px)',
            }}
          >
            <Glyph name="image" size={14} stroke={1.9} />
            {!isMobile && 'Customize banner'}
          </button>
        </div>
        {/* Headline block: avatar overlaps the banner's bottom edge */}
        <div style={{ padding: isMobile ? '0 18px 22px' : '0 28px 26px' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 14,
              flexWrap: 'wrap',
            }}
          >
            <Avatar
              profile={profile}
              photoUrl={photoUrl}
              isMobile={isMobile}
              uploading={uploading}
              onPick={handlePhotoPick}
            />
            {!isMobile && (
              <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 12 }}>
                {!editing && (
                  <CBtn variant="quiet" icon="pencil" onClick={() => setEditing(true)}>
                    Edit profile
                  </CBtn>
                )}
                {pills}
              </div>
            )}
          </div>

          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: isMobile ? 27 : 34,
              color: 'var(--ink)',
              margin: '16px 0 5px',
              letterSpacing: '-0.015em',
              lineHeight: 1.08,
            }}
          >
            {name}
          </h1>
          {subline && (
            <div style={{ fontSize: 14.5, color: 'var(--ink-soft)', fontWeight: 600 }}>{subline}</div>
          )}

          {/* Contact / location meta row */}
          <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, fontSize: 12.5, color: 'var(--ink-soft)', fontWeight: 600 }}>
            {(profile.operating_states || []).length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--ochre)', display: 'flex' }}><Glyph name="pin" size={14} stroke={1.9} /></span>
                {profile.operating_states.join(' · ')}
              </span>
            )}
            {!isEmpty(profile.phone) && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <span style={{ color: 'var(--ochre)', display: 'flex' }}><Glyph name="phone" size={14} stroke={1.9} /></span>
                {profile.phone}
              </span>
            )}
          </div>

          {isMobile && (
            <div style={{ marginTop: 14, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {pills}
              {!editing && (
                <CBtn variant="quiet" icon="pencil" onClick={() => setEditing(true)} style={{ alignSelf: 'flex-start' }}>
                  Edit profile
                </CBtn>
              )}
            </div>
          )}
        </div>
      </div>

      {editing ? (
        <EditProfileForm profile={profile} onCancel={() => setEditing(false)} onSaved={handleSaved} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Section title="Accreditation" icon="badge">
            <Detail label="Number" value={profile.accreditation_number} />
            <Detail label="Level" value={profile.accreditation_level} />
            <Detail label="Expiry" value={formatDate(profile.accreditation_expiry)} />
            <Detail label="Qualification" value={profile.qualification} />
          </Section>

          <Section title="Operating area" icon="pin">
            <Detail label="States" value={(profile.operating_states || []).join(', ')} />
            <Detail label="LGAs" value={(profile.operating_lgas || []).join(', ')} />
            <Detail label="Service radius" value={radius} />
            <Detail label="Max active jobs" value={profile.max_active_jobs} />
          </Section>

          <Section title="Business" icon="briefcase">
            <Detail label="Business name" value={profile.business_name} />
            <Detail label="Trading name" value={profile.trading_name} />
            <Detail label="ABN" value={profile.abn} />
            <Detail label="Base address" value={profile.base_address} />
          </Section>

          <Section title="Insurance" icon="shield">
            <Detail label="Insurer" value={profile.insurer} />
            <Detail label="Policy number" value={profile.insurance_policy_number} />
            <Detail label="Expiry" value={formatDate(profile.insurance_expiry)} />
          </Section>

          <Section title="Documents" icon="doc">
            {docs.map((d, i) => (
              <DocItem key={i} doc={d} />
            ))}
          </Section>
        </div>
      )}
    </div>
  )
}

// Circular avatar: the real photo when one is on file, else initials. Overlaid
// with a small camera control that uploads a new profile_photo.
function Avatar({ profile, photoUrl, isMobile, uploading, onPick }) {
  const size = isMobile ? 96 : 124
  return (
    <div style={{ position: 'relative', width: size, height: size, marginTop: isMobile ? -48 : -62, flexShrink: 0 }}>
      <div
        style={{
          width: size,
          height: size,
          borderRadius: '50%',
          overflow: 'hidden',
          background: 'linear-gradient(150deg, var(--euc-deep), color-mix(in oklab, var(--euc-deep) 72%, var(--ochre)))',
          color: 'var(--paper)',
          border: '4px solid var(--panel)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'var(--font-display)',
          fontWeight: 800,
          fontSize: isMobile ? 36 : 46,
          letterSpacing: '0.02em',
          boxShadow: '0 10px 26px -8px rgba(38,39,31,0.5)',
        }}
      >
        {photoUrl ? (
          <img src={photoUrl} alt="Profile photo" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
        ) : (
          initials(profile.legal_first_name, profile.legal_last_name)
        )}
      </div>
      <label
        className="ec-press"
        title="Upload photo"
        style={{
          position: 'absolute',
          right: 2,
          bottom: 2,
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'grid',
          placeItems: 'center',
          cursor: uploading ? 'wait' : 'pointer',
          background: 'var(--euc-deep)',
          color: 'var(--paper)',
          border: '2px solid var(--panel)',
          boxShadow: '0 2px 8px rgba(38,39,31,0.3)',
          opacity: uploading ? 0.6 : 1,
        }}
      >
        <Glyph name={uploading ? 'refresh' : 'camera'} size={15} stroke={1.9} />
        <input
          type="file"
          accept="image/jpeg,image/png"
          disabled={uploading}
          onChange={onPick}
          style={{ display: 'none' }}
        />
      </label>
    </div>
  )
}

// Edit form — ONLY the safe, self-editable fields (the same allow-list the
// backend's PATCH /assessor/me accepts). Accreditation, ABN, insurance and status
// are deliberately absent: they stay locked and read-only on the profile.
function EditProfileForm({ profile, onCancel, onSaved }) {
  const [f, setF] = useState({
    legal_first_name: profile.legal_first_name || '',
    legal_last_name: profile.legal_last_name || '',
    phone: profile.phone || '',
    business_name: profile.business_name || '',
    trading_name: profile.trading_name || '',
    base_address: profile.base_address || '',
    operating_states: (profile.operating_states || []).join(', '),
    operating_lgas: (profile.operating_lgas || []).join(', '),
    service_radius_km: profile.service_radius_km == null ? '' : String(profile.service_radius_km),
    max_active_jobs: profile.max_active_jobs == null ? '' : String(profile.max_active_jobs),
    qualification: profile.qualification || '',
    accepting_new_work: !!profile.accepting_new_work,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  const set = (k, v) => setF((prev) => ({ ...prev, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (saving) return

    // Build the PATCH payload — text fields trimmed (empty → null to clear),
    // lists parsed, numbers coerced. max_active_jobs is only sent when a valid
    // number so an empty box never nulls a required int.
    const payload = {
      legal_first_name: f.legal_first_name.trim() || null,
      legal_last_name: f.legal_last_name.trim() || null,
      phone: f.phone.trim() || null,
      business_name: f.business_name.trim() || null,
      trading_name: f.trading_name.trim() || null,
      base_address: f.base_address.trim() || null,
      operating_states: parseList(f.operating_states),
      operating_lgas: parseList(f.operating_lgas),
      qualification: f.qualification.trim() || null,
      accepting_new_work: f.accepting_new_work,
      service_radius_km: f.service_radius_km.trim() === '' ? null : Number(f.service_radius_km),
    }
    if (payload.service_radius_km != null && Number.isNaN(payload.service_radius_km)) {
      setError('Service radius must be a number.')
      return
    }
    if (f.max_active_jobs.trim() !== '') {
      const n = Number(f.max_active_jobs)
      if (Number.isNaN(n) || n < 0) {
        setError('Max active jobs must be a whole number.')
        return
      }
      payload.max_active_jobs = n
    }

    setSaving(true)
    setError(null)
    try {
      await updateMyAssessorProfile(payload)
      await onSaved()
    } catch (err) {
      setError(err.message || 'Could not save your changes.')
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <FormSection title="Personal" icon="badge">
        <Field label="Legal first name">
          <input style={FIELD} value={f.legal_first_name} onChange={(e) => set('legal_first_name', e.target.value)} />
        </Field>
        <Field label="Legal last name">
          <input style={FIELD} value={f.legal_last_name} onChange={(e) => set('legal_last_name', e.target.value)} />
        </Field>
        <Field label="Phone">
          <input style={FIELD} value={f.phone} onChange={(e) => set('phone', e.target.value)} inputMode="tel" />
        </Field>
        <Field label="Qualification">
          <input style={FIELD} value={f.qualification} onChange={(e) => set('qualification', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Business" icon="briefcase">
        <Field label="Business name">
          <input style={FIELD} value={f.business_name} onChange={(e) => set('business_name', e.target.value)} />
        </Field>
        <Field label="Trading name">
          <input style={FIELD} value={f.trading_name} onChange={(e) => set('trading_name', e.target.value)} />
        </Field>
        <Field label="Base address">
          <input style={FIELD} value={f.base_address} onChange={(e) => set('base_address', e.target.value)} />
        </Field>
      </FormSection>

      <FormSection title="Operating area" icon="pin">
        <Field label="States" hint="Comma-separated, e.g. NSW, QLD">
          <input style={FIELD} value={f.operating_states} onChange={(e) => set('operating_states', e.target.value)} />
        </Field>
        <Field label="LGAs" hint="Comma-separated">
          <input style={FIELD} value={f.operating_lgas} onChange={(e) => set('operating_lgas', e.target.value)} />
        </Field>
        <Field label="Service radius (km)">
          <input type="number" min="0" style={FIELD} value={f.service_radius_km} onChange={(e) => set('service_radius_km', e.target.value)} />
        </Field>
        <Field label="Max active jobs">
          <input type="number" min="0" step="1" style={FIELD} value={f.max_active_jobs} onChange={(e) => set('max_active_jobs', e.target.value)} />
        </Field>
        <Field label="Accepting new work">
          <div style={{ display: 'flex', gap: 8 }}>
            {[['Accepting', true], ['Not accepting', false]].map(([label, val]) => {
              const on = f.accepting_new_work === val
              return (
                <button
                  type="button"
                  key={label}
                  className="ec-press"
                  onClick={() => set('accepting_new_work', val)}
                  style={{
                    padding: '8px 14px',
                    borderRadius: 99,
                    cursor: 'pointer',
                    fontFamily: 'var(--font-ui)',
                    fontSize: 13,
                    fontWeight: 700,
                    border: on ? '1.5px solid var(--euc-deep)' : '1px solid color-mix(in oklab, var(--ink) 20%, transparent)',
                    background: on ? 'color-mix(in oklab, var(--euc-deep) 12%, var(--panel))' : 'var(--panel)',
                    color: on ? 'var(--euc-deep)' : 'var(--ink-soft)',
                  }}
                >
                  {label}
                </button>
              )
            })}
          </div>
        </Field>
      </FormSection>

      <div style={{ fontSize: 12, color: 'var(--ink-soft)', display: 'flex', alignItems: 'center', gap: 7 }}>
        <Glyph name="shield" size={14} stroke={1.8} />
        Accreditation, ABN, insurance and approval status are locked and can only be changed by an administrator.
      </div>

      {error && (
        <div style={{ padding: '10px 13px', borderRadius: 10, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 12.5, fontWeight: 600 }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10 }}>
        <CBtn type="submit" variant="primary" icon="check" disabled={saving}>
          {saving ? 'Saving…' : 'Save changes'}
        </CBtn>
        <CBtn type="button" variant="quiet" onClick={onCancel} disabled={saving}>
          Cancel
        </CBtn>
      </div>
    </form>
  )
}

// Same card shell as the read-only Section, but always shows (a form section is
// never conditionally hidden) and lays fields out in a responsive grid.
function FormSection({ title, icon, children }) {
  return (
    <div className="cs-card" style={{ padding: '20px 22px', boxShadow: '0 1px 2px rgba(38,39,31,0.05), 0 14px 34px -18px rgba(38,39,31,0.35)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 11, marginBottom: 16 }}>
        <span style={{ width: 30, height: 30, borderRadius: 9, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'color-mix(in oklab, var(--ochre) 20%, transparent)', color: 'var(--euc-deep)' }}>
          <Glyph name={icon} size={16} stroke={1.9} />
        </span>
        <CSectionLabel style={{ fontSize: 11, letterSpacing: '0.13em' }}>{title}</CSectionLabel>
        <span style={{ flex: 1, height: 1, background: 'var(--line)' }} />
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '16px 24px' }}>
        {children}
      </div>
    </div>
  )
}

// A neat, icon-only back control (no text label) that returns to the worklist.
function BackButton({ onClick }) {
  return (
    <button
      className="ec-press"
      onClick={onClick}
      aria-label="Back to worklist"
      title="Back to worklist"
      style={{
        width: 36,
        height: 36,
        marginBottom: 12,
        display: 'grid',
        placeItems: 'center',
        borderRadius: 10,
        cursor: 'pointer',
        background: 'var(--panel)',
        border: '1px solid var(--line)',
        color: 'var(--ink)',
        boxShadow: '0 1px 2px rgba(38,39,31,0.05)',
      }}
    >
      <Glyph name="chevronLeft" size={18} stroke={2} />
    </button>
  )
}

// Banner customizer — a small modal to pick a solid colour, a gradient preset, or
// upload an image. Each choice applies immediately (PATCH or upload) then the
// parent refetches. A live preview strip mirrors bannerBackground().
function BannerEditor({ profile, bannerUrl, busy, error, onApply, onUpload, onClose }) {
  const swatch = (bg, selected, onClick, key) => (
    <button
      key={key}
      type="button"
      className="ec-press"
      disabled={busy}
      onClick={onClick}
      style={{
        width: 46,
        height: 34,
        borderRadius: 9,
        cursor: busy ? 'default' : 'pointer',
        background: bg,
        border: selected ? '2.5px solid var(--euc-deep)' : '1px solid var(--line)',
        boxShadow: selected ? '0 0 0 2px color-mix(in oklab, var(--euc-deep) 30%, transparent)' : 'none',
      }}
    />
  )

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Customize banner"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center',
        justifyContent: 'center', padding: 20, background: 'rgba(28,25,16,0.5)',
        backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)',
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="cs-card"
        style={{ maxWidth: 460, width: '100%', padding: '22px 22px 20px', boxShadow: '0 24px 60px rgba(40,36,24,0.3)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <CSectionLabel style={{ fontSize: 12 }}>Customize banner</CSectionLabel>
          <button onClick={onClose} aria-label="Close" className="ec-press" style={{ border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 20, color: 'var(--ink-soft)', lineHeight: 1 }}>×</button>
        </div>

        {/* Live preview */}
        <div style={{ height: 66, borderRadius: 12, marginBottom: 18, border: '1px solid var(--line)', ...bannerBackground(profile, bannerUrl) }} />

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 9 }}>Solid colour</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
            {BANNER_COLORS.map((c) =>
              swatch(c, profile.banner_type === 'color' && profile.banner_value === c, () => onApply('color', c), c),
            )}
            <label
              className="ec-press"
              title="Custom colour"
              style={{ width: 46, height: 34, borderRadius: 9, cursor: busy ? 'default' : 'pointer', display: 'grid', placeItems: 'center', border: '1px dashed var(--line)', color: 'var(--ink-soft)', position: 'relative' }}
            >
              <Glyph name="pencil" size={14} />
              <input
                type="color"
                disabled={busy}
                onChange={(e) => onApply('color', e.target.value)}
                style={{ position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer' }}
              />
            </label>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 9 }}>Gradient</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {Object.entries(GRADIENTS).map(([id, css]) =>
              swatch(css, profile.banner_type === 'gradient' && profile.banner_value === id, () => onApply('gradient', id), id),
            )}
          </div>
        </div>

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
          <label
            className="ec-press"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 7, padding: '8px 14px', borderRadius: 9,
              cursor: busy ? 'default' : 'pointer', background: 'var(--euc-deep)', color: 'var(--paper)',
              fontFamily: 'var(--font-ui)', fontSize: 12.5, fontWeight: 600, opacity: busy ? 0.6 : 1,
            }}
          >
            <Glyph name="image" size={15} stroke={1.9} />
            {busy ? 'Working…' : 'Upload image'}
            <input type="file" accept="image/jpeg,image/png" disabled={busy} onChange={onUpload} style={{ display: 'none' }} />
          </label>
          <CBtn variant="quiet" disabled={busy} onClick={() => onApply(null, null)}>Reset to default</CBtn>
        </div>

        {error && (
          <div style={{ marginTop: 14, padding: '9px 12px', borderRadius: 9, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 12.5, fontWeight: 600 }}>
            {error}
          </div>
        )}
      </div>
    </div>
  )
}

function Centered({ children }) {
  return (
    <div style={{ minHeight: '60vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, color: 'var(--ink-soft)' }}>
      {children}
    </div>
  )
}

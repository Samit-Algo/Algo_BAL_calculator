// Assessor registration screen (Phase 2, Step 3). One full-screen view with
// three internal states, chosen by GET /assessor/me on mount:
//   (a) loading  — while the check runs
//   (b) no profile (404 -> null) — the application form
//   (c) has a profile — the status state (pending / approved / rejected)
//
// Purely informational: submitting lodges a PENDING application and grants NO
// access. Mirrors AuthModal's form structure (per-field state, validate-before-
// submit, try/catch/finally) and the ECCard/ECEyebrow status surfaces. Styling
// uses the ember CSS tokens, never raw hex.

import { useEffect, useState } from 'react'
import { ECCard, ECEyebrow } from './ui/ECCard'
import ECButton from './ui/ECButton'
import StatusPill from './ui/StatusPill'
import Glyph from './ui/Glyph'
import {
  getMyAssessorProfile,
  registerAssessor,
  uploadAssessorDocuments,
} from '../lib/assessor'

const fieldStyle = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 50,
  padding: '0 14px',
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

const STATE_OPTIONS = ['NSW', 'QLD', 'VIC', 'SA']
const DOC_TYPES = ['accreditation', 'insurance', 'identity', 'profile_photo']

function Field({ label, required, children, hint }) {
  return (
    <div>
      <label style={labelStyle}>
        {label} {required && <span style={{ color: 'var(--euc-deep)' }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ margin: '6px 2px 0', fontSize: 12.5, color: 'var(--ink-soft)' }}>{hint}</p>}
    </div>
  )
}

function SectionCard({ n, eyebrow, children }) {
  return (
    <ECCard style={{ marginBottom: 16 }}>
      <ECEyebrow n={n}>{eyebrow}</ECEyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </ECCard>
  )
}

// Parse a textarea of LGAs into a clean list: split on newline or comma, trim,
// drop empties.
function parseLgas(raw) {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

export default function AssessorRegistration({ onBackToDashboard }) {
  const [phase, setPhase] = useState('loading') // 'loading' | 'form' | 'status' | 'error'
  const [profile, setProfile] = useState(null)
  const [loadError, setLoadError] = useState(null)

  useEffect(() => {
    let cancelled = false
    async function check() {
      try {
        const existing = await getMyAssessorProfile()
        if (cancelled) return
        if (existing) {
          setProfile(existing)
          setPhase('status')
        } else {
          setPhase('form')
        }
      } catch (err) {
        if (cancelled) return
        setLoadError(err.message)
        setPhase('error')
      }
    }
    check()
    return () => {
      cancelled = true
    }
  }, [])

  if (phase === 'loading') {
    return (
      <Centered>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: 'var(--ink-soft)', fontWeight: 600 }}>
          <span className="ec-spin" aria-hidden="true" style={{ color: 'var(--euc-deep)' }}>
            <Glyph name="refresh" size={22} />
          </span>
          Checking your application…
        </div>
      </Centered>
    )
  }

  if (phase === 'error') {
    return (
      <Centered>
        <ECCard style={{ maxWidth: 460, textAlign: 'center' }}>
          <p style={{ margin: '0 0 18px', color: 'var(--ink)', fontSize: 15 }}>{loadError}</p>
          <ECButton full onClick={onBackToDashboard}>Back to my properties</ECButton>
        </ECCard>
      </Centered>
    )
  }

  if (phase === 'status') {
    return <StatusState profile={profile} onBackToDashboard={onBackToDashboard} onProfileUpdate={setProfile} />
  }

  return <RegistrationForm onSubmitted={(p) => { setProfile(p); setPhase('status') }} />
}

function Centered({ children }) {
  return (
    <div
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '40px 24px 64px',
        minHeight: 'calc(100vh - 160px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {children}
    </div>
  )
}

// ─────────────────────────── The form ───────────────────────────
function RegistrationForm({ onSubmitted }) {
  const [legalFirstName, setLegalFirstName] = useState('')
  const [legalLastName, setLegalLastName] = useState('')
  const [dateOfBirth, setDateOfBirth] = useState('')
  const [phone, setPhone] = useState('')
  const [businessName, setBusinessName] = useState('')
  const [tradingName, setTradingName] = useState('')
  const [abn, setAbn] = useState('')
  const [accreditationNumber, setAccreditationNumber] = useState('')
  const [accreditationLevel, setAccreditationLevel] = useState('')
  const [accreditationExpiry, setAccreditationExpiry] = useState('')
  const [qualification, setQualification] = useState('')
  const [operatingStates, setOperatingStates] = useState([])
  const [operatingLgas, setOperatingLgas] = useState('')
  const [baseAddress, setBaseAddress] = useState('')
  const [serviceRadiusKm, setServiceRadiusKm] = useState('')
  const [insurer, setInsurer] = useState('')
  const [policyNumber, setPolicyNumber] = useState('')
  const [insuranceExpiry, setInsuranceExpiry] = useState('')
  const [docs, setDocs] = useState([]) // [{ file, doc_type }]

  const [error, setError] = useState(null)
  const [submitting, setSubmitting] = useState(false)

  function toggleState(s) {
    setOperatingStates((prev) => (prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]))
  }

  function handleFiles(e) {
    const picked = Array.from(e.target.files || [])
    setDocs((prev) => [...prev, ...picked.map((file) => ({ file, doc_type: 'accreditation' }))])
    e.target.value = ''
  }

  function setDocType(idx, doc_type) {
    setDocs((prev) => prev.map((d, i) => (i === idx ? { ...d, doc_type } : d)))
  }

  function removeDoc(idx) {
    setDocs((prev) => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (submitting) return

    // Client-side validation of the backend's required set — no round-trip on
    // bad input.
    const lgas = parseLgas(operatingLgas)
    const missing =
      !legalFirstName.trim() ||
      !legalLastName.trim() ||
      !phone.trim() ||
      !businessName.trim() ||
      !accreditationNumber.trim() ||
      !accreditationLevel.trim() ||
      !accreditationExpiry ||
      operatingStates.length === 0 ||
      lgas.length === 0 ||
      !baseAddress.trim()
    if (missing) {
      setError('Please fill in all required fields (marked *).')
      return
    }
    const abnDigits = abn.replace(/\s/g, '')
    if (abnDigits && (abnDigits.length !== 11 || !/^\d+$/.test(abnDigits))) {
      setError('ABN must be 11 digits.')
      return
    }

    // Build the payload, omitting empty optionals.
    const payload = {
      legal_first_name: legalFirstName.trim(),
      legal_last_name: legalLastName.trim(),
      phone: phone.trim(),
      business_name: businessName.trim(),
      accreditation_number: accreditationNumber.trim(),
      accreditation_level: accreditationLevel.trim(),
      accreditation_expiry: new Date(accreditationExpiry).toISOString(),
      operating_states: operatingStates,
      operating_lgas: lgas,
      base_address: baseAddress.trim(),
    }
    if (dateOfBirth) payload.date_of_birth = new Date(dateOfBirth).toISOString()
    if (tradingName.trim()) payload.trading_name = tradingName.trim()
    if (abnDigits) payload.abn = abnDigits
    if (qualification.trim()) payload.qualification = qualification.trim()
    if (serviceRadiusKm !== '') payload.service_radius_km = Number(serviceRadiusKm)
    if (insurer.trim()) payload.insurer = insurer.trim()
    if (policyNumber.trim()) payload.insurance_policy_number = policyNumber.trim()
    if (insuranceExpiry) payload.insurance_expiry = new Date(insuranceExpiry).toISOString()

    setSubmitting(true)
    setError(null)
    try {
      let created = await registerAssessor(payload)
      // Documents are encouraged but non-blocking: a failed upload doesn't undo
      // the lodged application.
      if (docs.length) {
        try {
          created = await uploadAssessorDocuments(
            docs.map((d) => d.file),
            docs.map((d) => d.doc_type),
          )
        } catch {
          onSubmitted({ ...created, _docWarning: true })
          return
        }
      }
      onSubmitted(created)
    } catch (err) {
      setError(err.message || 'Something went wrong. Please try again.')
      setSubmitting(false)
    }
  }

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '28px 24px 64px' }}>
      <div style={{ marginBottom: 20 }}>
        <h1
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 'clamp(24px, 3vw, 30px)',
            color: 'var(--ink)',
            margin: '0 0 6px',
          }}
        >
          Become an accredited assessor
        </h1>
        <p style={{ margin: 0, fontSize: 14.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
          Apply to join EmberCheck as an accredited assessor. We’ll review your application — submitting
          this does not grant access on its own.
        </p>
      </div>

      <form onSubmit={handleSubmit}>
        <SectionCard n="1" eyebrow="Personal">
          <Field label="Legal first name" required>
            <input style={fieldStyle} value={legalFirstName} onChange={(e) => setLegalFirstName(e.target.value)} />
          </Field>
          <Field label="Legal last name" required>
            <input style={fieldStyle} value={legalLastName} onChange={(e) => setLegalLastName(e.target.value)} />
          </Field>
          <Field label="Date of birth">
            <input type="date" style={fieldStyle} value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          </Field>
        </SectionCard>

        <SectionCard n="2" eyebrow="Contact">
          <Field label="Phone" required>
            <input style={fieldStyle} value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
          </Field>
        </SectionCard>

        <SectionCard n="3" eyebrow="Business">
          <Field label="Business name" required>
            <input style={fieldStyle} value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="Trading name">
            <input style={fieldStyle} value={tradingName} onChange={(e) => setTradingName(e.target.value)} />
          </Field>
          <Field label="ABN" hint="11 digits, if you have one.">
            <input style={fieldStyle} value={abn} onChange={(e) => setAbn(e.target.value)} inputMode="numeric" />
          </Field>
        </SectionCard>

        <SectionCard n="4" eyebrow="Accreditation">
          <Field label="Accreditation number" required>
            <input style={fieldStyle} value={accreditationNumber} onChange={(e) => setAccreditationNumber(e.target.value)} />
          </Field>
          <Field label="Accreditation level" required>
            <input style={fieldStyle} value={accreditationLevel} onChange={(e) => setAccreditationLevel(e.target.value)} />
          </Field>
          <Field label="Accreditation expiry" required>
            <input type="date" style={fieldStyle} value={accreditationExpiry} onChange={(e) => setAccreditationExpiry(e.target.value)} />
          </Field>
          <Field label="Qualification">
            <input style={fieldStyle} value={qualification} onChange={(e) => setQualification(e.target.value)} />
          </Field>
        </SectionCard>

        <SectionCard n="5" eyebrow="Operating area">
          <Field label="Operating states" required>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {STATE_OPTIONS.map((s) => {
                const on = operatingStates.includes(s)
                return (
                  <button
                    type="button"
                    key={s}
                    onClick={() => toggleState(s)}
                    className="ec-press"
                    style={{
                      padding: '8px 16px',
                      borderRadius: 99,
                      cursor: 'pointer',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 14,
                      fontWeight: 700,
                      border: on ? '2px solid var(--euc-deep)' : '2px solid var(--line)',
                      background: on ? 'color-mix(in oklab, var(--euc-deep) 12%, var(--card))' : 'var(--card)',
                      color: on ? 'var(--euc-deep)' : 'var(--ink-soft)',
                    }}
                  >
                    {s}
                  </button>
                )
              })}
            </div>
          </Field>
          <Field label="Operating LGAs" required hint="One per line, or comma-separated.">
            <textarea
              style={{ ...fieldStyle, minHeight: 84, padding: '12px 14px', resize: 'vertical' }}
              value={operatingLgas}
              onChange={(e) => setOperatingLgas(e.target.value)}
              placeholder={'Blue Mountains\nLithgow'}
            />
          </Field>
          <Field label="Base address" required>
            <input style={fieldStyle} value={baseAddress} onChange={(e) => setBaseAddress(e.target.value)} />
          </Field>
          <Field label="Service radius (km)">
            <input type="number" min="0" style={fieldStyle} value={serviceRadiusKm} onChange={(e) => setServiceRadiusKm(e.target.value)} />
          </Field>
        </SectionCard>

        <SectionCard n="6" eyebrow="Insurance (optional)">
          <Field label="Insurer">
            <input style={fieldStyle} value={insurer} onChange={(e) => setInsurer(e.target.value)} />
          </Field>
          <Field label="Policy number">
            <input style={fieldStyle} value={policyNumber} onChange={(e) => setPolicyNumber(e.target.value)} />
          </Field>
          <Field label="Insurance expiry">
            <input type="date" style={fieldStyle} value={insuranceExpiry} onChange={(e) => setInsuranceExpiry(e.target.value)} />
          </Field>
        </SectionCard>

        <SectionCard n="7" eyebrow="Documents">
          <p style={{ margin: 0, fontSize: 13.5, color: 'var(--ink-soft)', lineHeight: 1.5 }}>
            Attach your accreditation certificate, insurance, and ID. PDF, JPEG or PNG. You can add these
            later if you don’t have them handy.
          </p>
          {docs.map((d, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ flex: 1, fontSize: 13.5, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {d.file.name}
              </span>
              <select
                value={d.doc_type}
                onChange={(e) => setDocType(i, e.target.value)}
                style={{ ...fieldStyle, width: 'auto', minHeight: 40, fontSize: 13.5, padding: '0 10px' }}
              >
                {DOC_TYPES.map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => removeDoc(i)}
                aria-label="Remove document"
                style={{ border: 'none', background: 'transparent', color: 'var(--ink-soft)', cursor: 'pointer', fontSize: 18 }}
              >
                ×
              </button>
            </div>
          ))}
          <label
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '8px 14px',
              borderRadius: 10,
              border: '1px dashed var(--line)',
              fontSize: 13.5,
              fontWeight: 600,
              color: 'var(--euc-deep)',
              cursor: 'pointer',
              alignSelf: 'flex-start',
            }}
          >
            <Glyph name="upload" size={15} />
            Add document
            <input
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              multiple
              onChange={handleFiles}
              style={{ display: 'none' }}
            />
          </label>
        </SectionCard>

        {error && (
          <div
            role="alert"
            style={{
              padding: '11px 14px',
              borderRadius: 12,
              marginBottom: 16,
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
          {submitting ? 'Submitting…' : 'Submit application'}
        </ECButton>
      </form>
    </div>
  )
}

// ─────────────────────────── The status state ───────────────────────────
function StatusState({ profile, onBackToDashboard, onProfileUpdate }) {
  const status = profile.status
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)

  async function handleAddDocs(e) {
    const picked = Array.from(e.target.files || [])
    e.target.value = ''
    if (!picked.length) return
    setUploading(true)
    setUploadError(null)
    try {
      const updated = await uploadAssessorDocuments(
        picked,
        picked.map(() => 'accreditation'),
      )
      onProfileUpdate(updated)
    } catch (err) {
      setUploadError(err.message || 'Upload failed. Please try again.')
    }
    setUploading(false)
  }

  let heading
  let body
  if (status === 'APPROVED') {
    heading = 'You’re an approved assessor'
    body = 'Your accreditation is approved. The Assessor Console — where you review and sign off cases — is a separate app; this consumer app stays as it is.'
  } else if (status === 'REJECTED') {
    heading = 'Application not approved'
    body = profile.review_reason
      ? `Reviewer note: ${profile.review_reason}`
      : 'Your application wasn’t approved at this time.'
  } else {
    heading = 'Application received — pending review'
    body = 'Thanks for applying. Our team will review your accreditation and get back to you. You don’t have assessor access yet — approval is a separate step.'
  }

  return (
    <Centered>
      <ECCard style={{ maxWidth: 520, width: '100%' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 14 }}>
          <ECEyebrow>Assessor application</ECEyebrow>
          <StatusPill status={status} />
        </div>

        <h2
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 800,
            fontSize: 23,
            color: 'var(--ink)',
            margin: '0 0 10px',
            lineHeight: 1.2,
          }}
        >
          {heading}
        </h2>
        <p style={{ margin: '0 0 18px', fontSize: 14.5, lineHeight: 1.55, color: 'var(--ink-soft)' }}>{body}</p>

        {profile._docWarning && (
          <div
            role="alert"
            style={{
              padding: '11px 14px',
              borderRadius: 12,
              marginBottom: 16,
              background: 'color-mix(in oklab, var(--ochre) 16%, var(--card))',
              border: '1px solid color-mix(in oklab, var(--ochre) 40%, transparent)',
              color: '#7a5418',
              fontSize: 13.5,
              fontWeight: 600,
            }}
          >
            Application submitted. Document upload failed — you can add them below.
          </div>
        )}

        <div
          style={{
            background: 'color-mix(in oklab, var(--ink) 4%, transparent)',
            borderRadius: 14,
            padding: '14px 16px',
            marginBottom: 18,
          }}
        >
          <Summary label="Name" value={[profile.legal_first_name, profile.legal_last_name].filter(Boolean).join(' ')} />
          <Summary label="Business" value={profile.business_name} />
          <Summary label="Accreditation" value={profile.accreditation_number} />
          <Summary label="States" value={(profile.operating_states || []).join(', ')} />
          <Summary label="Documents" value={`${(profile.documents || []).length} attached`} />
        </div>

        {status === 'PENDING' && (
          <div style={{ marginBottom: 14 }}>
            <label
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                padding: '8px 14px',
                borderRadius: 10,
                border: '1px dashed var(--line)',
                fontSize: 13.5,
                fontWeight: 600,
                color: 'var(--euc-deep)',
                cursor: uploading ? 'wait' : 'pointer',
                opacity: uploading ? 0.6 : 1,
              }}
            >
              <Glyph name="upload" size={15} />
              {uploading ? 'Uploading…' : 'Add documents'}
              <input
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                multiple
                disabled={uploading}
                onChange={handleAddDocs}
                style={{ display: 'none' }}
              />
            </label>
            {uploadError && (
              <p style={{ margin: '8px 2px 0', fontSize: 13, color: '#7a2418', fontWeight: 600 }}>{uploadError}</p>
            )}
          </div>
        )}

        <ECButton full onClick={onBackToDashboard}>Back to my properties</ECButton>
      </ECCard>
    </Centered>
  )
}

function Summary({ label, value }) {
  if (!value) return null
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '4px 0', fontSize: 13.5 }}>
      <span style={{ color: 'var(--ink-soft)' }}>{label}</span>
      <span style={{ color: 'var(--ink)', fontWeight: 600, textAlign: 'right' }}>{value}</span>
    </div>
  )
}

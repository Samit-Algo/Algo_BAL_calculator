import { useCallback, useEffect, useRef, useState } from 'react'
import { balDescription } from '../lib/bal'
import {
  clearSectorOverride,
  deleteSectorPhoto,
  getCase,
  getSectorPhotoURL,
  setSectorOverride,
  uploadSectorPhotos,
} from '../lib/cases'
import { balToneColor } from '../lib/ec'
import { buildSideSummaries } from '../lib/report'
import { ECCard, ECEyebrow } from './ui/ECCard'
import Glyph from './ui/Glyph'
import ConfirmModal from './ui/ConfirmModal'
import ImageViewerModal from './ui/ImageViewerModal'
import SectorCameraCapture from './SectorCameraCapture'

// Same AS 3959 vegetation options the point-mode "adjust the inputs" page
// offers, so the consumer override feels consistent across both flows.
const VEG_OVERRIDE_OPTIONS = [
  ['Forest', 'Forest'],
  ['Woodland', 'Woodland'],
  ['Shrubland', 'Shrubland'],
  ['Scrub', 'Scrub'],
  ['Mallee/Heath', 'Mallee / Heath'],
  ['Rainforest', 'Rainforest'],
  ['Grassland', 'Grassland'],
  ['low_risk', 'Low risk / none'],
]

const fieldStyle = {
  width: '100%',
  padding: '6px 8px',
  borderRadius: 8,
  border: '1px solid var(--line)',
  background: 'var(--paper)',
  color: 'var(--ink)',
  fontSize: 12.5,
  fontFamily: 'var(--font-ui)',
}

function BalChip({ rating }) {
  const color = balToneColor(rating)
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 9px',
        borderRadius: 7,
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
        fontSize: 12.5,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {rating || '—'}
    </span>
  )
}

function reconciliationLabel(ev) {
  if (!ev) return null
  const { gis_draft_classification: draft, combined_classification: combined, review_flags } = ev
  const flags = review_flags || []

  if (!combined) return null

  if (flags.includes('photo_vegetation_no_distance_review'))
    return { text: 'Needs review: can’t measure distance from photos alone', tone: 'warn' }
  if (flags.includes('photo_found_unmapped_vegetation'))
    return { text: 'Needs review: photos show vegetation the map didn’t', tone: 'warn' }
  if (flags.includes('photo_lower_than_draft_review'))
    return { text: `Map: ${draft || '?'} · Photos: ${combined} → kept map (needs review)`, tone: 'info' }
  if (flags.includes('lowered_requires_review'))
    return { text: `Map: ${draft || '?'} · Photos: ${combined} → lowered (needs review)`, tone: 'warn' }

  if (draft && combined && draft !== combined)
    return { text: `Map: ${draft} · Photos: ${combined} → BAL raised`, tone: 'raise' }
  if (combined === draft)
    return { text: `Map: ${draft} · Photos: ${combined} → confirmed`, tone: 'ok' }
  return { text: `Photos: ${combined}`, tone: 'info' }
}

const RECON_COLORS = {
  warn: { bg: 'color-mix(in oklab, #b3402c 10%, var(--card))', border: 'color-mix(in oklab, #b3402c 30%, transparent)', color: '#7a2418' },
  raise: { bg: 'color-mix(in oklab, var(--ember, #7A1F1F) 10%, var(--card))', border: 'color-mix(in oklab, var(--ember) 30%, transparent)', color: '#7A1F1F' },
  ok: { bg: 'color-mix(in oklab, #4a7c59 10%, var(--card))', border: 'color-mix(in oklab, #4a7c59 30%, transparent)', color: '#3a6248' },
  info: { bg: 'color-mix(in oklab, var(--euc) 10%, var(--card))', border: 'color-mix(in oklab, var(--euc-deep) 20%, transparent)', color: 'var(--euc-deep)' },
}

const POLL_INTERVAL_MS = 3000
const POLL_MAX_ATTEMPTS = 20

function SectorPhotos({ caseId, compassSide, sectorEvidence, onEvidenceUpdate }) {
  const initialPhotos = sectorEvidence?.photos || []
  const [photos, setPhotos] = useState(initialPhotos)
  const [thumbMap, setThumbMap] = useState({})
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [confirmDeleteId, setConfirmDeleteId] = useState(null)
  const [viewerUrl, setViewerUrl] = useState(null)
  const [showCamera, setShowCamera] = useState(false)
  const [analysisStatus, setAnalysisStatus] = useState(sectorEvidence?.analysis_status || null)
  const fileRef = useRef(null)
  const pollRef = useRef(null)

  // Sync photos from parent prop when sectorEvidence changes (e.g. after hydrate).
  useEffect(() => {
    const propPhotos = sectorEvidence?.photos || []
    if (propPhotos.length > 0) setPhotos(propPhotos)
  }, [sectorEvidence?.photos])

  const loadThumbs = useCallback(async () => {
    if (!caseId || photos.length === 0) { setThumbMap({}); return }
    const entries = await Promise.all(
      photos.map(async (p) => {
        const id = p.photo_id
        if (!id) return null
        const url = await getSectorPhotoURL(caseId, compassSide, id)
        return url ? [id, url] : null
      })
    )
    setThumbMap(Object.fromEntries(entries.filter(Boolean)))
  }, [caseId, compassSide, photos])

  useEffect(() => { loadThumbs() }, [loadThumbs])
  useEffect(() => () => Object.values(thumbMap).forEach(u => URL.revokeObjectURL(u)), [thumbMap])

  // Sync analysis_status from parent when sectorEvidence prop changes.
  useEffect(() => {
    const status = sectorEvidence?.analysis_status || null
    setAnalysisStatus(status)
  }, [sectorEvidence?.analysis_status])

  // Poll for analysis completion when status is "pending".
  useEffect(() => {
    if (analysisStatus !== 'pending' || !caseId) return
    let attempts = 0
    let cancelled = false

    async function poll() {
      while (!cancelled && attempts < POLL_MAX_ATTEMPTS) {
        await new Promise(r => { pollRef.current = setTimeout(r, POLL_INTERVAL_MS) })
        if (cancelled) break
        attempts++
        try {
          const updated = await getCase(caseId)
          const ev = (updated.sector_evidence || []).find(e => e.compass_side === compassSide)
          if (!ev) continue
          if (ev.analysis_status === 'complete' || ev.analysis_status === 'error') {
            setAnalysisStatus(ev.analysis_status)
            setPhotos(ev.photos || [])
            onEvidenceUpdate?.(compassSide, {
              photos: ev.photos,
              combined_classification: ev.combined_classification,
              combined_confidence: ev.combined_confidence,
              combined_reasoning: ev.combined_reasoning,
              review_flags: ev.review_flags,
              final_bal: ev.final_bal,
              analysis_status: ev.analysis_status,
              // Current case headline (raise OR lower) after analysis completed,
              // so the panel's overall BAL reflects the latest assessment.
              bal_rating: updated.bal_rating,
              governing_direction: updated.governing_direction,
            })
            break
          }
        } catch {
          // poll failure — keep trying
        }
      }
    }
    poll()
    return () => {
      cancelled = true
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [analysisStatus, caseId, compassSide, onEvidenceUpdate])

  async function uploadFiles(files) {
    if (!files.length || !caseId) return
    setUploading(true)
    setUploadError(null)
    try {
      const result = await uploadSectorPhotos(caseId, compassSide, files)
      setPhotos(result.photos || [])
      setAnalysisStatus(result.analysis_status || 'pending')
      onEvidenceUpdate?.(compassSide, result)
    } catch (err) {
      setUploadError(err.message || 'Upload failed — tap to retry.')
    }
    setUploading(false)
  }

  async function handleFiles(e) {
    const files = Array.from(e.target.files || [])
    await uploadFiles(files)
    if (fileRef.current) fileRef.current.value = ''
  }

  // A photo captured live via SectorCameraCapture feeds the SAME upload
  // path as a file-picker selection - both end up calling uploadSectorPhotos
  // and the same background-analysis pipeline.
  async function handleCapturedFile(file) {
    await uploadFiles([file])
  }

  // Open the themed confirm dialog instead of the native confirm(); the actual
  // delete runs in performDelete on confirm.
  function handleDelete(photoId) {
    setConfirmDeleteId(photoId)
  }

  // The EXACT existing delete path, unchanged — including the step-1 behavior
  // where removing the last photo reverts the side to the GIS draft (the
  // backend response carries the cleared combined_classification / final_bal,
  // which onEvidenceUpdate applies). Returns the delete promise so the dialog
  // shows pending while the request is in flight.
  async function performDelete() {
    const photoId = confirmDeleteId
    if (!photoId) return
    setDeleting(photoId)
    try {
      const result = await deleteSectorPhoto(caseId, compassSide, photoId)
      setPhotos(result.photos || [])
      setAnalysisStatus(result.analysis_status)
      onEvidenceUpdate?.(compassSide, result)
    } catch {
      // deletion failed — leave the photo in place
    }
    setDeleting(null)
    setConfirmDeleteId(null)
  }

  const recon = reconciliationLabel(sectorEvidence)
  const analyzing = analysisStatus === 'pending'
  const analysisFailed = analysisStatus === 'error'

  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {photos.map((photo) => {
          const id = photo.photo_id
          const url = thumbMap[id]
          if (!url) return null
          return (
            <div key={id} style={{ position: 'relative', display: 'inline-block' }}>
              <button
                type="button"
                onClick={() => setViewerUrl(url)}
                aria-label={`View ${compassSide} photo full size`}
                style={{
                  display: 'block',
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  borderRadius: 8,
                  cursor: 'zoom-in',
                }}
              >
                <img
                  src={url}
                  alt={`${compassSide} photo`}
                  style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--line)', display: 'block' }}
                />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  // Delete sits over the thumbnail's corner — never let a delete
                  // click fall through to opening the viewer.
                  e.stopPropagation()
                  handleDelete(id)
                }}
                disabled={deleting === id}
                aria-label="Delete photo"
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 18,
                  height: 18,
                  borderRadius: 99,
                  border: '1.5px solid var(--card)',
                  background: 'rgba(122,33,24,0.85)',
                  color: '#fff',
                  fontSize: 11,
                  fontWeight: 800,
                  lineHeight: 1,
                  cursor: deleting === id ? 'wait' : 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
              >
                ×
              </button>
            </div>
          )
        })}
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px dashed var(--line)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--euc-deep)',
            cursor: uploading ? 'wait' : 'pointer',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <Glyph name="upload" size={14} />
          {uploading ? 'Uploading…' : 'Upload photo'}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png"
            multiple
            onChange={handleFiles}
            style={{ display: 'none' }}
            disabled={uploading}
          />
        </label>
        <button
          type="button"
          onClick={() => setShowCamera(true)}
          disabled={uploading}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 4,
            padding: '4px 10px',
            borderRadius: 8,
            border: '1px dashed var(--line)',
            background: 'none',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--euc-deep)',
            cursor: uploading ? 'wait' : 'pointer',
            opacity: uploading ? 0.6 : 1,
          }}
        >
          <Glyph name="camera" size={14} />
          Take photo
        </button>
      </div>

      {showCamera && (
        <SectorCameraCapture
          compassSide={compassSide}
          onClose={() => setShowCamera(false)}
          onCapture={handleCapturedFile}
        />
      )}

      <ConfirmModal
        isOpen={confirmDeleteId != null}
        tone="danger"
        title="Delete this photo?"
        message="This removes the photo from this side. If it’s the last one, the side reverts to the map draft rating."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={performDelete}
        onCancel={() => setConfirmDeleteId(null)}
      />

      <ImageViewerModal
        src={viewerUrl}
        alt={`${compassSide} photo`}
        onClose={() => setViewerUrl(null)}
      />

      {/* Upload error — visible, not swallowed */}
      {uploadError && (
        <div
          style={{
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'color-mix(in oklab, #b3402c 10%, var(--card))',
            border: '1px solid color-mix(in oklab, #b3402c 30%, transparent)',
            fontSize: 12,
            fontWeight: 600,
            color: '#7a2418',
          }}
        >
          {uploadError}
        </div>
      )}

      {photos.length > 0 && (
        <div style={{ fontSize: 10.5, color: 'var(--ink-soft)', marginTop: 4 }}>
          Indicative evidence — {photos.length} photo{photos.length === 1 ? '' : 's'}
        </div>
      )}

      {/* Analyzing… spinner */}
      {analyzing && (
        <div
          style={{
            marginTop: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'color-mix(in oklab, var(--euc) 10%, var(--card))',
            border: '1px solid color-mix(in oklab, var(--euc-deep) 18%, transparent)',
            fontSize: 12,
            fontWeight: 600,
            color: 'var(--euc-deep)',
          }}
        >
          <span className="ec-spin" style={{ display: 'inline-flex' }}>
            <Glyph name="refresh" size={14} />
          </span>
          Analyzing vegetation…
        </div>
      )}

      {/* Analysis failed */}
      {analysisFailed && !sectorEvidence?.combined_classification && (
        <div
          style={{
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'color-mix(in oklab, #b3402c 10%, var(--card))',
            border: '1px solid color-mix(in oklab, #b3402c 30%, transparent)',
            fontSize: 12,
            fontWeight: 600,
            color: '#7a2418',
          }}
        >
          Analysis could not complete — photo kept, map rating unchanged.
        </div>
      )}

      {/* AI proposal (shown after analysis completes) */}
      {sectorEvidence?.combined_classification && (
        <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 6 }}>
          {(sectorEvidence.review_flags || []).includes('uncertain_vegetation') ? (
            <>
              AI proposal: <strong style={{ color: 'var(--ink)' }}>could not read this photo confidently</strong>
              {' '}— treated as <strong style={{ color: 'var(--ink)' }}>{sectorEvidence.combined_classification}</strong> (worst case, for safety)
            </>
          ) : (
            <>
              AI proposal: <strong style={{ color: 'var(--ink)' }}>{sectorEvidence.combined_classification}</strong>
              {sectorEvidence.combined_confidence != null && (
                <span> ({Math.round(sectorEvidence.combined_confidence * 100)}% conf)</span>
              )}
            </>
          )}
          {sectorEvidence.combined_reasoning && (
            <div style={{ marginTop: 2, fontStyle: 'italic', color: 'var(--ink-soft)' }}>
              “{sectorEvidence.combined_reasoning}”
            </div>
          )}
        </div>
      )}

      {/* Reconciled result */}
      {recon && (
        <div
          style={{
            marginTop: 6,
            padding: '6px 10px',
            borderRadius: 8,
            background: RECON_COLORS[recon.tone]?.bg || RECON_COLORS.info.bg,
            border: `1px solid ${RECON_COLORS[recon.tone]?.border || RECON_COLORS.info.border}`,
            fontSize: 12,
            fontWeight: 600,
            color: RECON_COLORS[recon.tone]?.color || RECON_COLORS.info.color,
          }}
        >
          {recon.text}
          {sectorEvidence?.final_bal && sectorEvidence.final_bal !== 'review_required_unassessable' && (
            <span style={{ marginLeft: 6 }}>
              <BalChip rating={sectorEvidence.final_bal} />
            </span>
          )}
        </div>
      )}

      {/* Review flag badges */}
      {(sectorEvidence?.review_flags || []).length > 0 && (
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
          {sectorEvidence.review_flags.map((flag) => (
            <span
              key={flag}
              style={{
                padding: '1px 6px',
                borderRadius: 5,
                background: 'color-mix(in oklab, var(--ochre) 18%, transparent)',
                color: 'var(--ochre)',
                fontSize: 10,
                fontWeight: 700,
              }}
            >
              {flag.replace(/_/g, ' ')}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

// Per-side override: vegetation class (raise-only on consumer - see backend
// reconcile_sector_bal) plus distance + slope (full self-report, no guard -
// matches the point-mode "adjust the inputs" page). Persists on change and
// includes a Reset control (Part B) that clears back to photos/draft.
function SectorOverrideControl({ caseId, compassSide, sectorEvidence, onEvidenceUpdate }) {
  const existing = sectorEvidence?.overrides
  const [vegClass, setVegClass] = useState(existing?.vegetation_class ?? '')
  const [distance, setDistance] = useState(existing?.distance_m ?? '')
  const [slopeDir, setSlopeDir] = useState(existing?.slope_direction ?? '')
  const [slopeDeg, setSlopeDeg] = useState(
    existing?.slope_direction === 'downslope' ? existing?.effective_slope_degrees ?? '' : ''
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const saveTimer = useRef(null)

  // Resync local fields when the server state changes underneath us (e.g.
  // after a reload/resume) - but not while the user is actively editing.
  useEffect(() => {
    const ov = sectorEvidence?.overrides
    setVegClass(ov?.vegetation_class ?? '')
    setDistance(ov?.distance_m ?? '')
    setSlopeDir(ov?.slope_direction ?? '')
    setSlopeDeg(ov?.slope_direction === 'downslope' ? ov?.effective_slope_degrees ?? '' : '')
  }, [sectorEvidence?.overrides])

  function scheduleSave(fields) {
    setError(null)
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      setSaving(true)
      try {
        const result = await setSectorOverride(caseId, compassSide, fields)
        onEvidenceUpdate?.(compassSide, {
          overrides: result.overrides,
          final_bal: result.final_bal,
          review_flags: result.review_flags,
        })
      } catch (err) {
        setError(err.message || 'Could not save override.')
      }
      setSaving(false)
    }, 400)
  }

  function handleVegChange(e) {
    const value = e.target.value
    setVegClass(value)
    scheduleSave({ vegetation_class: value || null })
  }

  function handleDistanceChange(e) {
    const value = e.target.value
    setDistance(value)
    if (value === '') return
    const num = Number(value)
    if (!Number.isNaN(num)) scheduleSave({ distance_m: num })
  }

  function handleSlopeDirChange(e) {
    const dir = e.target.value
    setSlopeDir(dir)
    if (!dir) return
    if (dir === 'downslope') {
      // Wait for a degree value before saving - 0 degrees downslope is a
      // real input, but an empty box shouldn't save yet.
      if (slopeDeg !== '') scheduleSave({ slope_direction: dir, effective_slope_degrees: Number(slopeDeg) })
    } else {
      // Upslope/flat both band as 0 degrees under AS 3959.
      scheduleSave({ slope_direction: dir, effective_slope_degrees: 0 })
    }
  }

  function handleSlopeDegChange(e) {
    const value = e.target.value
    setSlopeDeg(value)
    if (value === '' || slopeDir !== 'downslope') return
    const num = Number(value)
    if (!Number.isNaN(num)) scheduleSave({ slope_direction: 'downslope', effective_slope_degrees: num })
  }

  async function handleReset() {
    setSaving(true)
    setError(null)
    try {
      const result = await clearSectorOverride(caseId, compassSide)
      setVegClass('')
      setDistance('')
      setSlopeDir('')
      setSlopeDeg('')
      onEvidenceUpdate?.(compassSide, {
        overrides: result.overrides,
        final_bal: result.final_bal,
        review_flags: result.review_flags,
      })
    } catch (err) {
      setError(err.message || 'Could not reset this side.')
    }
    setSaving(false)
  }

  const hasOverride = Boolean(existing?.vegetation_class || existing?.distance_m != null || existing?.effective_slope_degrees != null)

  // Disclosure: the override controls are collapsed by default. Start EXPANDED
  // only if this side already carries an active (non-default) override at mount,
  // so an applied override is never hidden behind a collapsed toggle (derived
  // from hasOverride, not a hardcoded false). Turning the toggle OFF only hides
  // the controls — it does NOT clear the override (that's the explicit "Reset to
  // default" action, step 5). So collapsing leaves the applied override and its
  // BAL effect byte-identical.
  const [open, setOpen] = useState(hasOverride)

  return (
    <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px dashed var(--line)' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: open ? 6 : 0 }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-expanded={open}
          style={{
            display: 'flex', alignItems: 'center', gap: 6,
            background: 'none', border: 'none', padding: 0, cursor: 'pointer',
          }}
        >
          <Glyph
            name="chevronRight"
            size={14}
            style={{ color: 'var(--ink-soft)', transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s ease' }}
          />
          <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--ink-soft)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Override this side
          </span>
          {/* Safety: if collapsed while an override is active, never leave it
              invisible — flag it so the user keeps track of the non-default state. */}
          {!open && hasOverride && (
            <span style={{
              padding: '1px 6px', borderRadius: 5,
              background: 'color-mix(in oklab, var(--ochre) 18%, transparent)',
              color: 'var(--ochre)', fontSize: 10, fontWeight: 700,
            }}>
              Active
            </span>
          )}
        </button>
        {open && hasOverride && (
          <button
            type="button"
            onClick={handleReset}
            disabled={saving}
            style={{
              fontSize: 11, fontWeight: 700, color: 'var(--euc-deep)',
              background: 'none', border: 'none', cursor: saving ? 'wait' : 'pointer', padding: 0,
            }}
          >
            Reset to default
          </button>
        )}
      </div>

      {open && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 6 }}>
            <div>
              <label style={{ fontSize: 10.5, color: 'var(--ink-soft)', display: 'block', marginBottom: 2 }}>Vegetation</label>
              <select style={fieldStyle} value={vegClass} onChange={handleVegChange} disabled={saving}>
                <option value="">Use AI / map</option>
                {VEG_OVERRIDE_OPTIONS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
            </div>
            <div>
              <label style={{ fontSize: 10.5, color: 'var(--ink-soft)', display: 'block', marginBottom: 2 }}>Distance (m)</label>
              <input
                type="number"
                min="0"
                style={fieldStyle}
                placeholder="Use map"
                value={distance}
                onChange={handleDistanceChange}
                disabled={saving}
              />
            </div>
          </div>

          <div style={{ marginTop: 6 }}>
            <label style={{ fontSize: 10.5, color: 'var(--ink-soft)', display: 'block', marginBottom: 2 }}>
              Slope toward the vegetation
            </label>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <select
                style={{ ...fieldStyle, flex: 1.6 }}
                value={slopeDir}
                onChange={handleSlopeDirChange}
                disabled={saving}
              >
                <option value="">Use map</option>
                <option value="downslope">Downslope — bush below you</option>
                <option value="upslope">Upslope — bush above you</option>
                <option value="flat">Flat</option>
              </select>
              <input
                type="number"
                min="0"
                max="45"
                style={{ ...fieldStyle, flex: 1, opacity: slopeDir === 'downslope' ? 1 : 0.5 }}
                placeholder="deg"
                value={slopeDeg}
                disabled={saving || slopeDir !== 'downslope'}
                onChange={handleSlopeDegChange}
              />
              <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>°</span>
            </div>
          </div>

          {error && (
            <div style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: '#7a2418' }}>
              {error}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function DraftSummaryCard({ summary, onHover }) {
  const row = summary.representative
  const tone = balToneColor(row.bal)

  return (
    <div
      onMouseEnter={() => onHover?.(summary.side)}
      onMouseLeave={() => onHover?.(null)}
      style={{
        padding: '8px 12px',
        borderRadius: 10,
        border: '1px solid var(--line)',
        background: 'var(--card)',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        flexWrap: 'wrap',
      }}
    >
      <span
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          minWidth: 44,
          padding: '2px 8px',
          borderRadius: 99,
          background: `color-mix(in oklab, ${tone} 16%, transparent)`,
          color: tone,
          fontSize: 12,
          fontWeight: 800,
        }}
      >
        {summary.side}
      </span>
      <span style={{ fontSize: 13, color: 'var(--ink)', fontWeight: 600 }}>
        {row.hasHazard ? row.vegetationClass : 'No hazard'}
      </span>
      {row.hasHazard && (
        <span style={{ fontSize: 12, color: 'var(--ink-soft)' }}>
          {row.distanceM} m · {row.slopeDegrees}° slope
        </span>
      )}
      <BalChip rating={row.bal} />
      {summary.isGoverningSide && (
        <span
          style={{
            padding: '1px 6px',
            borderRadius: 5,
            background: 'color-mix(in oklab, var(--ember, #7A1F1F) 18%, transparent)',
            color: '#7A1F1F',
            fontSize: 10,
            fontWeight: 800,
            textTransform: 'uppercase',
          }}
        >
          Governs
        </span>
      )}
    </div>
  )
}

function EvidenceCard({ summary, onHover, caseId, sectorEvidence, onEvidenceUpdate }) {
  const row = summary.representative
  const tone = balToneColor(row.bal)
  const governing = summary.isGoverningSide
  const hasFlags = (sectorEvidence?.review_flags || []).length > 0

  return (
    <div
      onMouseEnter={() => onHover?.(summary.side)}
      onMouseLeave={() => onHover?.(null)}
      style={{
        padding: 12,
        borderRadius: 14,
        border: governing
          ? '1.5px solid color-mix(in oklab, var(--ember, #7A1F1F) 55%, transparent)'
          : '1px solid var(--line)',
        background: governing
          ? 'color-mix(in oklab, var(--ember, #7A1F1F) 6%, var(--card))'
          : 'var(--card)',
        cursor: 'default',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 52,
            padding: '3px 9px',
            borderRadius: 99,
            background: `color-mix(in oklab, ${tone} 16%, transparent)`,
            color: tone,
            fontSize: 12.5,
            fontWeight: 800,
          }}
        >
          {summary.side}
        </span>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--ink)' }}>
          {row.hasHazard ? row.vegetationClass : 'No hazardous vegetation'}
        </span>
        {hasFlags && (
          <span title="Needs review" style={{ color: 'var(--ochre)', display: 'inline-flex' }}>
            <Glyph name="warn" size={15} />
          </span>
        )}
      </div>

      {caseId && (
        <>
          <SectorPhotos
            caseId={caseId}
            compassSide={summary.side}
            sectorEvidence={sectorEvidence}
            onEvidenceUpdate={onEvidenceUpdate}
          />
          <SectorOverrideControl
            caseId={caseId}
            compassSide={summary.side}
            sectorEvidence={sectorEvidence}
            onEvidenceUpdate={onEvidenceUpdate}
          />
        </>
      )}
    </div>
  )
}

// Page-level "Reset to default" control: a text button that opens the shared
// ConfirmModal (danger) and, on confirm, runs the parent's resetAllEvidence
// (which reuses the step-1 per-side delete path). Owns only its own modal-open
// state, so it has no early-return hooks issue. Returning onReset's promise from
// the confirm handler lets the modal show its pending state while deletes run.
function ResetEvidenceControl({ onReset }) {
  const [confirmOpen, setConfirmOpen] = useState(false)

  async function handleConfirm() {
    await onReset()
    setConfirmOpen(false)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirmOpen(true)}
        style={{
          fontSize: 11, fontWeight: 700, color: 'var(--euc-deep)',
          background: 'none', border: 'none', cursor: 'pointer', padding: 0,
        }}
      >
        Reset to default
      </button>
      <ConfirmModal
        isOpen={confirmOpen}
        tone="danger"
        title="Reset to default?"
        message="This removes every photo you've added on all sides and returns the boundary to the map draft rating. This can't be undone."
        confirmLabel="Reset"
        cancelLabel="Cancel"
        onConfirm={handleConfirm}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  )
}

export default function BoundaryResultPanel({
  result,
  onHoverSide,
  caseId = null,
  sectorEvidence = null,
  variant = 'summary',
  // The CURRENT case headline ({ bal_rating, governing_direction }) — the same
  // authoritative value the Console shows. The panel displays this (not the
  // immutable boundary_assessment draft) and keeps it live as sides are updated.
  caseHeadline = null,
  // Optional action rendered INSIDE the card, below the headline (e.g. the
  // main-page "View" button). Keeps the action visually part of the result card.
  action = null,
}) {
  // Reset nonce: bumped by the page-level "Reset to default" to remount the
  // per-side EvidenceCards once after all photos are cleared, so SectorPhotos
  // re-seeds from the now-empty evidence (its resync effect ignores empties).
  // Declared BEFORE the early return so it adds no new rules-of-hooks finding;
  // the existing post-return hooks remain the known pre-existing issue.
  const [resetNonce, setResetNonce] = useState(0)
  // Live current headline, updated from every override/photo/reset response
  // (which now carry bal_rating). Declared BEFORE the early return (like
  // resetNonce) so it adds no new rules-of-hooks finding.
  const [headline, setHeadline] = useState(null)

  if (!result) return null

  const [localEvidence, setLocalEvidence] = useState(sectorEvidence)
  useEffect(() => { setLocalEvidence(sectorEvidence) }, [sectorEvidence])

  const draftBal = result.bal_rating
  const currentBal = headline?.bal_rating || caseHeadline?.bal_rating || draftBal
  const currentGoverning = headline?.governing_direction || caseHeadline?.governing_direction || result.governing_direction
  const overridden = currentBal !== draftBal

  const summaries = buildSideSummaries(result)
  const tone = balToneColor(currentBal)
  const eyebrow = variant === 'summary' ? '3' : null
  const evidenceBySide = {}
  if (localEvidence) {
    for (const ev of localEvidence) evidenceBySide[ev.compass_side] = ev
  }

  const handleEvidenceUpdate = useCallback((compassSide, uploadResult) => {
    // Every override / reset / delete / poll response now carries the CURRENT
    // case headline — adopt it so the overall BAL stays in sync (raise OR lower).
    if (uploadResult && 'bal_rating' in uploadResult && uploadResult.bal_rating) {
      setHeadline({
        bal_rating: uploadResult.bal_rating,
        governing_direction: uploadResult.governing_direction,
      })
    }
    setLocalEvidence(prev => {
      if (!prev) return prev
      return prev.map(ev =>
        ev.compass_side === compassSide
          ? {
              ...ev,
              photos: uploadResult.photos || ev.photos,
              // Use presence checks (not ??) — null is a valid "cleared" value
              // for all photo-derived fields (e.g. after last photo deleted).
              combined_classification: 'combined_classification' in uploadResult ? uploadResult.combined_classification : ev.combined_classification,
              combined_confidence: 'combined_confidence' in uploadResult ? uploadResult.combined_confidence : ev.combined_confidence,
              combined_reasoning: 'combined_reasoning' in uploadResult ? uploadResult.combined_reasoning : ev.combined_reasoning,
              review_flags: uploadResult.review_flags ?? ev.review_flags,
              final_bal: 'final_bal' in uploadResult ? uploadResult.final_bal : ev.final_bal,
              analysis_status: 'analysis_status' in uploadResult ? uploadResult.analysis_status : ev.analysis_status,
              overrides: 'overrides' in uploadResult ? uploadResult.overrides : ev.overrides,
            }
          : ev
      )
    })
  }, [])

  // Something to reset only if at least one side currently has photos.
  const hasAnyPhotos = Boolean(localEvidence?.some((ev) => (ev.photos || []).length > 0))

  // Page-level reset: delete every photo on every side via the SAME step-1
  // path (deleteSectorPhoto), applying each side's reverted evidence through
  // handleEvidenceUpdate. The backend reverts a side to the GIS draft as its
  // last photo is removed, so the end-state is identical to manually deleting
  // each photo — no stale AI proposal, no raised BAL. Per-side overrides are
  // NOT touched (that's the separate per-side "Reset to default"). Bumps the
  // reset nonce so the cards remount and re-seed from the cleared evidence.
  async function resetAllEvidence() {
    if (!caseId || !localEvidence) return
    try {
      for (const ev of localEvidence) {
        for (const photo of ev.photos || []) {
          const id = photo.photo_id
          if (!id) continue
          const updated = await deleteSectorPhoto(caseId, ev.compass_side, id)
          handleEvidenceUpdate(ev.compass_side, updated)
        }
      }
    } finally {
      // Remount the cards even on partial failure so the UI matches whatever
      // the backend now holds; any remaining photos can be reset again.
      setResetNonce((n) => n + 1)
    }
  }

  return (
    <ECCard>
      {/* Section 1: Define your site */}
      <ECEyebrow n={eyebrow}>Define your site</ECEyebrow>
      <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
        Boundary drawn — per-side draft from the map.
      </p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 20 }}>
        {summaries.map((summary) => (
          <DraftSummaryCard
            key={summary.side}
            summary={summary}
            onHover={onHoverSide}
          />
        ))}
      </div>

      {/* Section 2: Add evidence (per side) */}
      {caseId && (
        <>
          <ECEyebrow>Add evidence (per side)</ECEyebrow>
          <p style={{ margin: '0 0 10px', fontSize: 13, lineHeight: 1.5, color: 'var(--ink-soft)' }}>
            Upload photos of the vegetation on each side. The AI compares your photos with the map
            and adjusts the rating if the evidence shows a greater hazard.
          </p>
          {/* Page-level reset — clears all photos on every side, reverting to
              the GIS draft. Shown only when there's something to reset. */}
          {hasAnyPhotos && (
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 10 }}>
              <ResetEvidenceControl onReset={resetAllEvidence} />
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
            {summaries.map((summary) => (
              <EvidenceCard
                key={`${summary.side}-${resetNonce}`}
                summary={summary}
                onHover={onHoverSide}
                caseId={caseId}
                sectorEvidence={evidenceBySide[summary.side]}
                onEvidenceUpdate={handleEvidenceUpdate}
              />
            ))}
          </div>
        </>
      )}

      {/* Headline BAL */}
      <div
        style={{
          padding: '16px 18px',
          borderRadius: 16,
          border: `1.5px solid color-mix(in oklab, ${tone} 45%, transparent)`,
          background: `color-mix(in oklab, ${tone} 8%, var(--card))`,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
          <span
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 40,
              letterSpacing: '-0.01em',
              color: tone,
            }}
          >
            {currentBal}
          </span>
          <span style={{ fontSize: 13.5, color: 'var(--ink-soft)' }}>
            governed by{' '}
            <strong style={{ color: 'var(--ink)' }}>{currentGoverning}</strong>
          </span>
        </div>
        {overridden && (
          <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-soft)' }}>
            Current indicative assessment ·{' '}
            <span style={{ textDecoration: 'line-through' }}>original draft {draftBal}</span>{' '}
            (kept for audit)
          </div>
        )}
        <p style={{ margin: '6px 0 0', fontSize: 14, lineHeight: 1.5, color: 'var(--ink)' }}>
          {balDescription(currentBal)}
        </p>

        <div
          style={{
            marginTop: 10,
            padding: '6px 12px',
            borderRadius: 8,
            background: 'color-mix(in oklab, var(--ochre) 12%, transparent)',
            border: '1px solid color-mix(in oklab, var(--ochre) 30%, transparent)',
            fontSize: 11.5,
            fontWeight: 700,
            color: 'var(--ochre)',
            textAlign: 'center',
            letterSpacing: '0.02em',
          }}
        >
          PRELIMINARY — screening only, indicative, not certified
        </div>
      </div>

      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </ECCard>
  )
}

// Inline assessor override editor (CONSOLE-F3) — SHARED by the Workspace evidence
// panel and the Photo review cards so there is exactly one implementation. It
// expands in place (NOT a modal), is pre-filled from the side's current effective
// values, and submits ONLY the fields the assessor changed plus the mandatory
// reason. No BAL is computed here — the backend validates, reconciles and returns
// the refreshed sector + headline.
import { useState } from 'react'
import { CBtn } from './atoms'

// Option sets mirror the backend's accepted values (ALLOWED_OVERRIDE_CLASSES /
// ALLOWED_SLOPE_DIRECTIONS / ALLOWED_FDI). No BAL logic here.
export const VEG_OPTIONS = ['Forest', 'Woodland', 'Shrubland', 'Scrub', 'Mallee/Heath', 'Rainforest', 'Grassland', 'Excluded']
export const SLOPE_DIR_OPTIONS = ['downslope', 'upslope', 'flat']
export const FDI_OPTIONS = [50, 80, 100]

// The vegetation actually governing now: assessor override > photo-combined > GIS
// draft. The backend also returns this as `effective_classification`; kept here as
// a tiny helper the two callers share.
export function effectiveVeg(s) {
  return s.effective_classification || s.overrides?.vegetation_class || s.combined_classification || s.gis_draft_classification
}

// True when an assessor override layer exists on this side (any field set) — gates
// the "Remove override" affordance and the override row in the decision chain.
export function hasAssessorOverride(s) {
  const o = s.overrides
  return !!o && (
    o.vegetation_class != null ||
    o.distance_m != null ||
    o.effective_slope_degrees != null ||
    o.slope_direction != null ||
    o.fire_danger_index != null
  )
}

const EDIT_LABEL = { fontSize: 10.5, fontWeight: 800, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-soft)', marginBottom: 4 }
const EDIT_FIELD = {
  width: '100%',
  boxSizing: 'border-box',
  minHeight: 32,
  padding: '5px 9px',
  borderRadius: 8,
  border: '1px solid color-mix(in oklab, var(--ink) 22%, transparent)',
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontFamily: 'var(--font-ui)',
  fontSize: 12.5,
}

export function OverrideEditor({ sector, saving, error, onCancel, onSave }) {
  const init = {
    vegetation_class: effectiveVeg(sector) || '',
    distance_m: sector.distance_m != null ? String(sector.distance_m) : '',
    effective_slope_degrees: sector.effective_slope_degrees != null ? String(sector.effective_slope_degrees) : '',
    slope_direction: sector.slope_direction || '',
    fire_danger_index: String(sector.overrides?.fire_danger_index || 100),
  }
  const [form, setForm] = useState(init)
  const [reason, setReason] = useState('')

  // Only changed fields go to the backend ("Only changed fields are submitted").
  const changed = {}
  if (form.vegetation_class && form.vegetation_class !== init.vegetation_class) changed.vegetation_class = form.vegetation_class
  if (form.distance_m !== '' && form.distance_m !== init.distance_m) changed.distance_m = Number(form.distance_m)
  if (form.effective_slope_degrees !== '' && form.effective_slope_degrees !== init.effective_slope_degrees) changed.effective_slope_degrees = Number(form.effective_slope_degrees)
  if (form.slope_direction && form.slope_direction !== init.slope_direction) changed.slope_direction = form.slope_direction
  if (form.fire_danger_index !== init.fire_danger_index) changed.fire_danger_index = Number(form.fire_danger_index)

  const hasChange = Object.keys(changed).length > 0
  const reasonOk = reason.trim().length > 0
  const canSave = hasChange && reasonOk && !saving

  const set = (field, value) => setForm((f) => ({ ...f, [field]: value }))

  return (
    <div style={{ marginTop: 10, padding: '12px 13px', borderRadius: 10, border: '1px solid color-mix(in oklab, var(--ink) 16%, transparent)', background: 'color-mix(in oklab, var(--euc-deep) 5%, transparent)' }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--ink)', marginBottom: 10 }}>
        Override {sector.compass_side} elevation
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 10 }}>
        <div>
          <div style={EDIT_LABEL}>Vegetation class</div>
          <select style={EDIT_FIELD} value={form.vegetation_class} onChange={(e) => set('vegetation_class', e.target.value)} disabled={saving}>
            <option value="">— no mapped hazard —</option>
            {VEG_OPTIONS.map((v) => <option key={v} value={v}>{v}</option>)}
          </select>
        </div>
        <div>
          <div style={EDIT_LABEL}>Separation distance (m)</div>
          <input type="number" min="0" step="1" style={EDIT_FIELD} value={form.distance_m} onChange={(e) => set('distance_m', e.target.value)} disabled={saving} />
        </div>
        <div>
          <div style={EDIT_LABEL}>Effective slope (°)</div>
          <input type="number" min="0" max="90" step="1" style={EDIT_FIELD} value={form.effective_slope_degrees} onChange={(e) => set('effective_slope_degrees', e.target.value)} disabled={saving} />
        </div>
        <div>
          <div style={EDIT_LABEL}>Slope direction</div>
          <select style={EDIT_FIELD} value={form.slope_direction} onChange={(e) => set('slope_direction', e.target.value)} disabled={saving}>
            <option value="">—</option>
            {SLOPE_DIR_OPTIONS.map((d) => <option key={d} value={d}>{d}</option>)}
          </select>
        </div>
        <div>
          <div style={EDIT_LABEL}>Fire danger index</div>
          <select style={EDIT_FIELD} value={form.fire_danger_index} onChange={(e) => set('fire_danger_index', e.target.value)} disabled={saving}>
            {FDI_OPTIONS.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={EDIT_LABEL}>Reason {hasChange ? <span style={{ color: '#93431F' }}>· required</span> : null}</div>
        <textarea
          rows={2}
          style={{ ...EDIT_FIELD, minHeight: 48, resize: 'vertical', lineHeight: 1.45 }}
          placeholder="Why are you changing this value? (recorded in the audit trail)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          disabled={saving}
        />
      </div>

      {error ? (
        <div style={{ marginBottom: 10, padding: '7px 10px', borderRadius: 8, background: 'color-mix(in oklab, #B06F3A 12%, transparent)', color: '#93431F', fontSize: 11.5, fontWeight: 600 }}>
          {error}
        </div>
      ) : null}

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{ fontSize: 11, color: 'var(--ink-soft)' }}>
          {!hasChange ? 'Change a value to override.' : !reasonOk ? 'A reason is required.' : 'Ready to save.'}
        </span>
        <div style={{ display: 'flex', gap: 6 }}>
          <CBtn variant="quiet" onClick={onCancel} disabled={saving} style={{ minHeight: 28, fontSize: 11.5 }}>Cancel</CBtn>
          <CBtn variant="primary" onClick={() => onSave(changed, reason.trim())} disabled={!canSave} style={{ minHeight: 28, fontSize: 11.5 }}>
            {saving ? 'Saving…' : 'Save override'}
          </CBtn>
        </div>
      </div>
    </div>
  )
}

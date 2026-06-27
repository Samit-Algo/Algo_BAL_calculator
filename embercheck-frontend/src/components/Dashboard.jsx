// "My Properties" dashboard (Phase 1, Step 5b-ii). Lists the logged-in user's
// saved cases as cards; clicking one resumes it in the results view. Login is
// implied — it's the user's own cases (the auth'd GET /cases drives it).

import { useEffect, useState } from 'react'
import { deleteCase, listCases, getCaseReportURL } from '../lib/cases'
import { balColor } from '../lib/bal'
import ECButton from './ui/ECButton'
import ConfirmModal from './ui/ConfirmModal'
import Glyph from './ui/Glyph'
import StatusPill from './ui/StatusPill'

function formatDate(value) {
  if (!value) return ''
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function BalChip({ rating }) {
  if (!rating) return null
  const color = balColor(rating)
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '3px 10px',
        borderRadius: 8,
        background: `color-mix(in oklab, ${color} 18%, transparent)`,
        color,
        fontSize: 13,
        fontWeight: 800,
        whiteSpace: 'nowrap',
      }}
    >
      {rating}
    </span>
  )
}

function CaseCard({ case_, onOpen, onDelete }) {
  // The card itself is the (large) open button; the delete control is a sibling
  // overlay (a button can't be nested inside another button). It sits in the
  // bottom-right corner, clear of the "Updated …" text on the left.
  const [downloading, setDownloading] = useState(false)

  async function handleDownload(e) {
    e.stopPropagation()
    if (downloading) return
    setDownloading(true)
    try {
      const url = await getCaseReportURL(case_.id)
      if (url) {
        window.open(url, '_blank', 'noopener')
        setTimeout(() => URL.revokeObjectURL(url), 60000)
      }
    } finally {
      setDownloading(false)
    }
  }

  return (
    <div>
      <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="ec-press"
        onClick={() => onOpen(case_.id)}
        style={{
          display: 'block',
          width: '100%',
          textAlign: 'left',
          cursor: 'pointer',
          background: 'var(--card)',
          border: '1px solid var(--line)',
          borderRadius: 18,
          padding: 18,
          boxShadow: '0 4px 16px rgba(40,36,24,0.06)',
          fontFamily: 'var(--font-ui)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
          <BalChip rating={case_.bal_rating} />
          <StatusPill status={case_.status} />
        </div>
        <div
          style={{
            fontFamily: 'var(--font-display)',
            fontWeight: 700,
            fontSize: 17,
            lineHeight: 1.25,
            color: 'var(--ink)',
            marginBottom: 8,
            textWrap: 'pretty',
          }}
        >
          {case_.address}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--ink-soft)' }}>
          <span style={{ display: 'inline-flex', color: 'var(--euc-deep)' }}>
            <Glyph name="locate" size={15} />
          </span>
          <span>
            {case_.governing_vegetation || 'No hazardous vegetation'}
            {case_.governing_direction ? ` · ${case_.governing_direction}` : ''}
          </span>
        </div>
        <div style={{ marginTop: 10, fontSize: 12, color: 'var(--ink-soft)' }}>
          Updated {formatDate(case_.updated_at)}
        </div>

        {/* Assessor review request (CONSOLE-B3.2), read-only — the consumer sees
            why the assessor needs more from them. Shown whenever a reason is set. */}
        {case_.review_reason && (
          <div
            style={{
              marginTop: 12,
              padding: '10px 12px',
              borderRadius: 12,
              background: 'color-mix(in oklab, var(--ochre) 12%, transparent)',
              border: '1px solid color-mix(in oklab, var(--ochre) 28%, var(--line))',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 700, color: '#7a5418', marginBottom: 4 }}>
              <Glyph name="info" size={14} />
              {case_.status === 'NEEDS_MORE_PHOTOS'
                ? 'Additional photos requested'
                : case_.status === 'SITE_VISIT_REQUIRED'
                  ? 'On-site inspection required'
                  : case_.status === 'REFERRED_SPECIALIST'
                    ? 'Referred for specialist review'
                    : 'Assessor note'}
            </div>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--ink)' }}>{case_.review_reason}</div>
            {(case_.photo_request_sides || []).length > 0 && (
              <div style={{ fontSize: 12, color: 'var(--ink-soft)', marginTop: 5 }}>
                Please re-photograph: <strong style={{ color: 'var(--ink)' }}>{case_.photo_request_sides.join(', ')}</strong>
              </div>
            )}
          </div>
        )}
      </button>

      <button
        type="button"
        className="ec-tip"
        data-tip="Delete property"
        aria-label={`Delete ${case_.address}`}
        onClick={(e) => {
          e.stopPropagation()
          onDelete(case_)
        }}
        style={{
          position: 'absolute',
          bottom: 12,
          right: 12,
          width: 30,
          height: 30,
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: 0,
          borderRadius: 8,
          border: '1px solid color-mix(in oklab, #b3402c 28%, var(--line))',
          background: 'var(--card)',
          color: 'color-mix(in oklab, #b3402c 70%, transparent)',
          cursor: 'pointer',
        }}
      >
        <Glyph name="trash" size={16} />
      </button>
      </div>

      {/* Signed determination (P0): the consumer can download the issued PDF.
          A sibling of the open-button so the download click is its own control. */}
      {case_.signed && (
        <div
          style={{
            margin: '0 0 6px',
            padding: '10px 12px',
            borderRadius: 12,
            background: 'color-mix(in oklab, var(--euc-deep) 8%, transparent)',
            border: '1px solid color-mix(in oklab, var(--euc-deep) 22%, var(--line))',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 10,
            flexWrap: 'wrap',
          }}
        >
          <div style={{ minWidth: 0, fontSize: 12, color: 'var(--ink-soft)', lineHeight: 1.4 }}>
            <div style={{ fontWeight: 700, color: 'var(--euc-deep)', display: 'flex', alignItems: 'center', gap: 6 }}>
              <Glyph name="check" size={14} /> Signed determination
            </div>
            {case_.signoff?.assessor_name ? `By ${case_.signoff.assessor_name}` : 'Issued'}
            {case_.signoff?.signed_at ? ` · ${formatDate(case_.signoff.signed_at)}` : ''}
          </div>
          <ECButton variant="secondary" small icon="doc" onClick={handleDownload} disabled={downloading}>
            {downloading ? 'Opening…' : 'Download report'}
          </ECButton>
        </div>
      )}
    </div>
  )
}

export default function Dashboard({ onOpenCase, onNewAssessment, onCaseDeleted }) {
  const [cases, setCases] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)
  // The property pending delete-confirmation, or null. Drives the ConfirmModal.
  const [pendingDelete, setPendingDelete] = useState(null)

  // Confirmed delete: DELETE the case, then drop it from the list on success
  // (optimistic-after-success — no refetch). Returning the promise lets the
  // ConfirmModal show its pending state; a rejection surfaces in the modal and
  // the row stays. Tell the parent so it can clear a now-dangling active session.
  async function handleConfirmDelete() {
    const target = pendingDelete
    if (!target) return
    await deleteCase(target.id)
    setCases((prev) => (prev ? prev.filter((c) => c.id !== target.id) : prev))
    onCaseDeleted?.(target.id)
    setPendingDelete(null)
  }

  useEffect(() => {
    let cancelled = false
    async function load() {
      try {
        const data = await listCases()
        if (!cancelled) {
          setCases(data)
          setError(null)
        }
      } catch (err) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }
    load()
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  return (
    <div style={{ width: '100%', maxWidth: 1180, margin: '0 auto', padding: '12px 24px 64px', boxSizing: 'border-box' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 22, flexWrap: 'wrap' }}>
        <div>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 'clamp(26px, 4vw, 34px)',
              lineHeight: 1.1,
              color: 'var(--ink)',
              margin: 0,
            }}
          >
            My Properties
          </h1>
          <p style={{ margin: '6px 0 0', fontSize: 14.5, color: 'var(--ink-soft)' }}>
            Your saved assessments — resume one to add photos or review the read.
          </p>
        </div>
        {/* Only alongside the list — the empty state has its own "Check a block"
            CTA, so showing this here too would be a redundant second button. */}
        {cases && cases.length > 0 && (
          <ECButton small icon="search" onClick={onNewAssessment}>
            New assessment
          </ECButton>
        )}
      </div>

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '40px 0', color: 'var(--ink-soft)', justifyContent: 'center' }}>
          <span className="ec-spin" aria-hidden="true" style={{ color: 'var(--euc-deep)' }}>
            <Glyph name="refresh" size={22} />
          </span>
          Loading your properties…
        </div>
      ) : error ? (
        <div
          style={{
            padding: '16px',
            borderRadius: 14,
            background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
            border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
            color: '#7a2418',
            fontSize: 14,
            fontWeight: 600,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            flexWrap: 'wrap',
          }}
        >
          {error}
          <ECButton small variant="ochre" icon="refresh" onClick={() => { setLoading(true); setReloadKey((k) => k + 1) }}>
            Try again
          </ECButton>
        </div>
      ) : cases && cases.length > 0 ? (
        <div
          style={{
            display: 'grid',
            gap: 16,
            gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
          }}
        >
          {cases.map((c) => (
            <CaseCard key={c.id} case_={c} onOpen={onOpenCase} onDelete={setPendingDelete} />
          ))}
        </div>
      ) : (
        /* empty state */
        <div
          style={{
            textAlign: 'center',
            padding: '56px 24px',
            border: '1.5px dashed var(--line)',
            borderRadius: 20,
            background: 'color-mix(in oklab, var(--card) 70%, transparent)',
          }}
        >
          <div style={{ display: 'inline-flex', color: 'var(--euc-deep)', marginBottom: 12 }}>
            <Glyph name="search" size={30} />
          </div>
          <div
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 22,
              color: 'var(--ink)',
              marginBottom: 6,
            }}
          >
            No assessments yet
          </div>
          <p style={{ margin: '0 auto 20px', fontSize: 14.5, color: 'var(--ink-soft)', maxWidth: 360, lineHeight: 1.5 }}>
            Check a block to get started — your saved assessments will show up here.
          </p>
          <ECButton icon="arrowRight" onClick={onNewAssessment}>
            Check a block
          </ECButton>
        </div>
      )}

      <ConfirmModal
        isOpen={pendingDelete != null}
        tone="danger"
        title="Delete this property?"
        message={
          pendingDelete
            ? `This permanently removes “${pendingDelete.address}” and any photos you've added. This can't be undone.`
            : ''
        }
        confirmLabel="Delete"
        cancelLabel="Cancel"
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}

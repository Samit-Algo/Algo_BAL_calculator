import { useState, useEffect, useRef } from 'react'
import { suggest } from '../lib/api'
import Glyph from './ui/Glyph'
import ECButton from './ui/ECButton'
import Reveal from './ui/Reveal'

const MIN_CHARS = 3
const DEBOUNCE_MS = 300

// The entry screen — a full-height column: wordmark, headline, the search field
// (no inline button), a "use my location" affordance, and the primary CTA
// pinned near the bottom. Mirrors the reference EntryScreen, web-centric.
export default function EntryHero({ onAssess, loading, error }) {
  const [value, setValue] = useState('')
  const [suggestions, setSuggestions] = useState([])
  const [open, setOpen] = useState(false)
  const [focused, setFocused] = useState(false)
  const [locating, setLocating] = useState(false)
  const [locateError, setLocateError] = useState(null)
  const justSelected = useRef(false)

  const ready = value.trim().length > 4

  useEffect(() => {
    if (justSelected.current) {
      justSelected.current = false
      return
    }
    const query = value.trim()
    const timer = setTimeout(
      async () => {
        if (query.length < MIN_CHARS) {
          setSuggestions([])
          setOpen(false)
          return
        }
        const results = await suggest(query)
        setSuggestions(results)
        setOpen(results.length > 0)
      },
      query.length < MIN_CHARS ? 0 : DEBOUNCE_MS,
    )
    return () => clearTimeout(timer)
  }, [value])

  function submit(e) {
    e?.preventDefault()
    const trimmed = value.trim()
    if (trimmed && ready && !loading) {
      setOpen(false)
      onAssess(trimmed)
    }
  }

  function pick(addr) {
    justSelected.current = true
    setValue(addr)
    setSuggestions([])
    setOpen(false)
  }

  // Real geolocation → reverse-geocode (OSM Nominatim, same data as our tiles)
  // → assess that address. Falls back to a typed-address hint on any failure.
  function useLocation() {
    setLocateError(null)
    if (!navigator.geolocation) {
      setLocateError('Location isn’t available here — type the address instead.')
      return
    }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const { latitude, longitude } = pos.coords
          const res = await fetch(
            `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${latitude}&lon=${longitude}`,
          )
          const data = await res.json()
          const addr = data?.display_name
          if (!addr) throw new Error('no address')
          setValue(addr)
          onAssess(addr)
        } catch {
          setLocateError('Couldn’t resolve your location — type the address instead.')
        } finally {
          setLocating(false)
        }
      },
      () => {
        setLocating(false)
        setLocateError('Location permission denied — type the address instead.')
      },
      { enableHighAccuracy: true, timeout: 10000 },
    )
  }

  return (
    <div
      style={{
        width: '100%',
        maxWidth: 460,
        display: 'flex',
        flexDirection: 'column',
        boxSizing: 'border-box',
      }}
    >
        <Reveal delay={120}>
          <h1
            style={{
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 'clamp(40px, 9vw, 48px)',
              lineHeight: 1.06,
              letterSpacing: '-0.015em',
              color: 'var(--ink)',
              margin: '0 0 14px',
              textWrap: 'pretty',
            }}
          >
            Standing on a block?
          </h1>
        </Reveal>

        <Reveal delay={320}>
          <p
            style={{
              fontSize: 17,
              lineHeight: 1.5,
              color: 'var(--ink-soft)',
              margin: '0 0 28px',
              maxWidth: 360,
              textWrap: 'pretty',
            }}
          >
            Find out what bushfire-prone mapping really means for any NSW address — the rating, the
            reasons, and the map behind it.
          </p>
        </Reveal>

        <Reveal delay={440}>
          <form onSubmit={submit} style={{ position: 'relative' }}>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '0 18px',
                minHeight: 60,
                borderRadius: 18,
                background: 'var(--card)',
                border: focused
                  ? '2px solid var(--euc-deep)'
                  : '2px solid color-mix(in oklab, var(--ink) 16%, transparent)',
                boxShadow: '0 8px 24px rgba(40,36,24,0.10)',
                transition: 'border-color .2s ease',
              }}
            >
              <span style={{ color: 'var(--euc-deep)', display: 'flex', flexShrink: 0 }}>
                <Glyph name="search" />
              </span>
              <input
                value={value}
                autoComplete="off"
                onChange={(e) => setValue(e.target.value)}
                onFocus={() => {
                  setFocused(true)
                  if (suggestions.length > 0) setOpen(true)
                }}
                onBlur={() => {
                  setFocused(false)
                  setTimeout(() => setOpen(false), 160)
                }}
                placeholder="Address or lot number"
                style={{
                  flex: 1,
                  border: 'none',
                  outline: 'none',
                  background: 'transparent',
                  fontFamily: 'var(--font-ui)',
                  fontSize: 16.5,
                  color: 'var(--ink)',
                  minWidth: 0,
                }}
              />
              {value && (
                <button
                  type="button"
                  className="ec-press"
                  onClick={() => setValue('')}
                  aria-label="Clear"
                  style={{
                    border: 'none',
                    background: 'color-mix(in oklab, var(--ink) 9%, transparent)',
                    color: 'var(--ink-soft)',
                    width: 26,
                    height: 26,
                    borderRadius: 99,
                    cursor: 'pointer',
                    fontSize: 14,
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                >
                  ×
                </button>
              )}
            </div>

            {open && suggestions.length > 0 && (
              <div
                style={{
                  position: 'absolute',
                  top: 'calc(100% + 8px)',
                  left: 0,
                  right: 0,
                  zIndex: 20,
                  background: 'var(--card)',
                  borderRadius: 16,
                  overflow: 'hidden',
                  border: '1px solid var(--line)',
                  boxShadow: '0 16px 40px rgba(40,36,24,0.18)',
                }}
              >
                {suggestions.map((a, i) => (
                  <button
                    key={a}
                    type="button"
                    className="ec-press"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      pick(a)
                    }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 12,
                      width: '100%',
                      textAlign: 'left',
                      padding: '14px 16px',
                      border: 'none',
                      cursor: 'pointer',
                      background: 'transparent',
                      borderTop: i ? '1px solid var(--line)' : 'none',
                      fontFamily: 'var(--font-ui)',
                      fontSize: 15,
                      color: 'var(--ink)',
                    }}
                  >
                    <span style={{ color: 'var(--ochre)', display: 'flex', flexShrink: 0 }}>
                      <Glyph name="locate" size={18} />
                    </span>
                    {a}
                  </button>
                ))}
              </div>
            )}
          </form>
        </Reveal>

        <Reveal delay={540}>
          <button
            type="button"
            className="ec-press"
            onClick={useLocation}
            disabled={locating || loading}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 10,
              width: '100%',
              minHeight: 50,
              marginTop: 12,
              borderRadius: 16,
              border: '1.5px dashed color-mix(in oklab, var(--ink) 30%, transparent)',
              background: 'transparent',
              cursor: locating ? 'default' : 'pointer',
              fontFamily: 'var(--font-ui)',
              fontSize: 15.5,
              fontWeight: 600,
              color: 'var(--euc-deep)',
              opacity: locating || loading ? 0.6 : 1,
            }}
          >
            <Glyph name="locate" size={19} />
            {locating ? 'Finding you…' : "I'm on the block — use my location"}
          </button>
        </Reveal>

        {(locateError || error) && (
          <Reveal delay={80}>
            <div
              style={{
                marginTop: 12,
                padding: '11px 14px',
                borderRadius: 12,
                background: 'color-mix(in oklab, #b3402c 12%, var(--card))',
                border: '1px solid color-mix(in oklab, #b3402c 35%, transparent)',
                color: '#7a2418',
                fontSize: 13.5,
                fontWeight: 600,
              }}
            >
              {locateError || error}
            </div>
          </Reveal>
        )}

        <Reveal delay={560}>
          <ECButton
            full
            disabled={!ready || loading}
            onClick={submit}
            icon="arrowRight"
            style={{ marginTop: 18 }}
          >
            {loading ? 'Checking…' : 'Check this block'}
          </ECButton>
        </Reveal>

        <Reveal delay={640}>
          <p
            style={{
              margin: '14px 4px 0',
              fontSize: 12.5,
              lineHeight: 1.5,
              color: 'var(--ink-soft)',
              textAlign: 'center',
              textWrap: 'pretty',
            }}
          >
            Screening only — not a certified assessment. A formal BAL assessment by an accredited
            consultant is required for development applications.
          </p>
        </Reveal>
    </div>
  )
}

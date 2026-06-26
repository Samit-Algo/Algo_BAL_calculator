// Tiny stroke glyphs — lifted verbatim from the mockup's shared design layer
// (embercheck/shared.jsx → Glyph). Only the icons the worklist + chrome use are
// kept here; the path data is unchanged so they render identically.
export function Glyph({ name, size = 20, stroke = 1.8, style }) {
  const p = {
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: stroke,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  }
  const body = {
    chevronLeft: <path d="M14.5 5 L8 12 L14.5 19" {...p} />,
    chevronRight: <path d="M9.5 5 L16 12 L9.5 19" {...p} />,
    search: (
      <g {...p}>
        <circle cx="10.5" cy="10.5" r="5.5" />
        <path d="M14.8 14.8 L19.5 19.5" />
      </g>
    ),
    check: <path d="M5 12.5 L10 17.5 L19 6.5" {...p} />,
    camera: (
      <g {...p}>
        <rect x="3.5" y="7" width="17" height="12" rx="2.5" />
        <circle cx="12" cy="13" r="3.4" />
        <path d="M8.5 7 L10 4.5 h4 L15.5 7" />
      </g>
    ),
    doc: (
      <g {...p}>
        <rect x="5.5" y="3.5" width="13" height="17" rx="2" />
        <path d="M9 9h6 M9 12.5h6 M9 16h4" />
      </g>
    ),
    info: (
      <g {...p}>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M12 11v5.5" />
        <circle cx="12" cy="7.6" r="1.1" fill="currentColor" stroke="none" />
      </g>
    ),
    refresh: (
      <g {...p}>
        <path d="M19 12 a7 7 0 1 1 -2.2 -5.1" />
        <path d="M19 3.5 V7 h-3.5" />
      </g>
    ),
    arrowRight: (
      <g {...p}>
        <path d="M4.5 12h15" />
        <path d="M14 6.5 L19.5 12 L14 17.5" />
      </g>
    ),
    share: (
      <g {...p}>
        <path d="M12 14.5 V4 M8.5 7.5 L12 4 L15.5 7.5" />
        <path d="M6 11.5 H5.5 a1.5 1.5 0 0 0 -1.5 1.5 v5.5 a1.5 1.5 0 0 0 1.5 1.5 h13 a1.5 1.5 0 0 0 1.5 -1.5 v-5.5 a1.5 1.5 0 0 0 -1.5 -1.5 H18" />
      </g>
    ),
  }[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      {body}
    </svg>
  )
}

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
    // Section-header glyphs for the profile page (additive; same stroke style as
    // the originals so they sit consistently in the design system).
    badge: (
      <g {...p}>
        <path d="M12 3.5 5 6.2v5c0 4.2 3 7 7 9.3 4-2.3 7-5.1 7-9.3v-5L12 3.5Z" />
        <path d="M9 11.5l2.2 2.2 4-4.3" />
      </g>
    ),
    pin: (
      <g {...p}>
        <path d="M12 21s6-5.3 6-10.5a6 6 0 1 0-12 0C6 15.7 12 21 12 21Z" />
        <circle cx="12" cy="10.5" r="2.3" />
      </g>
    ),
    briefcase: (
      <g {...p}>
        <rect x="3.5" y="7.5" width="17" height="12" rx="2" />
        <path d="M8.5 7.5V6a2 2 0 0 1 2-2h3a2 2 0 0 1 2 2v1.5" />
        <path d="M3.5 12.5h17" />
      </g>
    ),
    shield: (
      <g {...p}>
        <path d="M12 3.5 5 6.2v5c0 4.2 3 7 7 9.3 4-2.3 7-5.1 7-9.3v-5L12 3.5Z" />
      </g>
    ),
    phone: (
      <g {...p}>
        <path d="M6.5 4h2.8l1.4 3.6-2 1.4a11 11 0 0 0 4.8 4.8l1.4-2 3.6 1.4V17a2 2 0 0 1-2.1 2A14.5 14.5 0 0 1 4.5 6.1 2 2 0 0 1 6.5 4Z" />
      </g>
    ),
    pencil: (
      <g {...p}>
        <path d="M4 20h4L18.5 9.5a2 2 0 0 0 0-2.8l-1.2-1.2a2 2 0 0 0-2.8 0L4 16v4Z" />
        <path d="M13.3 6.7l4 4" />
      </g>
    ),
    image: (
      <g {...p}>
        <rect x="3.5" y="5" width="17" height="14" rx="2" />
        <circle cx="8.8" cy="10" r="1.6" />
        <path d="M4 17l4.5-4 3.5 3 3-2.5 5 4" />
      </g>
    ),
  }[name]
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={style} aria-hidden="true">
      {body}
    </svg>
  )
}

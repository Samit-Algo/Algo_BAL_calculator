import Glyph from './Glyph'

// The EmberCheck button. Variants: primary (forest), secondary (outline),
// ghost (text), ochre. Ported from the reference design.
export default function ECButton({
  variant = 'primary',
  children,
  onClick,
  disabled,
  full,
  icon,
  iconRight,
  style,
  small,
  type = 'button',
}) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    width: full ? '100%' : undefined,
    minHeight: small ? 44 : 54,
    padding: small ? '0 18px' : '0 24px',
    borderRadius: 16,
    fontFamily: 'var(--font-ui)',
    fontSize: small ? 15 : 16.5,
    fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    border: '1.5px solid transparent',
    opacity: disabled ? 0.45 : 1,
    WebkitTapHighlightColor: 'transparent',
    boxSizing: 'border-box',
  }
  const variants = {
    primary: {
      background: 'var(--euc-deep)',
      color: 'var(--paper)',
      boxShadow: '0 6px 18px color-mix(in oklab, var(--euc-deep) 32%, transparent)',
    },
    secondary: {
      background: 'transparent',
      color: 'var(--ink)',
      border: '1.5px solid color-mix(in oklab, var(--ink) 28%, transparent)',
    },
    ghost: { background: 'transparent', color: 'var(--euc-deep)', minHeight: 44 },
    ochre: {
      background: 'var(--ochre)',
      color: '#241A0C',
      boxShadow: '0 6px 18px color-mix(in oklab, var(--ochre) 35%, transparent)',
    },
  }
  return (
    <button
      type={type}
      className="ec-press"
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant], ...style }}
    >
      {icon ? <Glyph name={icon} size={small ? 18 : 20} /> : null}
      <span>{children}</span>
      {iconRight ? <Glyph name={iconRight} size={small ? 18 : 20} /> : null}
    </button>
  )
}

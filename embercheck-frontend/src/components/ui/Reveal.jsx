import { useEffect, useRef, useState } from 'react'
import { useEcLive } from '../../lib/ecLive'

// Scroll-reveal wrapper: fades + lifts content into view on first paint.
// Ported from the reference design.
export default function Reveal({ delay = 0, y = 16, children, style }) {
  const live = useEcLive()
  const ref = useRef(null)
  const [on, setOn] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let io
    try {
      io = new IntersectionObserver(
        ([e]) => {
          if (e.isIntersecting) {
            setOn(true)
            io.disconnect()
          }
        },
        { threshold: 0.12 },
      )
      io.observe(el)
    } catch {
      /* no IntersectionObserver — fall back to the timer below */
    }
    const t1 = setTimeout(() => setOn(true), delay + 1100)
    return () => {
      if (io) io.disconnect()
      clearTimeout(t1)
    }
  }, [delay])
  const hidden = live && !on
  return (
    <div
      ref={ref}
      style={{
        opacity: hidden ? 0 : 1,
        transform: hidden ? `translateY(${y}px)` : 'none',
        transition: `opacity .65s ease ${delay}ms, transform .65s cubic-bezier(.22,.7,.25,1) ${delay}ms`,
        ...style,
      }}
    >
      {children}
    </div>
  )
}

// Tiny matchMedia hook — mirrors the consumer app's responsive approach so the
// Console can collapse its desktop cockpit to a single phone-friendly column.
// Default breakpoint 820px: below it we stack panes and swap the worklist table
// for cards.
import { useEffect, useState } from 'react'

export function useIsMobile(maxWidth = 820) {
  const query = `(max-width: ${maxWidth}px)`
  const [isMobile, setIsMobile] = useState(() =>
    typeof window === 'undefined' ? false : window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setIsMobile(e.matches)
    mq.addEventListener('change', onChange)
    setIsMobile(mq.matches)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return isMobile
}

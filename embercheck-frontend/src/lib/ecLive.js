import { useEffect, useState } from 'react'

// Entrance animations only play once the page proves it's painting (two rAF
// ticks). In static/capture contexts everything renders in its final state.
let liveFlag = false
const liveCbs = []
if (typeof requestAnimationFrame !== 'undefined') {
  requestAnimationFrame(() =>
    requestAnimationFrame(() => {
      liveFlag = true
      liveCbs.slice().forEach((cb) => cb())
    }),
  )
}

export function useEcLive() {
  const [live, setLive] = useState(liveFlag)
  useEffect(() => {
    // Already initialised from liveFlag; nothing to subscribe to if it's set.
    if (liveFlag) return
    const cb = () => setLive(true)
    liveCbs.push(cb)
    return () => {
      const i = liveCbs.indexOf(cb)
      if (i >= 0) liveCbs.splice(i, 1)
    }
  }, [])
  return live
}

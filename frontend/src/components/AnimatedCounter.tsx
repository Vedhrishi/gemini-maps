import { useEffect, useRef, useState } from 'react'

/**
 * Counts from the previous value to the next one over `duration` ms.
 * Skips the animation when the viewer prefers reduced motion.
 */
export function AnimatedCounter({
  value,
  duration = 600,
  format = (n: number) => String(Math.round(n)),
  style,
}: {
  value: number
  duration?: number
  format?: (n: number) => string
  style?: React.CSSProperties
}) {
  const [display, setDisplay] = useState(value)
  const fromRef = useRef(value)
  const rafRef = useRef(0)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const from = fromRef.current
    const to = value

    if (reduced || from === to) {
      fromRef.current = to
      setDisplay(to)
      return
    }

    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min((now - start) / duration, 1)
      // easeOutCubic
      const eased = 1 - Math.pow(1 - t, 3)
      setDisplay(from + (to - from) * eased)
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick)
      } else {
        fromRef.current = to
      }
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(rafRef.current)
  }, [value, duration])

  return <span style={style}>{format(display)}</span>
}

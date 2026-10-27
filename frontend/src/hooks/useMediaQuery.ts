import { useEffect, useState } from 'react'

/**
 * Reactive media query. Replaces direct window.innerWidth reads, which are
 * sampled once at render and never update when the window resizes or a phone
 * rotates — leaving the layout stuck in whichever mode it booted in.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' ? window.matchMedia(query).matches : false
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = (e: MediaQueryListEvent) => setMatches(e.matches)
    setMatches(mql.matches)
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}

export const useIsDesktop = () => useMediaQuery('(min-width: 769px)')

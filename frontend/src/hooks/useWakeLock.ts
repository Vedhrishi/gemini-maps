import { useEffect } from 'react'

/** Keep the screen on while `active` (e.g. during a trip). Re-acquires after the tab returns. */
export function useWakeLock(active: boolean) {
  useEffect(() => {
    if (!active || !('wakeLock' in navigator)) return
    let lock: WakeLockSentinel | null = null
    let dead = false
    const get = () => {
      navigator.wakeLock.request('screen').then(l => { if (dead) l.release(); else lock = l }).catch(() => {})
    }
    const vis = () => { if (document.visibilityState === 'visible') get() }
    get()
    document.addEventListener('visibilitychange', vis)
    return () => { dead = true; document.removeEventListener('visibilitychange', vis); lock?.release().catch(() => {}) }
  }, [active])
}

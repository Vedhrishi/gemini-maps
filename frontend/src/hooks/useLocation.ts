import { useCallback, useEffect, useRef, useState } from 'react'

export interface Fix {
  lat: number
  lng: number
  /** metres */
  accuracy: number
  /** degrees clockwise from north, when moving */
  heading: number | null
  /** km/h, when the device reports it */
  kmh: number | null
  ts: number
}

export interface ManualLoc { name: string; lat: number; lng: number }
const MKEY = 'gm-manual-loc'
function loadManual(): ManualLoc | null {
  try { const v = JSON.parse(localStorage.getItem(MKEY) || 'null'); return v && typeof v.lat === 'number' ? v : null } catch { return null }
}

const LKEY = 'gm-last-loc'
/** Where the user was last seen (this device), so the map can open there before GPS answers. */
export function lastKnown(): { lat: number; lng: number } | null {
  try { const v = JSON.parse(localStorage.getItem(LKEY) || 'null'); return v && typeof v.lat === 'number' ? v : null } catch { return null }
}
function saveLast(lat: number, lng: number) {
  try { localStorage.setItem(LKEY, JSON.stringify({ lat, lng })) } catch { /* storage unavailable */ }
}

export type LocStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable'

/**
 * Continuous device location. Starts on mount (the browser asks once), keeps
 * following the user, and exposes request() so a button can re-ask — on iPhone a
 * permission prompt is only reliable from a tap.
 */
export function useLocation() {
  const [gps, setFix] = useState<Fix | null>(null)
  const [manual, setManualState] = useState<ManualLoc | null>(loadManual)
  const [status, setStatus] = useState<LocStatus>('idle')
  const watch = useRef<number | null>(null)

  const start = useCallback(() => {
    if (!('geolocation' in navigator)) { setStatus('unavailable'); return }
    if (watch.current != null) return
    setStatus(s => (s === 'granted' ? s : 'locating'))
    watch.current = navigator.geolocation.watchPosition(
      p => {
        setStatus('granted')
        saveLast(p.coords.latitude, p.coords.longitude)
        setFix({
          lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy,
          heading: p.coords.heading != null && !Number.isNaN(p.coords.heading) ? p.coords.heading : null,
          kmh: p.coords.speed != null && p.coords.speed >= 0 ? p.coords.speed * 3.6 : null,
          ts: p.timestamp,
        })
      },
      err => {
        if (err.code === err.PERMISSION_DENIED) {
          setStatus('denied')
          if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null }
        } else {
          setStatus(s => (s === 'granted' ? s : 'locating')) // timeout / signal lost: keep trying
        }
      },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    )
  }, [])

  const request = useCallback(() => {
    if (watch.current != null) { navigator.geolocation.clearWatch(watch.current); watch.current = null }
    start()
  }, [start])

  useEffect(() => {
    start()
    return () => { if (watch.current != null) navigator.geolocation.clearWatch(watch.current) }
  }, [start])

  /** Pin "my location" somewhere else (a place the user chose); null goes back to the device GPS. */
  const setManual = useCallback((m: ManualLoc | null) => {
    setManualState(m)
    if (m) saveLast(m.lat, m.lng)
    try { m ? localStorage.setItem(MKEY, JSON.stringify(m)) : localStorage.removeItem(MKEY) } catch { /* storage unavailable */ }
    if (!m) request()
  }, [request])

  const fix: Fix | null = manual
    ? { lat: manual.lat, lng: manual.lng, accuracy: 0, heading: null, kmh: null, ts: Date.now() }
    : gps
  return { fix, gps, manual, setManual, status, request }
}

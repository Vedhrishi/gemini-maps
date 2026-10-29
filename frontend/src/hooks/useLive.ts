import { useCallback, useEffect, useRef, useState } from 'react'
import {
  LiveMember, LiveSession, liveJoin, livePing, liveWatch, liveLeave, saveSession, loadSession, saveName,
} from '../lib/live'

interface Position { lat: number; lng: number; heading: number | null; kmh: number | null }

/**
 * Keeps a live group going: sends your position every few seconds (when you chose to share it)
 * and returns where everyone is. The server drops anyone silent for 15 minutes.
 */
export function useLive(pos: Position | null, trip: { dest: string | null; etaMin: number | null }) {
  const [session, setSession] = useState<LiveSession | null>(() => loadSession())
  const [members, setMembers] = useState<LiveMember[]>([])
  const [sharing, setSharing] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const posRef = useRef(pos); posRef.current = pos
  const tripRef = useRef(trip); tripRef.current = trip
  const sharingRef = useRef(sharing); sharingRef.current = sharing
  const failures = useRef(0)

  const end = useCallback((why?: string) => {
    setSession(null); setMembers([]); saveSession(null)
    if (why) setError(why)
  }, [])

  const enter = useCallback(async (room: string, name: string) => {
    setBusy(true); setError(null)
    try {
      const n = name.trim().slice(0, 20) || 'Friend'
      saveName(n)
      const { session: s, members: m } = await liveJoin(room, n)
      saveSession(s); setSession(s); setMembers(m); failures.current = 0
      return s
    } catch (e: any) {
      setError(e?.message || 'Could not start live sharing.')
      return null
    } finally { setBusy(false) }
  }, [])

  const leave = useCallback(async () => {
    const s = session
    end()
    if (s) await liveLeave(s)
  }, [session, end])

  useEffect(() => {
    if (!session) return
    let stop = false
    let timer: number | undefined
    const tick = async () => {
      if (stop) return
      const p = posRef.current
      try {
        const list = sharingRef.current && p
          ? await livePing(session, {
              lat: p.lat, lng: p.lng, speed: p.kmh, heading: p.heading,
              dest: tripRef.current.dest, eta: tripRef.current.etaMin,
            })
          : await liveWatch(session)
        if (stop) return
        failures.current = 0
        setMembers(list)
      } catch (e: any) {
        if (stop) return
        if (e?.status === 404) { end('This live group has ended. Start or join another.'); return }
        failures.current++       // a bad signal for a moment is normal: keep trying quietly
      }
      const moving = (posRef.current?.kmh ?? 0) > 5
      timer = window.setTimeout(tick, failures.current ? 8000 : moving ? 3000 : 5000)
    }
    tick()
    return () => { stop = true; window.clearTimeout(timer) }
  }, [session, end])

  // the first ping as soon as a fix arrives, without waiting for the timer
  const sentFirst = useRef(false)
  useEffect(() => {
    if (!session) { sentFirst.current = false; return }
    if (pos && sharing && !sentFirst.current) {
      sentFirst.current = true
      livePing(session, { lat: pos.lat, lng: pos.lng, speed: pos.kmh, heading: pos.heading }).then(setMembers).catch(() => {})
    }
  }, [session, pos, sharing])

  return { session, members, sharing, setSharing, error, setError, busy, start: (name: string) => enter('', name), join: enter, leave }
}

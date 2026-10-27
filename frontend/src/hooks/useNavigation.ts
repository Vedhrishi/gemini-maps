/**
 * useNavigation — plan a route anywhere in India, compare alternatives on
 * time / distance / fuel / road hazards, and drive it (simulated or live GPS)
 * with km left, time left, fuel used and spoken guidance.
 *
 * What sets this apart from a plain maps app: the route ranking knows about
 * the crowd-reported hazards on each candidate road.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HazardReport } from '../lib/api'
import {
  limitAt, paceFactor,
  Place, Route, RouteHazard, LngLat, Step,
  fetchRoutes, statesAlong, hazardsAlong, hazardScore, pointAt, project, fmtKm, fmtDur,
} from '../lib/routing'
import { VEHICLES, FuelEstimate, buildEstimate, fuelUsedAt, Vehicle, hazardMultiplier } from '../lib/fuel'
import { HAZARD_LABELS } from '../lib/mapUtils'
import { withTraffic, fetchLive, LiveSample } from '../lib/traffic'

export interface RouteOption {
  route: Route
  hazards: RouteHazard[]
  score: number
  fuel: FuelEstimate
  tags: string[]
}

type Status = 'idle' | 'planning' | 'ready' | 'trip' | 'arrived' | 'error'

export interface TripState {
  traveled: number
  /** device-reported speed in km/h (live GPS only) */
  gpsKmh?: number
  mode: 'sim' | 'gps'
  speedMul: number
  paused: boolean
  follow: boolean
  offRoute: boolean
}

interface Deps {
  reports: HazardReport[]
  toast: (text: string, type?: 'info' | 'success' | 'warn' | 'danger') => void
  speak: (text: string) => void
}

export function useNavigation({ reports, toast, speak }: Deps) {
  const [status, setStatus] = useState<Status>('idle')
  const [from, setFrom] = useState<Place | null>(null)
  const [to, setTo] = useState<Place | null>(null)
  const [routes, setRoutes] = useState<Route[]>([])
  const [routeStates, setRouteStates] = useState<((string | null)[] | null)[]>([])
  const [selected, setSelected] = useState(0)
  const liveRef = useRef<LiveSample[]>([])
  const [trafficReady, setTrafficReady] = useState(false) // true once the first live-traffic check for this plan has finished
  const routesRef = useRef<Route[]>([])
  const selectedRef = useRef(0)
  const [vehicleId, setVehicleIdRaw] = useState(() => {
    try { return localStorage.getItem('gm-vehicle') || 'hatch' } catch { return 'hatch' }
  })
  const setVehicleId = useCallback((id: string) => {
    setVehicleIdRaw(id)
    try { localStorage.setItem('gm-vehicle', id) } catch { /* private mode */ }
  }, [])
  const [error, setError] = useState<string | null>(null)
  const [trip, setTrip] = useState<TripState | null>(null)
  const [startedAt, setStartedAt] = useState(0)
  const [planId, setPlanId] = useState(0)
  // Guardian agent: watches the road ahead and re-plans on its own
  const [guardian, setGuardian] = useState<'watching' | 'checking'>('watching')
  const [agentLog, setAgentLog] = useState<{ id: number; text: string }[]>([])
  const [carry, setCarry] = useState({ m: 0, sec: 0, cost: 0, litres: 0 })
  const knownHazards = useRef<Set<string>>(new Set())
  // Safe-reroute guards: no flip-flopping, no runaway detours
  const rerouteStats = useRef({ count: 0, last: 0 })
  const rerouting = useRef(false)
  const reportsRef = useRef(reports)
  const vehicleIdRef = useRef('hatch')
  reportsRef.current = reports
  const logId = useRef(0)
  const log = useCallback((text: string) => {
    setAgentLog(l => [{ id: ++logId.current, text }, ...l].slice(0, 6))
  }, [])

  const vehicle: Vehicle = VEHICLES.find(v => v.id === vehicleId) ?? VEHICLES[0]
  vehicleIdRef.current = vehicleId
  const planToken = useRef(0)
  const announced = useRef<Set<string>>(new Set())
  const tripRef = useRef<TripState | null>(null)
  tripRef.current = trip

  // ── Options: routes enriched with hazards, fuel and tags ─────────────────
  const options: RouteOption[] = useMemo(() => {
    const base = routes.map((route, i) => {
      const hazards = hazardsAlong(route, reports)
      const states = routeStates[i] ?? [null]
      return {
        route,
        hazards,
        score: hazardScore(hazards, t => hazardMultiplier(vehicleId, t)),
        fuel: buildEstimate(route.distance, route.duration, states, vehicle),
        tags: [] as string[],
      }
    })
    if (base.length === 0) return base

    const fastest = base.reduce((b, o, i) => (o.route.duration < base[b].route.duration ? i : b), 0)
    base[fastest].tags.push('Fastest')
    const minScore = Math.min(...base.map(o => o.score))
    if (base.length > 1) {
      const safest = base.findIndex(o => o.score === minScore)
      if (base.some(o => o.score > minScore)) base[safest].tags.push('Safest road')
    }
    const cheapest = base.reduce((b, o, i) => (o.fuel.cost < base[b].fuel.cost - 0.5 ? i : b), 0)
    if (base.length > 1 && Math.abs(base[cheapest].fuel.cost - Math.max(...base.map(o => o.fuel.cost))) > 5) {
      base[cheapest].tags.push('Lowest fuel')
    }
    // Gemini pick: every hazard point costs two minutes
    const pick = base.reduce(
      (b, o, i) => (o.route.duration + o.score * 120 < base[b].route.duration + base[b].score * 120 ? i : b), 0)
    base[pick].tags.unshift('Gemini pick')
    return base
  }, [routes, routeStates, reports, vehicle, vehicleId])

  const current = options[selected] ?? null
  const fuelLoading = routes.length > 0 && !routeStates[selected]

  // ── Plan ─────────────────────────────────────────────────────────────────
  const plan = useCallback(async (a: Place, b: Place) => {
    const token = ++planToken.current
    setFrom(a); setTo(b)
    setStatus('planning'); setError(null)
    setTrip(null); setRoutes([]); setRouteStates([]); setSelected(0)
    setCarry({ m: 0, sec: 0, cost: 0, litres: 0 }); setAgentLog([])
    announced.current.clear()
    try {
      const rs = await fetchRoutes([a.lng, a.lat], [b.lng, b.lat])
      if (token !== planToken.current) return
      setRoutes(rs)
      setPlanId(token)
      setRouteStates(rs.map(() => null))
      // Gemini's pick becomes the default selection once hazards are known
      setStatus('ready')
      // State lookups for fuel pricing, one route at a time (gentle on the public geocoder)
      for (let i = 0; i < rs.length; i++) {
        const st = await statesAlong(rs[i])
        if (token !== planToken.current) return
        setRouteStates(prev => { const n = [...prev]; n[i] = st; return n })
      }
    } catch (e: any) {
      if (token !== planToken.current) return
      setStatus('error')
      setError(e?.name === 'AbortError'
        ? 'The routing server took too long. Try again in a moment.'
        : 'No drivable route found between those places.')
    }
  }, [])

  // Preselect the pick as soon as options exist and the user hasn't chosen
  const userChose = useRef(false)
  useEffect(() => {
    if (status !== 'ready' || userChose.current || options.length === 0) return
    const pickIdx = options.findIndex(o => o.tags.includes('Gemini pick'))
    if (pickIdx >= 0 && pickIdx !== selected) setSelected(pickIdx)
  }, [options, status, selected])
  useEffect(() => { if (status === 'planning') userChose.current = false }, [status])

  const choose = useCallback((i: number) => { userChose.current = true; setSelected(i) }, [])

  const clear = useCallback(() => {
    planToken.current++
    setStatus('idle'); setRoutes([]); setRouteStates([]); setTrip(null)
    setCarry({ m: 0, sec: 0, cost: 0, litres: 0 }); setAgentLog([])
    setFrom(null); setTo(null); setError(null)
    window.speechSynthesis?.cancel()
  }, [])

  // ── Trip ─────────────────────────────────────────────────────────────────
  const startTrip = useCallback((mode: 'sim' | 'gps' = 'sim') => {
    if (!current) return
    announced.current.clear()
    rerouteStats.current = { count: 0, last: 0 }
    knownHazards.current = new Set(current.hazards.map(h => h.report.id))
    setCarry({ m: 0, sec: 0, cost: 0, litres: 0 }); setAgentLog([])
    log('Guardian on duty — watching every hazard report along your route')
    setStartedAt(Date.now())
    setTrip({ traveled: 0, mode, speedMul: mode === 'sim' ? 8 : 1, paused: false, follow: true, offRoute: false })
    setStatus('trip')
    const first = current.route.steps[0]
    speak(`Starting navigation to ${to?.name ?? 'your destination'}. ${fmtKm(current.route.distance)}. ${first?.text ?? ''}`)
  }, [current, to, speak, log])

  routesRef.current = routes
  selectedRef.current = selected

  // Traffic keeps moving: while a planned route is on screen, refresh its time every minute
  // (the typical pattern shifts with the clock) and pull measured speeds every 3 minutes when a live feed exists.
  const planned = status === 'ready' && routes.length > 0
  const firstRoute = routes[0]
  useEffect(() => {
    if (!planned) { setTrafficReady(false); return }
    setTrafficReady(false)
    let dead = false
    const recompute = () => setRoutes(rs => rs.map(r => withTraffic(r, Date.now(), liveRef.current)))
    const pullLive = async () => {
      const sel = routesRef.current[selectedRef.current]
      if (!sel) return
      const live = await fetchLive(sel)
      if (dead) return
      liveRef.current = live
      recompute()
      setTrafficReady(true)
    }
    liveRef.current = []
    pullLive()
    const t1 = setInterval(recompute, 60_000)
    const t2 = setInterval(pullLive, 180_000)
    return () => { dead = true; clearInterval(t1); clearInterval(t2) }
  }, [planned, firstRoute?.coords])

  const stopTrip = useCallback(() => {
    setTrip(null)
    setStatus(routes.length ? 'ready' : 'idle')
    window.speechSynthesis?.cancel()
  }, [routes.length])

  const patchTrip = useCallback((p: Partial<TripState>) => setTrip(t => (t ? { ...t, ...p } : t)), [])

  // Simulated drive at the route's own average speed × multiplier
  useEffect(() => {
    if (status !== 'trip' || !trip || trip.mode !== 'sim' || !current) return
    const k = paceFactor(current.route)
    let last = performance.now()
    const id = setInterval(() => {
      const now = performance.now()
      const dt = (now - last) / 1000
      last = now
      setTrip(t => {
        if (!t || t.paused) return t
        return { ...t, traveled: Math.min(current.route.distance, t.traveled + (limitAt(current.route, t.traveled) / 3.6) / k * dt * t.speedMul) }
      })
    }, 200)
    return () => clearInterval(id)
  }, [status, trip?.mode, current])

  // Live GPS: project each fix onto the route; reroute when clearly off it
  useEffect(() => {
    if (status !== 'trip' || !trip || trip.mode !== 'gps' || !current || !navigator.geolocation) return
    let misses = 0
    const id = navigator.geolocation.watchPosition(
      pos => {
        const p: LngLat = [pos.coords.longitude, pos.coords.latitude]
        const { along, offset } = project(current.route, p, tripRef.current?.traveled ?? 0)
        if (offset > 150) {
          misses++
          patchTrip({ offRoute: true })
          if (misses === 3 && to) {
            toast('Off route — finding a new way', 'warn')
            speak('Off route. Recalculating.')
            plan({ name: 'Current location', sub: '', lat: p[1], lng: p[0] }, to)
          }
        } else {
          misses = 0
          patchTrip({ traveled: along, offRoute: false, gpsKmh: pos.coords.speed != null && pos.coords.speed >= 0 ? pos.coords.speed * 3.6 : undefined })
        }
      },
      err => { if (err.code === err.PERMISSION_DENIED) toast('Location is blocked — allow it to navigate, or use Simulate', 'warn') },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 30000 },
    )
    return () => navigator.geolocation.clearWatch(id)
  }, [status, trip?.mode, current, to, plan, patchTrip, toast, speak])

  // ── Derived trip values ─────────────────────────────────────────────────
  const traveled = trip?.traveled ?? 0
  const total = current?.route.distance ?? 0
  const remainingM = Math.max(0, total - traveled)
  const limitKmh = current ? limitAt(current.route, traveled) : 0
  const speedKmh = !current || !trip ? 0 : trip.paused ? 0
    : trip.mode === 'gps' ? (trip.gpsKmh ?? 0)
    : Math.min(limitKmh, limitKmh / paceFactor(current.route))
  // Advised speed when a hazard is close: slower for worse hazards, never above the limit
  const advisedKmh = useMemo(() => {
    if (!current || !trip) return null
    const h = current.hazards.find(x => x.at - traveled > -10 && x.at - traveled < 400)
    if (!h) return null
    const cap = { critical: 20, high: 30, medium: 40, low: 50 }[h.report.severity] ?? 50
    return Math.min(cap, limitAt(current.route, traveled))
  }, [current, trip, traveled])
  const avgSpeed = current ? current.route.distance / Math.max(1, current.route.duration) : 1
  const remainingSec = remainingM / avgSpeed
  const tripPos = useMemo(
    () => (current && trip ? pointAt(current.route, traveled) : null),
    [current, trip, traveled])
  const fuelUsed = useMemo(() => {
    const here = current ? fuelUsedAt(current.fuel, traveled) : { litres: 0, cost: 0 }
    return { litres: here.litres + carry.litres, cost: here.cost + carry.cost }
  }, [current, traveled, carry])
  // Whole-trip figures, including legs driven before any reroute
  const tripTotals = useMemo(() => ({
    km: carry.m + total,
    sec: carry.sec + (current?.route.duration ?? 0),
    cost: carry.cost + (current?.fuel.cost ?? 0),
    litres: carry.litres + (current?.fuel.litres ?? 0),
  }), [carry, total, current])

  const nextStep: (Step & { distanceTo: number }) | null = useMemo(() => {
    if (!current || !trip) return null
    const st = current.route.steps
    for (let i = 0; i < st.length; i++) {
      // the manoeuvre of step i happens at st[i].at; the next one to come is the first still ahead
      if (st[i].at > traveled + 8) return { ...st[i], distanceTo: st[i].at - traveled }
    }
    return null
  }, [current, trip, traveled])

  const ahead = useMemo(
    () => (current && trip ? current.hazards.filter(h => h.at > traveled - 20) : []),
    [current, trip, traveled])

  // ── Guardian agent ───────────────────────────────────────────────────────
  // While you drive it watches for hazards that appear on the road ahead after
  // you set off. If a better road exists it re-plans and switches by itself,
  // telling you why; if not, it warns you and keeps the current route.
  useEffect(() => {
    if (status !== 'trip' || !current || !trip || !to || rerouting.current) return
    const fresh = current.hazards.filter(h => {
      const d = h.at - traveled
      return !knownHazards.current.has(h.report.id)
        && (h.report.severity === 'critical' || h.report.severity === 'high')
        && d > 250 && d < 6000
    })
    if (fresh.length === 0) return

    const hz = fresh[0]
    fresh.forEach(f => knownHazards.current.add(f.report.id))
    rerouting.current = true
    setGuardian('checking')
    const label = (HAZARD_LABELS[hz.report.hazard_type] ?? hz.report.hazard_type).toLowerCase()
    const where = hz.report.address ? ` on ${hz.report.address}` : ''
    const dist = fmtKm(hz.at - traveled)
    toast(`🛡 Guardian: ${hz.report.severity} ${label} ${dist} ahead${where} — checking alternatives`, 'danger')
    speak(`Guardian alert. ${hz.report.severity} ${label} ${dist} ahead. Checking for a better route.`)
    log(`${hz.report.severity} ${label} reported ${dist} ahead${where}`)

    const route = current.route
    const here = pointAt(route, traveled).pos
    const avg = route.distance / Math.max(1, route.duration)
    const stayRemaining = (route.distance - traveled) / avg
    const mult = (t: string) => hazardMultiplier(vehicleIdRef.current, t)
    const stayScore = hazardScore(current.hazards.filter(h => h.at > traveled), mult)
    const stayCost = stayRemaining + stayScore * 120
    const doneSoFar = { m: traveled, sec: traveled / avg, ...fuelUsedAt(current.fuel, traveled) }

    fetchRoutes(here, [to.lng, to.lat]).then(rs => {
      const scored = rs.map((r, i) => {
        const hz2 = hazardsAlong(r, reportsRef.current)
        return { r, i, hz: hz2, cost: r.duration + hazardScore(hz2, mult) * 120 }
      }).sort((a, b) => a.cost - b.cost)
      const best = scored[0]
      if (location.search.includes('debug')) console.log('[guardian]', JSON.stringify({ n: rs.length, stayCost, stayRemaining, stayScore, scored: scored.map(x => ({ d: x.r.duration, hz: x.hz.length, cost: x.cost })) }))
      // ── Safety checks: a reroute only happens if every one of these passes ──
      const now = Date.now()
      const hereHeading = pointAt(route, traveled).heading
      const turn = best ? Math.abs(((pointAt(best.r, 60).heading - hereHeading + 540) % 360) - 180) : 0
      const extra = best ? best.r.duration - stayRemaining : 0
      const bestScore = best ? hazardScore(best.hz, mult) : 0
      let veto: string | null = null
      if (best && best.cost <= stayCost - 45) {
        if (now - rerouteStats.current.last < 90_000) veto = 'just rerouted — holding steady to avoid zig-zagging'
        else if (rerouteStats.current.count >= 3) veto = 'already rerouted 3 times this trip'
        else if (turn > 110) veto = 'the alternative needs a U-turn on the road'
        else if (extra > Math.max(600, stayRemaining * 0.25)) veto = `the safer road adds ${Math.round(extra / 60)} min`
        else if (bestScore >= stayScore) veto = 'the alternative has no fewer hazards'
      }
      if (best && veto) {
        log(`Safety check: staying on route — ${veto}`)
        toast(`🛡 Guardian: keeping your route (${veto}) — slow down ahead`, 'warn')
        speak('Keeping your current route. Slow down ahead.')
        return
      }
      if (!best || best.cost > stayCost - 45) {
        log('No better road found — staying on route, slow down at the hazard')
        toast('🛡 Guardian: no safer road exists — slow down ahead', 'warn')
        speak('No better route available. Slow down ahead.')
        return
      }
      const delta = Math.round((best.r.duration - stayRemaining) / 60)
      const msg = delta > 0 ? `${delta} min longer` : delta < 0 ? `${-delta} min faster` : 'same time'
      knownHazards.current = new Set(best.hz.map(h => h.report.id))
      rerouteStats.current = { count: rerouteStats.current.count + 1, last: Date.now() }
      setCarry(c => ({ m: c.m + doneSoFar.m, sec: c.sec + doneSoFar.sec, cost: c.cost + doneSoFar.cost, litres: c.litres + doneSoFar.litres }))
      userChose.current = true
      announced.current.clear()
      setRoutes(rs)
      setRouteStates(rs.map(() => null))
      setSelected(best.i)
      setPlanId(Date.now())
      setTrip(t => (t ? { ...t, traveled: 0, offRoute: false } : t))
      log(`Rerouted around the ${label}: ${msg}, ${best.hz.length === 0 ? 'no reported hazards' : best.hz.length + ' hazards'}`)
      toast(`🛡 Rerouted around the ${label} — ${msg}`, 'success')
      speak(`Rerouting around the ${label}. New route is ${msg}.`)
      ;(async () => {
        for (let i = 0; i < rs.length; i++) {
          const st = await statesAlong(rs[i])
          setRouteStates(prev => { const n = [...prev]; n[i] = st; return n })
        }
      })()
    }).catch(() => {
      log('Could not reach the routing server — keeping current route')
    }).finally(() => {
      rerouting.current = false
      setGuardian('watching')
    })
  }, [traveled, status, current, trip, to, toast, speak, log])

  // ── Spoken guidance + arrival ────────────────────────────────────────────
  useEffect(() => {
    if (status !== 'trip' || !current || !trip) return
    const quiet = trip.speedMul > 10 // fast-forward demos would turn into spam
    const say = (key: string, text: string, kind: 'info' | 'warn' | 'danger' | 'success' = 'info') => {
      if (announced.current.has(key)) return
      announced.current.add(key)
      toast(text, kind)
      if (!quiet) speak(text)
    }

    if (nextStep && nextStep.distanceTo < 280 && nextStep.kind !== 'arrive') {
      say(`step-${Math.round(nextStep.at)}`, `In ${Math.max(50, Math.round(nextStep.distanceTo / 50) * 50)} metres, ${nextStep.text.charAt(0).toLowerCase()}${nextStep.text.slice(1)}`)
    }
    for (const h of ahead) {
      const d = h.at - traveled
      if (d > 0 && d < 650) {
        const name = HAZARD_LABELS[h.report.hazard_type] ?? h.report.hazard_type
        say(`hz-${h.report.id}`,
          `${h.report.severity === 'critical' ? 'Critical ' : ''}${name.toLowerCase()} ${Math.max(100, Math.round(d / 50) * 50)} metres ahead. ${h.report.suggested_action ?? 'Slow down.'}`,
          h.report.severity === 'critical' || h.report.severity === 'high' ? 'danger' : 'warn')
      }
    }
    if (trip.mode === 'gps' && trip.gpsKmh != null && limitAt(current.route, traveled) > 0) {
      const lim = limitAt(current.route, traveled)
      const bucket = Math.floor(Date.now() / 30000)
      if (trip.gpsKmh > lim * 1.1 + 3) {
        say(`speed-${lim}-${bucket}`, `Speed limit ${lim}. Please slow down.`, 'warn')
      }
    }
    if (remainingM < 25) {
      announced.current.add('arrive')
      setStatus('arrived')
      toast(`Arrived at ${to?.name ?? 'destination'}`, 'success')
      speak(`You have arrived at ${to?.name ?? 'your destination'}. Trip fuel cost about ${Math.round(current.fuel.cost)} rupees.`)
    }
  }, [traveled, status, current, trip, nextStep, ahead, remainingM, speak, toast, to])

  return {
    status, from, to, error, options, selected, current, vehicle, vehicleId, trafficReady,
    fuelLoading, trip, startedAt, planId,
    traveled, total, remainingM, remainingSec, tripPos, fuelUsed, nextStep, ahead,
    guardian, agentLog, tripTotals, limitKmh, speedKmh, advisedKmh,
    plan, choose, clear, setVehicleId, startTrip, stopTrip, patchTrip,
    setStatus,
  }
}

export type Nav = ReturnType<typeof useNavigation>

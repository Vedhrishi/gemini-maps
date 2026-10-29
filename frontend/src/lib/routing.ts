/**
 * Routing, geocoding and route geometry — free, key-less services only:
 *   - OSRM public server  → driving routes with alternatives and turn steps
 *   - Photon (Komoot)     → place search and reverse geocoding on OSM data
 * Both serve CORS, so the browser calls them directly. Everything is wrapped
 * with timeouts so a slow public server degrades the feature, never the app.
 */

import { searchGazetteer } from './gazetteer'
import { API_URL } from './api'
import { searchDetail } from './hyd'
import { searchUserPlaces } from './userPlaces'
import { searchCurated } from './curated'
import { withTraffic } from './traffic'
import { HazardReport } from './api'
import { normaliseState } from './fuel'

export type LngLat = [number, number]

export interface Place {
  name: string
  sub: string
  lat: number
  lng: number
}

export interface Step {
  text: string
  /** metres along the route at which this manoeuvre happens */
  at: number
  /** length of the step in metres */
  length: number
  road: string
  kind: string
}

export interface Route {
  coords: LngLat[]
  /** cumulative distance in metres at each coordinate */
  cum: number[]
  distance: number // m
  /** expected seconds with traffic (typical for this hour, or live) */
  duration: number
  /** seconds on empty roads: the routing engine's own figure */
  freeDuration: number
  traffic?: import('./traffic').TrafficInfo
  steps: Step[]
  /** typical legal limit (km/h) per stretch: `from` metres along the route */
  limits: { from: number; kmh: number }[]
}

async function getJSON<T>(url: string, ms = 12000): Promise<T> {
  const ctl = new AbortController()
  const t = setTimeout(() => ctl.abort(), ms)
  try {
    const r = await fetch(url, { signal: ctl.signal })
    if (!r.ok) throw new Error(`HTTP ${r.status}`)
    return (await r.json()) as T
  } finally {
    clearTimeout(t)
  }
}

// ── Geocoding ─────────────────────────────────────────────────────────────

async function photonSearch(query: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  let url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=8&lang=en`
  if (near) url += `&lat=${near.lat.toFixed(3)}&lon=${near.lng.toFixed(3)}`
  const data = await getJSON<any>(url)
  const seen = new Set<string>()
  const out: Place[] = []
  for (const f of data.features ?? []) {
    const p = f.properties ?? {}
    const [lng, lat] = f.geometry.coordinates
    const name = p.name || p.street || p.city || p.state
    if (!name) continue
    const sub = [p.street && p.name ? p.street : null, p.locality ?? p.district, p.city ?? p.county, p.state]
      .filter(Boolean)
      .filter((v, i, a) => a.indexOf(v) === i && v !== name)
      .join(', ')
    const key = `${name}|${sub}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name, sub, lat, lng })
  }
  return out
}

/** The backend's full India index (every village and hamlet). Optional: ignored if unreachable. */
async function backendSearch(query: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  let url = `${API_URL}/api/places?q=${encodeURIComponent(query)}&limit=8`
  if (near) url += `&lat=${near.lat.toFixed(3)}&lng=${near.lng.toFixed(3)}`
  const data = await getJSON<{ places?: Place[] }>(url, 3500)
  return data.places ?? []
}

/** Nominatim (OSM): a second opinion on streets, shops and landmarks. */
async function nominatimSearch(query: string, near?: { lat: number; lng: number }): Promise<Place[]> {
  let url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=jsonv2&limit=6&addressdetails=1&accept-language=en`
  if (near) url += `&viewbox=${near.lng - 0.5},${near.lat + 0.5},${near.lng + 0.5},${near.lat - 0.5}`
  const data = await getJSON<any[]>(url, 6000)
  return data.map(d => ({
    name: d.name || String(d.display_name).split(',')[0],
    sub: String(d.display_name).split(',').slice(1, 4).join(',').trim(),
    lat: +d.lat, lng: +d.lon,
  }))
}

/** Overpass (OSM): every named shop, office, hostel or building near you whose name starts with the text. */
async function overpassSearch(query: string, near: { lat: number; lng: number }): Promise<Place[]> {
  const re = query.replace(/[^\p{L}\p{N} ]/gu, '').trim().replace(/ +/g, '.*')
  if (re.length < 3) return []
  const body = `[out:json][timeout:8];nwr["name"~"${re}",i](around:12000,${near.lat.toFixed(4)},${near.lng.toFixed(4)});out center 8;`
  const data = await getJSON<{ elements: any[] }>(
    `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(body)}`, 9000)
  return (data.elements ?? []).flatMap((e: any) => {
    const t = e.tags ?? {}
    const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon
    if (!t.name || lat == null) return []
    const sub = [t.amenity || t.shop || t.building || t.tourism, t['addr:street'], t['addr:suburb'] || t['addr:city']]
      .filter(Boolean).join(', ').replace(/_/g, ' ')
    return [{ name: t.name, sub, lat, lng }]
  })
}

const near3km = (a: Place, b: Place) => haversine([a.lng, a.lat], [b.lng, b.lat]) < 3000

/**
 * Place search worldwide. Results arrive in layers: the offline India gazetteer first
 * (instant), then the backend's full India index, then the live OSM geocoder
 * (streets, shops, anywhere on Earth). `onPartial` fires as each layer lands.
 */
export async function searchPlaces(
  q: string, near?: { lat: number; lng: number }, onPartial?: (p: Place[]) => void,
): Promise<Place[]> {
  const query = q.trim()
  if (query.length < 2) return []
  let merged: Place[] = []
  const add = (list: Place[]) => {
    for (const p of list) {
      if (merged.some(m => m.name.toLowerCase() === p.name.toLowerCase() && near3km(m, p))) continue
      merged.push(p)
    }
    merged = merged.slice(0, 12)
    onPartial?.(merged)
  }
  add(searchUserPlaces(query))
  add(searchCurated(query))
  const layers = [
    searchGazetteer(query, near).then(add).catch(() => {}),
    ...(near ? [searchDetail(query, near).then(add).catch(() => {})] : []),
    backendSearch(query, near).then(add).catch(() => {}),
  ]
  let liveErr: unknown = null
  const live = photonSearch(query, near).then(add).catch(e => { liveErr = e })
  // slower second opinions: only worth asking when the faster layers found little
  const extra = new Promise<void>(res => setTimeout(res, 900)).then(async () => {
    if (merged.length >= 4) return
    await Promise.all([
      nominatimSearch(query, near).then(add).catch(() => {}),
      near ? overpassSearch(query, near).then(add).catch(() => {}) : Promise.resolve(),
    ])
  })
  await Promise.all([...layers, live, extra])
  if (merged.length === 0 && liveErr) throw liveErr
  return merged
}

const stateCache = new Map<string, string | null>()
try {
  const raw = localStorage.getItem('gm-state-cache')
  if (raw) Object.entries(JSON.parse(raw)).forEach(([k, v]) => stateCache.set(k, v as string | null))
} catch { /* storage unavailable */ }

function persistStates() {
  try {
    localStorage.setItem('gm-state-cache', JSON.stringify(Object.fromEntries(stateCache)))
  } catch { /* storage unavailable */ }
}

/** Resolve the Indian state / UT for a coordinate (cached on a ~10 km grid). */
export async function reverseState(lat: number, lng: number): Promise<string | null> {
  const key = `${lat.toFixed(1)},${lng.toFixed(1)}`
  if (stateCache.has(key)) return stateCache.get(key) ?? null
  try {
    const data = await getJSON<any>(`https://photon.komoot.io/reverse?lat=${lat.toFixed(4)}&lon=${lng.toFixed(4)}&lang=en`, 9000)
    const props = data.features?.[0]?.properties
    // Outside India there is no state price table: price at the world average
    const st = props?.countrycode && props.countrycode !== 'IN' ? 'world' : normaliseState(props?.state)
    stateCache.set(key, st)
    if (stateCache.size > 600) for (const k of [...stateCache.keys()].slice(0, 100)) stateCache.delete(k) // keep storage small
    persistStates()
    return st
  } catch {
    return null // not cached: a later attempt may succeed
  }
}

// ── Geometry ──────────────────────────────────────────────────────────────

const R = 6371008.8
const rad = (d: number) => (d * Math.PI) / 180

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1])
  const dLng = rad(b[0] - a[0])
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)))
}

export function bearing(a: LngLat, b: LngLat): number {
  const y = Math.sin(rad(b[0] - a[0])) * Math.cos(rad(b[1]))
  const x = Math.cos(rad(a[1])) * Math.sin(rad(b[1])) - Math.sin(rad(a[1])) * Math.cos(rad(b[1])) * Math.cos(rad(b[0] - a[0]))
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}

function cumulative(coords: LngLat[]): number[] {
  const cum = [0]
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]))
  return cum
}

function posAt(route: Route, d: number): LngLat {
  const { coords, cum } = route
  const total = cum[cum.length - 1]
  const dd = Math.max(0, Math.min(total, d))
  let lo = 0
  let hi = cum.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (cum[mid] <= dd) lo = mid
    else hi = mid
  }
  const seg = cum[hi] - cum[lo] || 1
  const f = (dd - cum[lo]) / seg
  const a = coords[lo]
  const b = coords[hi]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}

/** Point and heading at `d` metres along the route. */
export function pointAt(route: Route, d: number): { pos: LngLat; heading: number } {
  const total = route.cum[route.cum.length - 1]
  const pos = posAt(route, d)
  // Heading from a short look-ahead (or look-behind at the very end) so it stays stable on bends
  const ahead = d + 30 <= total ? posAt(route, d + 30) : pos
  const behind = d + 30 <= total ? pos : posAt(route, Math.max(0, d - 30))
  return { pos, heading: bearing(behind, ahead) }
}

/** Distance along the route (m) of the point nearest to `p`, plus how far off it is. */
export function project(route: Route, p: LngLat, hint = 0): { along: number; offset: number } {
  const { coords, cum } = route
  const kx = Math.cos(rad(p[1])) * 111320
  const ky = 110574
  let best = Infinity
  let along = 0
  // Scan the whole line; routes are a few thousand points so this is cheap
  for (let i = 0; i < coords.length - 1; i++) {
    const ax = (coords[i][0] - p[0]) * kx, ay = (coords[i][1] - p[1]) * ky
    const bx = (coords[i + 1][0] - p[0]) * kx, by = (coords[i + 1][1] - p[1]) * ky
    const dx = bx - ax, dy = by - ay
    const len2 = dx * dx + dy * dy
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2))
    const px = ax + t * dx, py = ay + t * dy
    const d2 = px * px + py * py
    // slight preference for staying near the previous position on loops
    const penalty = Math.abs(cum[i] - hint) * 1e-6
    if (d2 + penalty < best) {
      best = d2 + penalty
      along = cum[i] + t * (cum[i + 1] - cum[i])
    }
  }
  return { along, offset: Math.sqrt(Math.max(0, best)) }
}

export interface RouteHazard {
  report: HazardReport
  /** metres along the route */
  at: number
  offset: number
}

const SEV_WEIGHT: Record<string, number> = { critical: 8, high: 4, medium: 2, low: 1 }

/** Hazards within `radius` metres of the route, in travel order. */
export function hazardsAlong(route: Route, reports: HazardReport[], radius = 140): RouteHazard[] {
  const out: RouteHazard[] = []
  for (const r of reports) {
    const { along, offset } = project(route, [r.lng, r.lat])
    if (offset <= radius) out.push({ report: r, at: along, offset })
  }
  return out.sort((a, b) => a.at - b.at)
}

export function hazardScore(list: RouteHazard[], mult?: (hazardType: string) => number): number {
  return list.reduce((s, h) => s + (SEV_WEIGHT[h.report.severity] ?? 1) * (mult ? mult(h.report.hazard_type) : 1), 0)
}

/** 0-100 road-safety score for a route: 100 means nothing reported along it. */
export function safetyScore(score: number): number {
  return Math.max(0, Math.round(100 - Math.min(100, score * 4.5)))
}

// ── Routing ───────────────────────────────────────────────────────────────

const DIR = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west']
const compass = (b: number) => DIR[Math.round(b / 45) % 8]

function instruction(m: any, name: string): { text: string; kind: string } {
  const road = name ? ` onto ${name}` : ''
  const mod: string = m.modifier ?? ''
  const side = mod.includes('left') ? 'left' : mod.includes('right') ? 'right' : ''
  const strength = mod.startsWith('slight') ? 'Bear slightly ' : mod.startsWith('sharp') ? 'Turn sharp ' : 'Turn '
  switch (m.type) {
    case 'depart':
      return { text: `Head ${compass(m.bearing_after ?? 0)}${name ? ' on ' + name : ''}`, kind: 'depart' }
    case 'arrive':
      return { text: 'You have arrived at your destination', kind: 'arrive' }
    case 'roundabout':
    case 'rotary':
    case 'roundabout turn':
      return { text: `At the roundabout, take exit ${m.exit ?? ''}${road}`.replace('exit ,', 'exit'), kind: 'roundabout' }
    case 'merge':
      return { text: `Merge ${side || 'ahead'}${road}`, kind: 'merge' }
    case 'on ramp':
    case 'off ramp':
      return { text: `Take the ramp ${side}${road}`.replace('ramp ', 'ramp '), kind: 'ramp' }
    case 'fork':
      return { text: `Keep ${side || 'straight'} at the fork${road}`, kind: 'fork' }
    case 'end of road':
      return { text: `${strength}${side || 'ahead'} at the end of the road${road}`, kind: 'turn' }
    case 'new name':
    case 'continue':
      return { text: mod === 'straight' || !side ? `Continue${name ? ' on ' + name : ''}` : `${strength}${side}${road}`, kind: 'straight' }
    default:
      return { text: side ? `${strength}${side}${road}` : `Continue${name ? ' on ' + name : ''}`, kind: side ? 'turn' : 'straight' }
  }
}

export async function fetchRoutes(from: LngLat, to: LngLat): Promise<Route[]> {
  const url =
    `https://router.project-osrm.org/route/v1/driving/${from[0].toFixed(6)},${from[1].toFixed(6)}%3B` +
    `${to[0].toFixed(6)},${to[1].toFixed(6)}?overview=full&geometries=geojson&alternatives=3&steps=true&annotations=speed,distance`
  const data = await getJSON<any>(url, 25000)
  if (data.code !== 'Ok' || !data.routes?.length) throw new Error(data.message || 'No route found')

  return data.routes.slice(0, 3).map((r: any): Route => {
    const coords: LngLat[] = r.geometry.coordinates
    const cum = cumulative(coords)
    const steps: Step[] = []
    let at = 0
    for (const leg of r.legs) {
      for (const s of leg.steps) {
        const { text, kind } = instruction(s.maneuver, s.name)
        steps.push({ text, kind, at, length: s.distance, road: s.name || '' })
        at += s.distance
      }
    }
    // Make step offsets agree with the polyline length rather than OSRM's own sum
    const total = cum[cum.length - 1]
    const scale = at > 0 ? total / at : 1
    steps.forEach(s => { s.at *= scale; s.length *= scale })
    return withTraffic({ coords, cum, distance: total, duration: r.duration, freeDuration: r.duration, steps, limits: buildLimits(r.legs, total) })
  })
}

/**
 * Speed limits from OSRM's per-edge speeds. OSRM's car profile uses the posted
 * `maxspeed` where OpenStreetMap has it and a road-class default where it does
 * not, so these are "typical limits", not survey-grade signage. Rounded to the
 * nearest 5 km/h and merged into stretches so the sign doesn't flicker.
 */
function buildLimits(legs: any[], total: number): { from: number; kmh: number }[] {
  const raw: { from: number; kmh: number }[] = []
  let at = 0
  for (const leg of legs) {
    const sp: number[] = leg.annotation?.speed ?? []
    const di: number[] = leg.annotation?.distance ?? []
    for (let i = 0; i < sp.length; i++) {
      const kmh = Math.max(20, Math.min(120, Math.round((sp[i] * 3.6) / 5) * 5))
      raw.push({ from: at, kmh })
      at += di[i] ?? 0
    }
  }
  if (!raw.length) return [{ from: 0, kmh: 50 }]
  const scale = at > 0 ? total / at : 1
  const out: { from: number; kmh: number }[] = []
  for (const r of raw) {
    const f = r.from * scale
    const last = out[out.length - 1]
    if (last && last.kmh === r.kmh) continue
    // ignore blips shorter than 120 m (junction links) — keep the prevailing limit
    if (last && out.length > 1 && f - last.from < 120 && out[out.length - 2].kmh === r.kmh) { out.pop(); continue }
    out.push({ from: f, kmh: r.kmh })
  }
  return out
}

/** Limit (km/h) in force `d` metres along the route. */
export function limitAt(route: Route, d: number): number {
  const l = route.limits
  let lo = 0, hi = l.length - 1
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (l[m].from <= d) lo = m; else hi = m - 1 }
  return l[lo].kmh
}

/** Scale so that driving at k × limit everywhere reproduces the route's ETA. */
export function paceFactor(route: Route): number {
  let t = 0
  for (let i = 0; i < route.limits.length; i++) {
    const end = i + 1 < route.limits.length ? route.limits[i + 1].from : route.distance
    t += (end - route.limits[i].from) / (route.limits[i].kmh / 3.6)
  }
  return t / Math.max(1, route.duration)
}

/** Sample states along a route and return one label per equal-length chunk. */
export async function statesAlong(route: Route): Promise<(string | null)[]> {
  const km = route.distance / 1000
  const n = Math.max(1, Math.min(36, Math.ceil(km / 45)))
  const step = route.distance / n
  const pts = Array.from({ length: n }, (_, i) => pointAt(route, (i + 0.5) * step).pos)
  const out: (string | null)[] = new Array(n).fill(null)
  let next = 0
  const worker = async () => {
    while (next < n) {
      const i = next++
      out[i] = await reverseState(pts[i][1], pts[i][0])
    }
  }
  await Promise.all([worker(), worker(), worker(), worker()])
  // Fill gaps from the nearest resolved neighbour — a state doesn't flip every 60 km
  for (let i = 0; i < n; i++) {
    if (out[i]) continue
    let d = 1
    while (d < n && !(out[i - d] ?? out[i + d])) d++
    out[i] = out[i - d] ?? out[i + d] ?? null
  }
  return out
}

export const fmtKm = (m: number) => (m < 950 ? `${Math.round(m / 10) * 10} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`)

export function fmtDur(sec: number): string {
  const m = Math.max(0, Math.round(sec / 60))
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const mm = m % 60
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`
  return `${h} h ${mm.toString().padStart(2, '0')} min`
}

export const clock = (msFromNow: number) =>
  new Date(Date.now() + msFromNow).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })

/** Road trips people actually want to try — one tap each. */
export const DEMO_TRIPS: { label: string; from: Place; to: Place }[] = [
  {
    label: 'HITEC City → Charminar',
    from: { name: 'HITEC City', sub: 'Hyderabad, Telangana', lat: 17.4435, lng: 78.3772 },
    to: { name: 'Charminar', sub: 'Hyderabad, Telangana', lat: 17.3616, lng: 78.4747 },
  },
  {
    label: 'Hyderabad → Bengaluru',
    from: { name: 'Hyderabad', sub: 'Telangana', lat: 17.385, lng: 78.4867 },
    to: { name: 'Bengaluru', sub: 'Karnataka', lat: 12.9716, lng: 77.5946 },
  },
  {
    label: 'Mumbai → Pune',
    from: { name: 'Mumbai', sub: 'Maharashtra', lat: 19.076, lng: 72.8777 },
    to: { name: 'Pune', sub: 'Maharashtra', lat: 18.5204, lng: 73.8567 },
  },
  {
    label: 'Delhi → Jaipur',
    from: { name: 'New Delhi', sub: 'Delhi', lat: 28.6139, lng: 77.209 },
    to: { name: 'Jaipur', sub: 'Rajasthan', lat: 26.9124, lng: 75.7873 },
  },
  {
    label: 'Chennai → Kochi',
    from: { name: 'Chennai', sub: 'Tamil Nadu', lat: 13.0827, lng: 80.2707 },
    to: { name: 'Kochi', sub: 'Kerala', lat: 9.9312, lng: 76.2673 },
  },
]

/**
 * A spot on `route`, 1-16 km past `from`, where at least one alternative runs
 * well clear of it — used by the demo to drop a hazard the Guardian can avoid.
 */
export function divergencePoint(route: Route, alts: Route[], from: number): { at: number; pos: LngLat } | null {
  const total = route.distance
  for (let d = from + 900; d < Math.min(total - 400, from + 16000); d += 150) {
    const pos = pointAt(route, d).pos
    if (alts.some(a => project(a, pos).offset > 260)) return { at: d, pos }
  }
  return null
}

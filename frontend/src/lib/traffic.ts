/**
 * Traffic-aware travel times, worldwide.
 *
 * The public routing engine returns free-flow times (as if the roads were empty), which is why a
 * 12 km city trip came out at 51 km/h. This module turns those into realistic times in two layers:
 *
 *  1. TYPICAL traffic (always on, works anywhere): the slowdown a road usually has at this local
 *     hour and weekday, scaled by how congested the nearest big city is, how close the road is to
 *     its centre, and what kind of road it is (motorways suffer less than city streets).
 *     These are estimates built from published city congestion rankings, not measurements.
 *  2. LIVE traffic (when the server has a TomTom key): real measured speeds sampled along the route.
 *
 * Both are recomputed every minute while a route is on screen, so the ETA keeps moving with the clock.
 */
import { API_URL } from './api'
import type { Route } from './routing'

export type TrafficLevel = 'light' | 'moderate' | 'heavy' | 'severe'
export interface TrafficInfo {
  level: TrafficLevel
  /** seconds lost versus empty roads */
  delay: number
  source: 'live' | 'typical'
  /** local time the estimate is for */
  at: number
}
export interface LiveSample { lat: number; lng: number; ratio: number }

// [name, lat, lng, metro population (millions), peak congestion on city streets]
// "peak" is the typical extra-time factor at the evening peak in the core: 1.0 means trips take about twice as long.
const CITIES: Array<[string, number, number, number, number]> = [
  ['Bengaluru', 12.97, 77.59, 13, 1.35], ['Mumbai', 19.08, 72.88, 21, 1.3], ['Kolkata', 22.57, 88.36, 15, 1.2],
  ['Delhi', 28.61, 77.21, 32, 1.15], ['Pune', 18.52, 73.86, 7, 1.2], ['Hyderabad', 17.39, 78.49, 10, 1.1],
  ['Chennai', 13.08, 80.27, 11, 1.1], ['Ahmedabad', 23.03, 72.58, 8, 0.95], ['Jaipur', 26.91, 75.79, 4, 0.9],
  ['Lucknow', 26.85, 80.95, 4, 0.85], ['Surat', 21.17, 72.83, 7, 0.85], ['Kochi', 9.93, 76.27, 3, 0.9],
  ['Nagpur', 21.15, 79.09, 3, 0.7], ['Indore', 22.72, 75.86, 3, 0.75], ['Bhopal', 23.26, 77.41, 2.5, 0.7],
  ['Coimbatore', 11.02, 76.96, 2.5, 0.7], ['Visakhapatnam', 17.69, 83.22, 2.3, 0.7], ['Patna', 25.59, 85.14, 2.5, 0.85],
  ['Chandigarh', 30.73, 76.78, 1.4, 0.6], ['Thiruvananthapuram', 8.52, 76.94, 1.7, 0.7], ['Vijayawada', 16.51, 80.65, 2, 0.7],
  ['Guwahati', 26.14, 91.74, 1.5, 0.75], ['Bhubaneswar', 20.30, 85.82, 1.4, 0.65], ['Mysuru', 12.30, 76.64, 1.2, 0.55],
  ['Dhaka', 23.81, 90.41, 23, 1.4], ['Karachi', 24.86, 67.01, 17, 1.2], ['Lahore', 31.55, 74.34, 14, 1.1],
  ['Kathmandu', 27.72, 85.32, 3, 1.1], ['Colombo', 6.93, 79.86, 2.5, 0.9],
  ['Jakarta', -6.21, 106.85, 34, 1.4], ['Manila', 14.60, 120.98, 24, 1.35], ['Bangkok', 13.76, 100.50, 11, 1.2],
  ['Ho Chi Minh City', 10.82, 106.63, 14, 1.15], ['Hanoi', 21.03, 105.85, 8, 1.1], ['Kuala Lumpur', 3.14, 101.69, 8, 0.9],
  ['Singapore', 1.35, 103.82, 6, 0.6], ['Seoul', 37.57, 126.98, 26, 0.85], ['Tokyo', 35.68, 139.69, 37, 0.65],
  ['Osaka', 34.69, 135.50, 19, 0.55], ['Beijing', 39.90, 116.40, 21, 1.0], ['Shanghai', 31.23, 121.47, 29, 0.9],
  ['Guangzhou', 23.13, 113.26, 19, 0.9], ['Shenzhen', 22.54, 114.06, 13, 0.9], ['Chengdu', 30.57, 104.07, 16, 0.85],
  ['Hong Kong', 22.32, 114.17, 7.5, 0.6], ['Taipei', 25.03, 121.57, 7, 0.75],
  ['Dubai', 25.20, 55.27, 3.6, 0.6], ['Riyadh', 24.71, 46.68, 7.5, 0.7], ['Tehran', 35.69, 51.39, 9, 1.1],
  ['Istanbul', 41.01, 28.98, 16, 1.2], ['Cairo', 30.04, 31.24, 22, 1.3], ['Baghdad', 33.31, 44.37, 7, 1.0],
  ['Lagos', 6.52, 3.38, 15, 1.5], ['Nairobi', -1.29, 36.82, 5, 1.2], ['Johannesburg', -26.20, 28.05, 6, 0.7],
  ['Cape Town', -33.92, 18.42, 4.8, 0.6], ['Addis Ababa', 9.03, 38.74, 5, 1.0], ['Casablanca', 33.57, -7.59, 4, 0.8],
  ['Kinshasa', -4.44, 15.27, 15, 1.4], ['Accra', 5.60, -0.19, 4, 1.1], ['Algiers', 36.75, 3.06, 3, 0.8],
  ['London', 51.51, -0.13, 9.7, 0.85], ['Paris', 48.86, 2.35, 11, 0.8], ['Madrid', 40.42, -3.70, 6.7, 0.6],
  ['Barcelona', 41.39, 2.17, 5.6, 0.6], ['Rome', 41.90, 12.50, 4.3, 0.85], ['Milan', 45.46, 9.19, 4.3, 0.7],
  ['Berlin', 52.52, 13.40, 3.7, 0.6], ['Munich', 48.14, 11.58, 2.9, 0.6], ['Amsterdam', 52.37, 4.90, 2.4, 0.55],
  ['Brussels', 50.85, 4.35, 2.1, 0.7], ['Vienna', 48.21, 16.37, 2, 0.5], ['Warsaw', 52.23, 21.01, 3.1, 0.6],
  ['Moscow', 55.76, 37.62, 17, 1.0], ['Saint Petersburg', 59.93, 30.34, 5.6, 0.8], ['Kyiv', 50.45, 30.52, 3, 0.7],
  ['Athens', 37.98, 23.73, 3.6, 0.65], ['Lisbon', 38.72, -9.14, 3, 0.65], ['Dublin', 53.35, -6.26, 1.4, 0.75],
  ['Stockholm', 59.33, 18.07, 2.4, 0.45], ['Oslo', 59.91, 10.75, 1.5, 0.45], ['Helsinki', 60.17, 24.94, 1.5, 0.4],
  ['Zurich', 47.38, 8.54, 1.4, 0.45], ['Manchester', 53.48, -2.24, 2.8, 0.6],
  ['New York', 40.71, -74.01, 19, 1.0], ['Los Angeles', 34.05, -118.24, 13, 0.9], ['Chicago', 41.88, -87.63, 9, 0.7],
  ['Houston', 29.76, -95.37, 7, 0.55], ['San Francisco', 37.77, -122.42, 7, 0.8], ['Washington', 38.91, -77.04, 6, 0.8],
  ['Boston', 42.36, -71.06, 4.9, 0.75], ['Seattle', 47.61, -122.33, 4, 0.7], ['Atlanta', 33.75, -84.39, 6, 0.65],
  ['Miami', 25.76, -80.19, 6, 0.65], ['Dallas', 32.78, -96.80, 7, 0.55], ['Toronto', 43.65, -79.38, 6.4, 0.75],
  ['Vancouver', 49.28, -123.12, 2.6, 0.7], ['Montreal', 45.50, -73.57, 4.3, 0.75],
  ['Mexico City', 19.43, -99.13, 22, 1.3], ['Guadalajara', 20.66, -103.35, 5, 0.8], ['Bogotá', 4.71, -74.07, 11, 1.35],
  ['Lima', -12.05, -77.04, 11, 1.3], ['São Paulo', -23.55, -46.63, 22, 1.2], ['Rio de Janeiro', -22.91, -43.17, 13, 1.0],
  ['Buenos Aires', -34.60, -58.38, 15, 0.9], ['Santiago', -33.45, -70.67, 7, 0.85], ['Caracas', 10.48, -66.90, 3, 0.8],
  ['Sydney', -33.87, 151.21, 5.3, 0.7], ['Melbourne', -37.81, 144.96, 5, 0.65], ['Brisbane', -27.47, 153.03, 2.6, 0.5],
  ['Auckland', -36.85, 174.76, 1.7, 0.6],
]

const rad = (d: number) => (d * Math.PI) / 180
function km(aLat: number, aLng: number, bLat: number, bLng: number) {
  const dx = rad(bLng - aLng) * Math.cos(rad((aLat + bLat) / 2))
  return Math.hypot(dx, rad(bLat - aLat)) * 6371
}

/** Approximate local clock offset (hours) for a place, good enough for rush-hour timing. */
export function tzOffset(lat: number, lng: number): number {
  if (lng > 68 && lng < 97.5 && lat > 6 && lat < 37.5) return 5.5 // India, Sri Lanka, Nepal (+5:45)
  if (lng > 73 && lng < 135 && lat > 18 && lat < 54) return 8 // China
  return Math.round((lng / 15) * 2) / 2
}

function localHour(at: number, lat: number, lng: number): { h: number; dow: number } {
  const t = new Date(at + tzOffset(lat, lng) * 3600_000)
  return { h: t.getUTCHours() + t.getUTCMinutes() / 60, dow: t.getUTCDay() }
}

/** 0..1 demand for road space at a local hour (weekday: two rush hours; weekend: a gentle afternoon peak). */
export function demand(h: number, dow: number): number {
  const g = (c: number, w: number) => Math.exp(-(((h - c) / w) ** 2))
  const weekend = dow === 0 || dow === 6
  if (weekend) return Math.min(1, 0.06 + 0.5 * g(13.5, 3.2) + 0.45 * g(18.5, 2.4) * (dow === 6 ? 1 : 0.8))
  const fri = dow === 5 ? 1.08 : 1
  return Math.min(1, (0.07 + 0.9 * g(9.2, 1.4) + g(18.3, 1.7) + 0.38 * g(13.5, 2.8)) * fri)
}

/** City pressure at a point: peak congestion of nearby cities, fading with distance and city size. */
export function cityPressure(lat: number, lng: number): number {
  let best = 0.05 // open country
  for (const [, cLat, cLng, pop, peak] of CITIES) {
    if (Math.abs(cLat - lat) > 1.2 || Math.abs(cLng - lng) > 1.4) continue
    const d = km(lat, lng, cLat, cLng)
    const radius = 9 + 9 * Math.log10(pop + 1) // ~19 km for 2M people, ~32 km for 30M
    const p = peak * Math.exp(-((d / radius) ** 2))
    if (p > best) best = p
  }
  return best
}

/** How much a road of this free-flow speed (km/h) suffers: motorways least, city streets most. */
function sensitivity(freeKmh: number) {
  if (freeKmh >= 90) return 0.3
  if (freeKmh >= 70) return 0.55
  if (freeKmh >= 50) return 0.85
  return 1
}

const posAt = (route: Route, d: number): [number, number] => {
  const c = route.coords, cum = route.cum
  let lo = 0, hi = cum.length - 1
  while (lo < hi) { const m = (lo + hi) >> 1; if (cum[m] < d) lo = m + 1; else hi = m }
  return [c[lo][1], c[lo][0]]
}

function freeAt(route: Route, d: number) {
  const l = route.limits
  let lo = 0, hi = l.length - 1
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (l[m].from <= d) lo = m; else hi = m - 1 }
  return l[lo].kmh
}

/** Expected time to drive the route, with the slowdown at each stretch. Seconds. */
export function predictDuration(route: Route, at: number, live?: LiveSample[]): number {
  const step = Math.max(250, route.distance / 4000)
  let t = 0, tFree = 0
  for (let d = 0; d < route.distance; d += step) {
    const len = Math.min(step, route.distance - d)
    const mid = d + len / 2
    const [lat, lng] = posAt(route, mid)
    const free = Math.max(15, freeAt(route, mid))
    const { h, dow } = localHour(at, lat, lng)
    // 0.18: signals and junctions the routing engine ignores; 1.2: rush-hour weight
    let c = cityPressure(lat, lng) * (0.18 + 1.2 * demand(h, dow)) * sensitivity(free)
    if (live?.length) {
      let near: LiveSample | null = null, nd = 6 // measured speeds within 6 km win over the typical pattern
      for (const s of live) { const k = km(lat, lng, s.lat, s.lng); if (k < nd) { nd = k; near = s } }
      if (near) c = Math.max(0, 1 / Math.max(0.12, Math.min(1, near.ratio)) - 1)
    }
    const v = Math.max(4, free / (1 + c)) // km/h
    t += len / (v / 3.6)
    tFree += len / (free / 3.6)
  }
  // Apply the slowdown ratio to the routing engine's own free-flow time (which already includes turns and signals)
  return route.freeDuration * Math.max(1, t / Math.max(1, tFree))
}

export function levelFor(ratio: number): TrafficLevel {
  return ratio < 1.15 ? 'light' : ratio < 1.4 ? 'moderate' : ratio < 1.8 ? 'heavy' : 'severe'
}

/** Update a route's duration and traffic info for the given moment. Returns a new Route. */
export function withTraffic(route: Route, at = Date.now(), live?: LiveSample[]): Route {
  const duration = predictDuration(route, at, live)
  const free = route.freeDuration
  return {
    ...route,
    duration,
    traffic: { level: levelFor(duration / Math.max(1, free)), delay: Math.max(0, duration - free), source: live?.length ? 'live' : 'typical', at },
  }
}

export const LEVEL_LABEL: Record<TrafficLevel, string> = {
  light: 'Light traffic', moderate: 'Moderate traffic', heavy: 'Heavy traffic', severe: 'Severe traffic',
}
export const LEVEL_COLOR: Record<TrafficLevel, string> = {
  light: '#00cc66', moderate: '#ffaa00', heavy: '#ff6600', severe: '#ff2266',
}

// ── Live data (needs TOMTOM_API_KEY on the server) ────────────────────────
let liveOffUntil = 0

/** Measured speed ratios (current / free-flow) at a few points along the route, or [] when there is no live feed. */
export async function fetchLive(route: Route): Promise<LiveSample[]> {
  if (Date.now() < liveOffUntil) return []
  const n = Math.max(2, Math.min(6, Math.round(route.distance / 4000)))
  const pts: string[] = []
  for (let i = 0; i < n; i++) {
    const [lat, lng] = posAt(route, (route.distance * (i + 0.5)) / n)
    pts.push(`${lat.toFixed(4)},${lng.toFixed(4)}`)
  }
  try {
    const r = await fetch(`${API_URL}/api/traffic/flow?points=${encodeURIComponent(pts.join('|'))}`, { signal: AbortSignal.timeout(6000) })
    if (!r.ok) throw new Error(String(r.status))
    const j = (await r.json()) as { live: boolean; samples: LiveSample[] }
    if (!j.live) { liveOffUntil = Date.now() + 30 * 60_000; return [] }
    return j.samples
  } catch {
    liveOffUntil = Date.now() + 2 * 60_000
    return []
  }
}

/**
 * Rain on the route: asks the backend (Open-Meteo forecast, cached) for the hour
 * you will be at the midpoint and at the destination.
 */
import { API_URL } from './api'
import type { Route } from './routing'

type Hour = { t: string; p: number | null; mm: number | null }
export type RainOutlook = {
  /** Chance of rain 0-100, or null when the forecast only gives amounts. */
  prob: number | null
  /** Expected rain in mm for that hour. */
  mm: number
  where: 'on the way' | 'at your destination'
  at: Date
} | null

function hourNear(hours: Hour[], when: number): Hour | undefined {
  let best: Hour | undefined, gap = Infinity
  for (const h of hours) {
    const g = Math.abs(new Date(h.t).getTime() - when)
    if (g < gap) { gap = g; best = h }
  }
  return gap <= 90 * 60_000 ? best : undefined
}

export async function rainOnRoute(route: Route, startAt = Date.now()): Promise<RainOutlook> {
  const n = route.coords.length
  if (n < 2) return null
  const mid = route.coords[Math.floor(n / 2)]
  const end = route.coords[n - 1]
  const pts = [mid, end].map(([lng, lat]) => `${lat.toFixed(2)},${lng.toFixed(2)}`).join('|')
  const r = await fetch(`${API_URL}/api/weather?points=${encodeURIComponent(pts)}`, { signal: AbortSignal.timeout(7000) })
  if (!r.ok) return null
  const j = await r.json() as { points: { hours: Hour[] }[] }
  if (!j.points?.length) return null
  const tMid = startAt + (route.duration * 1000) / 2
  const tEnd = startAt + route.duration * 1000
  const cands: { h: Hour; where: 'on the way' | 'at your destination'; at: number }[] = []
  const pMid = j.points[0], pEnd = j.points[j.points.length - 1]
  const a = pMid && hourNear(pMid.hours, tMid); if (a) cands.push({ h: a, where: 'on the way', at: tMid })
  const b = pEnd && hourNear(pEnd.hours, tEnd); if (b) cands.push({ h: b, where: 'at your destination', at: tEnd })
  const score = (h: Hour) => (h.p ?? 0) + (h.mm ?? 0) * 20
  const worst = cands.sort((x, y) => score(y.h) - score(x.h))[0]
  if (!worst || (worst.h.p == null && worst.h.mm == null)) return null
  return { prob: worst.h.p, mm: worst.h.mm ?? 0, where: worst.where, at: new Date(worst.at) }
}

/** Worth showing on the route card: a real chance of rain, or rain actually forecast. */
export function rainy(o: RainOutlook): boolean {
  return !!o && ((o.prob ?? 0) >= 40 || o.mm >= 0.3)
}

/** Worth saying out loud with the traffic summary. */
export function rainLikely(o: RainOutlook): boolean {
  return !!o && ((o.prob ?? 0) >= 60 || o.mm >= 1)
}

export function rainSentence(o: RainOutlook): string {
  if (!o) return 'I could not get the rain forecast right now.'
  const time = o.at.toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit' })
  if (!rainy(o)) return 'No rain expected on this trip.'
  const heavy = o.mm >= 5 ? ' Heavy rain, so watch for waterlogging and drive slowly.' : ''
  const how = o.prob != null ? `, about ${o.prob} percent` : o.mm >= 1 ? `, about ${Math.round(o.mm)} millimetres an hour` : ', light'
  return `${rainLikely(o) ? 'Rain is likely' : 'There is some chance of rain'} ${o.where} around ${time}${how}.${heavy}`
}

/** Rain where you are over the next few hours (for "will it rain" without a route). */
export async function rainHere(lat: number, lng: number, hoursAhead = 6): Promise<string> {
  const r = await fetch(`${API_URL}/api/weather?points=${lat.toFixed(2)},${lng.toFixed(2)}`, { signal: AbortSignal.timeout(7000) })
  if (!r.ok) return 'I could not get the rain forecast right now.'
  const j = await r.json() as { points: { hours: Hour[] }[] }
  const hours = (j.points?.[0]?.hours ?? []).slice(0, hoursAhead)
  if (!hours.length) return 'I could not get the rain forecast right now.'
  const score = (h: Hour) => (h.p ?? 0) + (h.mm ?? 0) * 20
  const worst = [...hours].sort((a, b) => score(b) - score(a))[0]
  const o: RainOutlook = { prob: worst.p, mm: worst.mm ?? 0, where: 'on the way', at: new Date(worst.t) }
  if (!rainy(o)) return `No rain expected here in the next ${hoursAhead} hours.`
  return rainSentence(o).replace(' on the way', ' here')
}

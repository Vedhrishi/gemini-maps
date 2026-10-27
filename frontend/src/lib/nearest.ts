/**
 * "Nearest petrol pump / restaurant / ATM…" — the most asked map questions.
 * India: answered from the offline place cells (instant, no live service needed).
 * Everywhere else, or when the cells hold too few: OpenStreetMap through Overpass.
 */
import { rowsNear, inIndia } from './hyd'
import type { Place } from './routing'

export interface NearCat { id: string; label: string; icon: string; say: string; match: RegExp; osm: string }

export const NEAR_CATS: NearCat[] = [
  { id: 'fuel', label: 'Petrol', icon: '⛽', say: 'petrol pump', match: /gas station|fuel|petrol|filling/, osm: '"amenity"="fuel"' },
  { id: 'ev', label: 'EV charging', icon: '🔌', say: 'charging station', match: /charging station|ev charg/, osm: '"amenity"="charging_station"' },
  { id: 'food', label: 'Restaurant', icon: '🍽', say: 'restaurant', match: /restaurant|dhaba|food court|diner/, osm: '"amenity"="restaurant"' },
  { id: 'cafe', label: 'Cafe', icon: '☕', say: 'cafe', match: /\bcafe\b|coffee|tea house/, osm: '"amenity"="cafe"' },
  { id: 'atm', label: 'ATM', icon: '🏧', say: 'ATM', match: /^atm$|\batm\b/, osm: '"amenity"="atm"' },
  { id: 'hospital', label: 'Hospital', icon: '🏥', say: 'hospital', match: /hospital|emergency room|trauma/, osm: '"amenity"="hospital"' },
  { id: 'pharmacy', label: 'Pharmacy', icon: '💊', say: 'pharmacy', match: /pharmacy|drugstore|chemist/, osm: '"amenity"="pharmacy"' },
  { id: 'police', label: 'Police', icon: '🚓', say: 'police station', match: /police/, osm: '"amenity"="police"' },
  { id: 'parking', label: 'Parking', icon: '🅿️', say: 'parking', match: /parking/, osm: '"amenity"="parking"' },
  { id: 'hotel', label: 'Hotel', icon: '🛏', say: 'hotel', match: /\bhotel\b|resort|lodg|hostel|guest house/, osm: '"tourism"~"hotel|guest_house|hostel"' },
  { id: 'grocery', label: 'Groceries', icon: '🛒', say: 'supermarket', match: /grocery|supermarket|convenience|kirana/, osm: '"shop"~"supermarket|convenience"' },
  { id: 'mechanic', label: 'Mechanic', icon: '🔧', say: 'car mechanic', match: /automotive repair|auto repair|car repair|tire|tyre|mechanic|garage/, osm: '"shop"~"car_repair|tyres"' },
  { id: 'toilet', label: 'Restroom', icon: '🚻', say: 'public restroom', match: /public toilet|restroom|washroom/, osm: '"amenity"="toilets"' },
]

/** Words people say, in priority order, mapped to a category. */
export function catFromSpeech(t: string): NearCat | null {
  const s = t.toLowerCase()
  const rules: [RegExp, string][] = [
    [/petrol|gas station|fuel|diesel|filling station|pump/, 'fuel'], [/charging|\bev\b/, 'ev'],
    [/restaurant|food|eat|hungry|dhaba|lunch|dinner|biryani/, 'food'], [/cafe|coffee|tea/, 'cafe'],
    [/\batm\b|cash|bank/, 'atm'], [/hospital|emergency|doctor|clinic/, 'hospital'], [/pharmacy|medical store|medicine|chemist/, 'pharmacy'],
    [/police/, 'police'], [/parking|park my/, 'parking'], [/hotel|stay|lodge|hostel/, 'hotel'],
    [/grocery|supermarket|kirana|store/, 'grocery'], [/mechanic|garage|puncture|tyre|tire|repair/, 'mechanic'], [/toilet|restroom|washroom/, 'toilet'],
  ]
  for (const [re, id] of rules) if (re.test(s)) return NEAR_CATS.find(c => c.id === id) ?? null
  return null
}

export interface NearHit extends Place { km: number }
const dist = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dx = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot(dx, b.lat - a.lat) * 111.2
}

async function overpass(cat: NearCat, at: { lat: number; lng: number }, radius: number): Promise<NearHit[]> {
  const q = `[out:json][timeout:12];nwr(around:${radius},${at.lat},${at.lng})[${cat.osm}];out center 40;`
  const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 14000)
  try {
    const r = await fetch('https://overpass-api.de/api/interpreter', { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ctl.signal,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' } })
    if (!r.ok) return []
    const j = await r.json()
    return (j.elements ?? []).map((e: any) => {
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon
      if (lat == null || lng == null) return null
      const tg = e.tags ?? {}
      const name = tg.name || tg.brand || tg.operator || cat.label
      return { name, sub: [tg['addr:street'], tg['addr:city']].filter(Boolean).join(', ') || cat.label, lat, lng, km: dist(at, { lat, lng }) }
    }).filter(Boolean)
  } catch { return [] } finally { clearTimeout(t) }
}

/** Closest places of a kind, nearest first. */
export async function findNearest(cat: NearCat, at: { lat: number; lng: number }, limit = 6): Promise<NearHit[]> {
  const out: NearHit[] = []
  if (inIndia(at.lat, at.lng)) {
    const rows = await rowsNear(at).catch(() => [])
    for (const r of rows) {
      if (r.k !== 'P') continue
      const kind = r.sub.split(',')[0].toLowerCase()
      if (!cat.match.test(kind)) continue
      const km = dist(at, r)
      if (km <= 30) out.push({ name: r.name, sub: r.sub.split(',').slice(1).join(',').trim() || cat.label, lat: r.lat, lng: r.lng, km })
    }
  }
  out.sort((a, b) => a.km - b.km)
  if (out.length < 3 || out[0].km > 5) {          // sparse offline data: ask OpenStreetMap too
    const live = await overpass(cat, at, out.length ? 6000 : 15000)
    out.push(...live)
    out.sort((a, b) => a.km - b.km)
  }
  const seen: NearHit[] = []
  for (const h of out) {                             // drop duplicates (same spot, or same name within 80 m)
    if (seen.some(s => dist(s, h) < 0.05 || (s.name.toLowerCase() === h.name.toLowerCase() && dist(s, h) < 0.15))) continue
    seen.push(h)
    if (seen.length >= limit) break
  }
  return seen
}

export const fmtDist = (km: number) => km < 1 ? `${Math.round(km * 10) * 100} metres` : `${km.toFixed(1)} kilometres`

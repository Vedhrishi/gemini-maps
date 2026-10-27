/**
 * Offline India gazetteer: ~18.5k towns, cities, districts, airports, railway
 * stations and landmarks (GeoNames, CC BY 4.0). Loaded on first search, then
 * searched in memory, so suggestions appear instantly and work with no signal.
 * Streets, villages and businesses come from the live geocoders and the backend's
 * full village index (see searchPlaces).
 */

export interface GPlace {
  name: string
  sub: string
  lat: number
  lng: number
}

interface Row {
  name: string
  norm: string
  alt: string
  state: string
  lat: number
  lng: number
  t: string
  pop: number
  tokens: string[]
}

const TYPE_LABEL: Record<string, string> = {
  A: 'City', C: 'Town', D: 'District', T: 'Airport', S: 'Railway station', L: 'Landmark', V: 'Village',
}
const TYPE_WEIGHT: Record<string, number> = { A: 60, C: 40, T: 45, D: 25, S: 30, L: 20, V: 0 }

export const norm = (s: string) =>
  s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

let rows: Row[] | null = null
let loading: Promise<Row[]> | null = null

export function loadGazetteer(): Promise<Row[]> {
  if (rows) return Promise.resolve(rows)
  if (!loading) {
    loading = import('../data/in-places.tsv?raw').then(m => {
      const lines = (m.default as string).split('\n')
      const states = lines[0].slice(1).split('|')
      const out: Row[] = []
      for (let i = 1; i < lines.length; i++) {
        const p = lines[i].split('|')
        if (p.length < 7) continue
        const name = p[5] === 'S' ? p[0].replace(/Railroad Station/i, 'Railway Station') : p[0]
        const alt = p[1].replace(/\//g, ' ')
        const n = norm(name)
        out.push({
          name, norm: n, alt: norm(alt), state: states[+p[2]] ?? '', lat: +p[3], lng: +p[4],
          t: p[5], pop: +p[6], tokens: (n + ' ' + norm(alt)).split(' '),
        })
      }
      rows = out
      return out
    })
  }
  return loading
}

const km = (aLat: number, aLng: number, bLat: number, bLng: number) => {
  const r = Math.PI / 180
  const dx = (bLng - aLng) * Math.cos(((aLat + bLat) / 2) * r)
  const dy = bLat - aLat
  return Math.sqrt(dx * dx + dy * dy) * 111.2
}

export async function searchGazetteer(q: string, near?: { lat: number; lng: number }, limit = 8): Promise<GPlace[]> {
  const nq = norm(q)
  if (nq.length < 2) return []
  const data = await loadGazetteer()
  const qt = nq.split(' ')
  const scored: { r: Row; s: number }[] = []
  for (const r of data) {
    let s = 0
    let ok = true
    for (let i = 0; i < qt.length; i++) {
      const t = qt[i]
      if (r.norm.startsWith(t) && i === 0 && qt.length === 1) s += 3000
      else if (r.tokens.some(x => x.startsWith(t))) s += 2000 - i * 50
      else if (r.state && norm(r.state).startsWith(t)) s += 300
      else if (i === qt.length - 1 && t.length >= 3 && r.norm.includes(t)) s += 600
      else { ok = false; break }
    }
    if (!ok) continue
    if (r.norm === nq || r.alt === nq) s += 2500
    s += TYPE_WEIGHT[r.t] ?? 0
    if (r.pop > 0) s += Math.min(60, Math.log10(r.pop) * 9)
    if (near) {
      const d = km(near.lat, near.lng, r.lat, r.lng)
      s += Math.max(0, 40 - d / 10) // up to +40 for the user's own neighbourhood
    }
    scored.push({ r, s })
  }
  scored.sort((a, b) => b.s - a.s)
  const out: GPlace[] = []
  for (const { r } of scored) {
    if (out.some(o => norm(o.name) === r.norm && km(o.lat, o.lng, r.lat, r.lng) < 4 && o.sub.startsWith(TYPE_LABEL[r.t]))) continue
    out.push({ name: r.name, sub: [TYPE_LABEL[r.t], r.state].filter(Boolean).join(' · '), lat: r.lat, lng: r.lng })
    if (out.length >= limit) break
  }
  return out
}

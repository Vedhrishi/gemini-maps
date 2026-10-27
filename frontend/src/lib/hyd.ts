/**
 * Street-level detail for all of India: ~4M shops, restaurants, hospitals, schools,
 * offices and (in the big metros) named buildings, from Overture Maps (CC BY 4.0 / ODbL).
 * The data is split into 1-degree map cells (about 110 km). Only the cells around the
 * place you are searching from are downloaded (cached by the service worker), then searched in memory.
 */
import { norm } from './gazetteer'

export interface HPlace { name: string; sub: string; lat: number; lng: number }
interface Row { name: string; n: string; sub: string; lat: number; lng: number; k: string; toks: string[] }

const ROOT = `${import.meta.env.BASE_URL}data/`
const KINDS = ['cells', 'streets'] as const   // places and buildings, then street and lane names
const cells = new Map<string, Promise<Row[]>>()
const indexes = new Map<string, Promise<Record<string, number>>>()

function getIndex(kind: string) {
  let p = indexes.get(kind)
  if (!p) {
    p = fetch(`${ROOT}${kind}/index.json`).then(r => r.json()).catch(() => { indexes.delete(kind); return {} as Record<string, number> })
    indexes.set(kind, p)
  }
  return p
}

async function gunzipText(res: Response): Promise<string> {
  const buf = new Uint8Array(await res.arrayBuffer())
  // some hosts already decode the gzip: only decompress when the magic bytes are there
  if (buf[0] === 0x1f && buf[1] === 0x8b)
    return new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text()
  return new TextDecoder().decode(buf)
}

function loadCell(path: string): Promise<Row[]> {
  let p = cells.get(path)
  if (!p) {
    p = (async () => {
      const res = await fetch(`${ROOT}${path}.tsv.gz`)
      if (!res.ok) throw new Error('cell')
      const out: Row[] = []
      for (const line of (await gunzipText(res)).split('\n')) {
        const a = line.split('|')
        if (a.length < 5) continue
        const n = norm(a[0])
        if (!n) continue
        out.push({ name: a[0], n, sub: a[1], lat: +a[2], lng: +a[3], k: a[4], toks: n.split(' ') })
      }
      return out
    })().catch(e => { cells.delete(path); throw e })
    cells.set(path, p)
    if (cells.size > 10) cells.delete(cells.keys().next().value as string) // keep memory bounded
  }
  return p
}

/** True where the dataset has coverage (India). */
export const inIndia = (lat: number, lng: number) => lat > 6 && lat < 37.5 && lng > 68 && lng < 98

/** The cell holding this point, plus a neighbour when the point is within ~35 km of a cell edge. */
function cellsAround(lat: number, lng: number, have: Record<string, number>): string[] {
  const fy = lat - Math.floor(lat), fx = lng - Math.floor(lng)
  const ys = [Math.floor(lat)], xs = [Math.floor(lng)]
  if (fy < 0.3) ys.push(Math.floor(lat) - 1); if (fy > 0.7) ys.push(Math.floor(lat) + 1)
  if (fx < 0.3) xs.push(Math.floor(lng) - 1); if (fx > 0.7) xs.push(Math.floor(lng) + 1)
  const out: string[] = []
  for (const y of ys) for (const x of xs) if (have[`${y}_${x}`]) out.push(`${y}_${x}`)
  return out
}

export async function searchDetail(q: string, near: { lat: number; lng: number }, limit = 8): Promise<HPlace[]> {
  const nq = norm(q)
  if (nq.length < 3 || !inIndia(near.lat, near.lng)) return []
  const paths: string[] = []
  for (const kind of KINDS) for (const k of cellsAround(near.lat, near.lng, await getIndex(kind))) paths.push(`${kind}/${k}`)
  const data = (await Promise.all(paths.map(k => loadCell(k).catch(() => [] as Row[])))).flat()
  const qt = nq.split(' ')
  const hits: { s: number; r: Row }[] = []
  for (const r of data) {
    let s = 0
    if (r.n === nq) s = 3000
    else if (r.n.startsWith(nq)) s = 2500
    else if (qt.every(t => r.toks.some(x => x.startsWith(t)))) s = 2000
    else continue
    if (r.k === 'B') s -= 150
    if (r.k === 'S') s -= 60
    const dx = (r.lng - near.lng) * Math.cos(near.lat * Math.PI / 180)
    s += Math.max(0, 80 - Math.hypot(dx, r.lat - near.lat) * 111.2 * 4) // places within ~20 km rank higher
    hits.push({ s, r })
  }
  hits.sort((a, b) => b.s - a.s)
  const out: HPlace[] = []
  const seen = new Set<string>()
  for (const { r } of hits) {
    const key = r.n + r.lat.toFixed(3) + r.lng.toFixed(3)
    if (seen.has(key)) continue
    seen.add(key)
    out.push({ name: r.name, sub: r.sub, lat: r.lat, lng: r.lng })
    if (out.length >= limit) break
  }
  return out
}

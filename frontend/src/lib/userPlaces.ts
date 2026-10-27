/** Places people add themselves where the map has a gap. Saved on this device and sent to the backend. */
import { API_URL } from './api'

export interface UPlace { name: string; sub: string; lat: number; lng: number }
const KEY = 'gm-user-places'

export function localUserPlaces(): UPlace[] {
  try { return JSON.parse(localStorage.getItem(KEY) || '[]') } catch { return [] }
}

export function searchUserPlaces(q: string, limit = 5): UPlace[] {
  const nq = q.toLowerCase().trim()
  if (nq.length < 2) return []
  return localUserPlaces().filter(p => p.name.toLowerCase().includes(nq)).slice(0, limit)
}

export async function addUserPlace(name: string, lat: number, lng: number, category = ''): Promise<boolean> {
  const p: UPlace = { name: name.trim(), sub: ['Added by you', category].filter(Boolean).join(' · '), lat, lng }
  try {
    const all = localUserPlaces().filter(x => !(x.name.toLowerCase() === p.name.toLowerCase() && Math.abs(x.lat - lat) < 0.0005))
    localStorage.setItem(KEY, JSON.stringify([p, ...all].slice(0, 300)))
  } catch { /* storage unavailable */ }
  try {
    const r = await fetch(`${API_URL}/api/places/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: p.name, lat, lng, category }),
    })
    return r.ok
  } catch { return false }
}

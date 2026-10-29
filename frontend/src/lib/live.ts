/**
 * Live location groups. One person starts a group and gets a 6-letter code; anyone who joins with the
 * code sees everyone on the map, moving. Each person chooses whether to send their own position.
 */
import { API_URL } from './api'

export interface LiveMember {
  id: string; name: string; color: string
  lat: number; lng: number
  speed: number | null; heading: number | null
  /** seconds since this person last reported */
  ago: number
  dest: string | null; eta: number | null
}

export interface LiveSession { room: string; me: string; key: string; color: string; name: string }

const STORE = 'gm-live'

async function call<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(`${API_URL}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    signal: AbortSignal.timeout(12000),
  })
  if (!r.ok) {
    let msg = 'Could not reach live sharing. Check your connection.'
    try { const j = await r.json(); if (typeof j.detail === 'string') msg = j.detail } catch { /* keep the default */ }
    const e: any = new Error(msg); e.status = r.status; throw e
  }
  return r.json()
}

export async function liveJoin(room: string, name: string): Promise<{ session: LiveSession; members: LiveMember[] }> {
  const j = await call<{ room: string; me: string; key: string; color: string; members: LiveMember[] }>('/api/live/join', { room, name })
  return { session: { room: j.room, me: j.me, key: j.key, color: j.color, name }, members: j.members }
}

export async function livePing(s: LiveSession, p: { lat: number; lng: number; speed: number | null; heading: number | null; dest?: string | null; eta?: number | null }): Promise<LiveMember[]> {
  return (await call<{ members: LiveMember[] }>(`/api/live/${s.room}/ping`, { me: s.me, key: s.key, ...p })).members
}

export async function liveWatch(s: LiveSession): Promise<LiveMember[]> {
  return (await call<{ members: LiveMember[] }>(`/api/live/${s.room}/watch`, { me: s.me, key: s.key })).members
}

export async function liveLeave(s: LiveSession): Promise<void> {
  try { await call(`/api/live/${s.room}/leave`, { me: s.me, key: s.key }) } catch { /* already gone */ }
}

export function saveSession(s: LiveSession | null) {
  try { s ? localStorage.setItem(STORE, JSON.stringify({ ...s, at: Date.now() })) : localStorage.removeItem(STORE) } catch { /* private mode */ }
}

export function loadSession(): LiveSession | null {
  try {
    const j = JSON.parse(localStorage.getItem(STORE) || 'null')
    if (!j || Date.now() - j.at > 12 * 60_000) return null     // the server forgets quiet people after 15 minutes
    return { room: j.room, me: j.me, key: j.key, color: j.color, name: j.name }
  } catch { return null }
}

/** ?live=CODE in the page address: an invitation to a group. */
export function liveCodeFromUrl(): string | null {
  try {
    const c = new URLSearchParams(location.search).get('live')
    return c && /^[A-Za-z0-9]{4,8}$/.test(c) ? c.toUpperCase() : null
  } catch { return null }
}

export function clearLiveCodeFromUrl() {
  try {
    const u = new URL(location.href)
    u.searchParams.delete('live')
    history.replaceState(null, '', u.pathname + (u.search || '') + u.hash)
  } catch { /* ignore */ }
}

export function liveLink(code: string): string {
  const base = typeof location !== 'undefined' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
    ? location.origin + import.meta.env.BASE_URL
    : 'https://vedhrishi.github.io/meta-maps/'
  const u = new URL(base)
  u.searchParams.set('live', code)
  return u.toString()
}

export const lastName = () => { try { return localStorage.getItem('gm-name') || '' } catch { return '' } }
export const saveName = (n: string) => { try { localStorage.setItem('gm-name', n) } catch { /* ignore */ } }

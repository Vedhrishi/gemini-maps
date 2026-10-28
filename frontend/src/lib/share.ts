/**
 * Sharing: a place or a trip as a link that opens Meta Maps with directions to it.
 * Uses the phone's share sheet when there is one (WhatsApp, SMS, Telegram...),
 * otherwise opens WhatsApp Web, otherwise copies to the clipboard.
 */

export type ShareResult = 'shared' | 'whatsapp' | 'copied' | 'cancelled' | 'failed'

const APP_URL = typeof location !== 'undefined' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1'
  ? location.origin + import.meta.env.BASE_URL
  : 'https://vedhrishi.github.io/meta-maps/'

/** A link that opens the app with this place as the destination. */
export function placeLink(lat: number, lng: number, label?: string): string {
  const u = new URL(APP_URL)
  u.searchParams.set('at', `${lat.toFixed(5)},${lng.toFixed(5)}`)
  if (label) u.searchParams.set('label', label.slice(0, 60))
  return u.toString()
}

export async function shareText(title: string, text: string, url: string): Promise<ShareResult> {
  const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> }
  if (nav.share) {
    try {
      await nav.share({ title, text, url })
      return 'shared'
    } catch (e: any) {
      if (e?.name === 'AbortError') return 'cancelled'
      // fall through to the other routes
    }
  }
  const full = `${text}\n${url}`
  const coarse = window.matchMedia?.('(pointer: coarse)').matches
  if (!coarse) {
    // 'noopener' would make window.open return null, so detach the opener by hand
    const w = window.open(`https://wa.me/?text=${encodeURIComponent(full)}`, '_blank')
    if (w) { try { w.opener = null } catch { /* cross-origin */ } return 'whatsapp' }
  }
  try {
    await navigator.clipboard.writeText(full)
    return 'copied'
  } catch {
    return 'failed'
  }
}

/** Read ?at=lat,lng&label=... from the page URL (a shared place). */
export function sharedPlaceFromUrl(): { name: string; sub: string; lat: number; lng: number } | null {
  try {
    const q = new URLSearchParams(location.search)
    const at = q.get('at')
    if (!at) return null
    const [lat, lng] = at.split(',').map(Number)
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null
    const label = (q.get('label') || '').replace(/[<>]/g, '').trim().slice(0, 60)
    return { name: label || 'Shared location', sub: 'Shared with you', lat, lng }
  } catch {
    return null
  }
}

/** Drop ?at= from the address bar once handled, so a reload does not re-plan. */
export function clearSharedPlaceFromUrl() {
  try {
    const u = new URL(location.href)
    if (!u.searchParams.has('at')) return
    u.searchParams.delete('at'); u.searchParams.delete('label')
    history.replaceState(null, '', u.pathname + (u.search ? u.search : '') + u.hash)
  } catch { /* ignore */ }
}

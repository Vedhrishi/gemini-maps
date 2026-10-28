const V = 'gm-v4'
const TILES = 'gm-tiles-v1'
const DATA = 'gm-data-v2' // place cells and street files: bump the number whenever the data is rebuilt
const SHELL = ['./', 'icon-192.png', 'manifest.webmanifest']
self.addEventListener('install', e => {
  e.waitUntil(caches.open(V).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== V && k !== TILES && k !== DATA).map(k => caches.delete(k)))).then(() => self.clients.claim()))
})
async function trim(name, max) {
  const c = await caches.open(name); const ks = await c.keys()
  if (ks.length > max) await Promise.all(ks.slice(0, ks.length - max).map(k => c.delete(k)))
}
self.addEventListener('fetch', e => {
  const r = e.request
  if (r.method !== 'GET') return
  const u = new URL(r.url)
  if (u.hostname.includes('openfreemap.org')) {
    e.respondWith(caches.open(TILES).then(async c => {
      const hit = await c.match(r)
      const net = fetch(r).then(res => { if (res.ok) { c.put(r, res.clone()); trim(TILES, 600) } return res }).catch(() => hit)
      return hit || net
    }))
    return
  }
  if (u.origin !== location.origin) return // routing, geocoding, API: always live
  if (u.pathname.includes('/data/')) {         // India place data: cache-first, so repeat searches cost nothing and work offline
    e.respondWith(caches.open(DATA).then(async c => {
      const hit = await c.match(r)
      if (hit) return hit
      const res = await fetch(r)
      if (res.ok) { c.put(r, res.clone()); trim(DATA, 80) }
      return res
    }))
    return
  }
  if (r.mode === 'navigate') {
    e.respondWith(fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put('./', cp)); return res }).catch(() => caches.match('./')))
    return
  }
  if (u.pathname.includes('/assets/')) {
    e.respondWith(caches.match(r).then(h => h || fetch(r).then(res => { const cp = res.clone(); caches.open(V).then(c => c.put(r, cp)); return res })))
  }
})

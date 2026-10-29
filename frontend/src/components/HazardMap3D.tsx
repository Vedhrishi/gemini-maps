/**
 * HazardMap3D — the primary map. Pitched camera, OSM buildings extruded to
 * their real heights, hazard markers standing on the surface.
 *
 * Buildings come from OpenFreeMap's OpenMapTiles vector tiles, extruded by the
 * schema's render_height (actual OSM `height` where mapped, otherwise derived
 * from building:levels). No API key, no quota.
 */

import { lastKnown } from '../hooks/useLocation'
import { useEffect, useRef, useState, useCallback } from 'react'
import maplibregl, { Map as MLMap, Marker, Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { HazardReport, API_URL } from '../lib/api'
import { darkStyle3d } from '../lib/mapStyle3d'
import { HAZARD_ICONS, HAZARD_LABELS, SEVERITY_COLORS, timeAgo } from '../lib/mapUtils'

type LngLatT = [number, number]

interface Props {
  reports: HazardReport[]
  focusId?: string | null
  newHazardId?: string | null
  onUpvote: (id: string) => void
  /** Active navigation route: selected line, alternatives, and a key that changes per plan */
  route?: { selected: LngLatT[]; alts: LngLatT[][]; key: string } | null
  /** Vehicle position during a trip */
  trip?: { pos: LngLatT; heading: number; follow: boolean } | null
  /** Called when the user drags the map during a trip (camera stops following) */
  onFollowBreak?: () => void
  /** Called when the camera should lock back onto the car (after the driver stops touching the map) */
  onFollowResume?: () => void
  /** The user's live position (blue dot) */
  me?: { lat: number; lng: number; heading: number | null; accuracy: number } | null
  /** Called by the locate button when there is no fix yet */
  onLocate?: () => void
  /** frame all hazards on load (only when the user's location is unavailable) */
  autoFit?: boolean
  /** People sharing their live location with you */
  friends?: { id: string; name: string; color: string; lat: number; lng: number; heading: number | null; speed: number | null }[]
}

const DEFAULT_PITCH = 55
const DEFAULT_BEARING = -18

const STEM = 18 // px of stem between the puck and the ground point

const SEV_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }
// Two pins overlap on screen when their tips are closer than this
const OVERLAP_X = 40
const OVERLAP_Y = 54
// Visual height of a pin above its ground point (largest puck + stem)
const PIN_UP = 42 + STEM

/** Cluster badge: same pin silhouette, carries the member count. */
function clusterEl(count: number, top: HazardReport['severity']): HTMLDivElement {
  const c = SEVERITY_COLORS[top] ?? '#00d4ff'
  const size = 48
  const el = document.createElement('div')
  el.className = 'hz-marker hz-cluster'
  el.style.cssText = `width:${size}px;height:${size + STEM}px;cursor:pointer;`
  el.innerHTML = `
    <div style="position:absolute;left:50%;bottom:0;transform:translate(-50%,40%);
                width:${size * 0.52}px;height:${size * 0.2}px;border-radius:50%;
                background:${c};opacity:.3;filter:blur(3px);"></div>
    <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);
                width:2px;height:${STEM}px;background:linear-gradient(to bottom, ${c}, ${c}22);"></div>
    <div style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;">
      <div style="position:absolute;inset:-9px;border-radius:50%;border:2px solid ${c};
                  opacity:.45;animation:hz-ping 2.2s ease-out infinite;"></div>
      <div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;
                  background:radial-gradient(circle at 35% 32%, ${c}ee, ${c}66);
                  border:2px solid #fff3;box-shadow:0 0 22px ${c}aa, 0 0 44px ${c}40,
                  inset 0 1px 0 rgba(255,255,255,.4);
                  display:flex;align-items:center;justify-content:center;
                  font:800 18px 'Space Grotesk',Inter,sans-serif;color:#050a14;">
        ${count}
      </div>
    </div>`
  return el
}

/**
 * Marker DOM: a glowing puck floating above a stem whose tip is the location.
 *
 * The element box deliberately includes the stem, and the marker is anchored
 * 'bottom' (see the Marker construction below). Anchoring the puck's centre
 * instead would leave the stem pointing at empty ground a few pixels below the
 * real coordinate — a constant screen offset that reads as the pins sliding
 * off their buildings whenever the map is panned, rotated or tilted.
 */
function markerEl(r: HazardReport, isNew: boolean): HTMLDivElement {
  const c = SEVERITY_COLORS[r.severity] ?? '#00d4ff'
  const urgent = r.severity === 'critical' || r.severity === 'high'
  const size = r.severity === 'critical' ? 42 : 36

  const el = document.createElement('div')
  el.className = 'hz-marker'
  // Box spans puck + stem; the very bottom edge is the ground point.
  // NB: never set `position` here — MapLibre's .maplibregl-marker is
  // position:absolute, and overriding it drops every marker into normal flow,
  // stacking them down the page and offsetting each one from its coordinate.
  el.style.cssText =
    `width:${size}px;height:${size + STEM}px;cursor:pointer;`
  el.innerHTML = `
    <!-- ground contact ellipse, sitting exactly on the anchor -->
    <div style="position:absolute;left:50%;bottom:0;transform:translate(-50%,40%);
                width:${size * 0.52}px;height:${size * 0.2}px;border-radius:50%;
                background:${c};opacity:.3;filter:blur(3px);"></div>
    <!-- stem down to the ground point -->
    <div style="position:absolute;left:50%;bottom:0;transform:translateX(-50%);
                width:2px;height:${STEM}px;
                background:linear-gradient(to bottom, ${c}, ${c}22);"></div>
    <!-- puck -->
    <div style="position:absolute;left:0;top:0;width:${size}px;height:${size}px;">
      ${urgent ? `
        <div style="position:absolute;inset:-9px;border-radius:50%;border:2px solid ${c};
                    opacity:.5;animation:hz-ping 1.9s ease-out infinite;"></div>` : ''}
      ${isNew ? `
        <div style="position:absolute;inset:-14px;border-radius:50%;border:2px solid ${c};
                    opacity:.75;animation:hz-ping 1s ease-out infinite;"></div>` : ''}
      <div style="position:relative;width:${size}px;height:${size}px;border-radius:50%;
                  background:radial-gradient(circle at 35% 32%, ${c}dd, ${c}55);
                  border:2px solid ${c};
                  box-shadow:0 0 18px ${c}99, 0 0 36px ${c}33,
                             inset 0 1px 0 rgba(255,255,255,.35);
                  display:flex;align-items:center;justify-content:center;
                  font-size:${r.severity === 'critical' ? 20 : 17}px;">
        ${HAZARD_ICONS[r.hazard_type] ?? '⚠️'}
      </div>
    </div>`
  return el
}

function popupHTML(r: HazardReport): string {
  const c = SEVERITY_COLORS[r.severity] ?? '#00d4ff'
  const esc = (s: string) =>
    String(s ?? '').replace(/[&<>"]/g, m =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[m] as string))
  return `
    <div style="min-width:244px;color:#e8f4ff;font-family:Inter,system-ui,sans-serif;">
      <div style="display:flex;align-items:center;gap:9px;margin-bottom:9px;">
        <span style="background:${c};color:#000;border-radius:5px;padding:3px 9px;
                     font-size:10px;font-weight:800;letter-spacing:.07em;
                     text-transform:uppercase;box-shadow:0 0 12px ${c}70;">
          ${esc(r.severity)}</span>
        <span style="font-weight:700;font-size:14px;font-family:'Space Grotesk',sans-serif;">
          ${esc(HAZARD_LABELS[r.hazard_type] ?? r.hazard_type)}</span>
      </div>
      <p style="font-size:12.5px;color:#9fc0dd;margin:0 0 10px;line-height:1.5;">
        ${esc(r.description)}</p>
      ${r.suggested_action ? `
        <div style="background:rgba(255,170,0,.08);border:1px solid rgba(255,170,0,.22);
                    border-radius:7px;padding:7px 10px;font-size:11.5px;color:#ffaa00;
                    margin-bottom:10px;">💡 ${esc(r.suggested_action)}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:10px;">
        <div>
          <div style="color:#4a6a8a;letter-spacing:.1em;text-transform:uppercase;font-size:9px;">
            Confidence</div>
          <div style="color:#00d4ff;font-weight:700;font-size:12px;">
            ${Math.round((r.confidence ?? 0) * 100)}%</div>
        </div>
        <div>
          <div style="color:#4a6a8a;letter-spacing:.1em;text-transform:uppercase;font-size:9px;">
            Coordinates</div>
          <div style="color:#7ab8ff;font-weight:600;font-size:11px;">
            ${r.lat.toFixed(4)}, ${r.lng.toFixed(4)}</div>
        </div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;
                  border-top:1px solid rgba(0,212,255,.1);padding-top:9px;">
        <span style="font-size:11px;color:#4a6a8a;">${esc(timeAgo(r.created_at))}</span>
        <button data-upvote="${esc(r.id)}"
          style="background:rgba(0,212,255,.08);color:#00d4ff;padding:5px 12px;
                 font-size:12px;font-weight:600;border:1px solid rgba(0,212,255,.22);
                 border-radius:8px;cursor:pointer;font-family:inherit;">
          ▲ Confirm · ${r.upvotes}</button>
      </div>
    </div>`
}

export function HazardMap3D({ reports, focusId, newHazardId, onUpvote, route, trip, onFollowBreak, onFollowResume, me, onLocate, autoFit = false, friends = [] }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MLMap | null>(null)
  const markersRef = useRef<Map<string, Marker>>(new Map())
  const clustersRef = useRef<Map<string, Marker>>(new Map())
  const carRef = useRef<Marker | null>(null)
  const meRef = useRef<Marker | null>(null)
  const lastFlownTo = useRef<[number, number] | null>(null)
  const centeredOnMe = useRef(false)
  const meLatest = useRef(me)
  useEffect(() => { meLatest.current = me }, [me])
  const followFlying = useRef(false)
  const tripActive = useRef(false)
  const routeRef = useRef<Props['route']>(route)
  const onFollowBreakRef = useRef(onFollowBreak)
  useEffect(() => { routeRef.current = route }, [route])
  useEffect(() => { onFollowBreakRef.current = onFollowBreak }, [onFollowBreak])
  const onFollowResumeRef = useRef(onFollowResume)
  useEffect(() => { onFollowResumeRef.current = onFollowResume }, [onFollowResume])
  const tripRef = useRef(trip)
  useEffect(() => { tripRef.current = trip }, [trip])
  // The follow camera stays out of the way while the driver is moving the map themselves
  const busyUntil = useRef(0)
  const resumeTimer = useRef<number | null>(null)
  const wasFollowing = useRef(false)
  const firstFollow = useRef(true)
  const scheduleResume = useCallback((ms = 12000) => {
    if (resumeTimer.current) window.clearTimeout(resumeTimer.current)
    resumeTimer.current = window.setTimeout(() => {
      resumeTimer.current = null
      const t = tripRef.current
      if (t && !t.follow) onFollowResumeRef.current?.()
    }, ms)
  }, [])
  useEffect(() => () => { if (resumeTimer.current) window.clearTimeout(resumeTimer.current) }, [])
  const reportsRef = useRef<HazardReport[]>(reports)
  const rafRef = useRef<number | null>(null)
  const fittedRef = useRef(false)
  const [ready, setReady] = useState(false)
  // TomTom live traffic on the roads (green, amber, red). On by default; the choice is remembered.
  const [traffic, setTraffic] = useState<boolean>(() => { try { return localStorage.getItem('gm-traffic') !== '0' } catch { return true } })
  const [failed, setFailed] = useState(false)
  const [pitch, setPitch] = useState(DEFAULT_PITCH)

  // Keep latest handler without re-running map setup
  useEffect(() => { reportsRef.current = reports }, [reports])
  const onUpvoteRef = useRef(onUpvote)
  useEffect(() => { onUpvoteRef.current = onUpvote }, [onUpvote])

  // ── Declutter: merge pins that would overlap on screen ──────────────────
  const declutter = useCallback(() => {
    const map = mapRef.current
    if (!map) return
    const items = [...reportsRef.current].sort(
      (a, b) => (SEV_RANK[b.severity] ?? 0) - (SEV_RANK[a.severity] ?? 0))

    // Greedy: most severe pin leads a group; later pins within its footprint join it
    const groups: { lead: { x: number; y: number }; members: HazardReport[] }[] = []
    for (const r of items) {
      const p = map.project([r.lng, r.lat])
      const g = groups.find(
        q => Math.abs(q.lead.x - p.x) < OVERLAP_X && Math.abs(q.lead.y - p.y) < OVERLAP_Y)
      if (g) g.members.push(r)
      else groups.push({ lead: { x: p.x, y: p.y }, members: [r] })
    }

    const keep = new Set<string>()
    for (const g of groups) {
      if (g.members.length === 1) {
        const m = markersRef.current.get(g.members[0].id)
        if (m) m.getElement().style.display = ''
        continue
      }
      g.members.forEach(r => {
        const m = markersRef.current.get(r.id)
        if (m) { m.getElement().style.display = 'none'; m.getPopup()?.remove() }
      })
      const key = g.members.map(r => r.id).sort().join('|') + ':' + g.members[0].severity
      keep.add(key)
      if (!clustersRef.current.has(key)) {
        const lng = g.members.reduce((s, r) => s + r.lng, 0) / g.members.length
        const lat = g.members.reduce((s, r) => s + r.lat, 0) / g.members.length
        const el = clusterEl(g.members.length, g.members[0].severity)
        el.title = `${g.members.length} hazards here — click to zoom in`
        el.addEventListener('click', () => {
          const b = new maplibregl.LngLatBounds()
          g.members.forEach(r => b.extend([r.lng, r.lat]))
          map.fitBounds(b, {
            padding: { top: 140, bottom: 150, left: 120, right: 120 },
            maxZoom: 18, duration: 900,
          })
        })
        const mk = new maplibregl.Marker({
          element: el, anchor: 'bottom', pitchAlignment: 'viewport', rotationAlignment: 'viewport',
        }).setLngLat([lng, lat]).addTo(map)
        clustersRef.current.set(key, mk)
      }
    }
    clustersRef.current.forEach((mk, key) => {
      if (!keep.has(key)) { mk.remove(); clustersRef.current.delete(key) }
    })
  }, [])

  const scheduleDeclutter = useCallback(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; declutter() })
  }, [declutter])

  // ── Fit: bring every pin fully on screen under the current tilt ─────────
  const fitScreen = useCallback((iter = 0) => {
    const map = mapRef.current
    const list = reportsRef.current
    if (!map || list.length === 0) return
    const cv = map.getCanvas()
    const W = cv.clientWidth, H = cv.clientHeight
    const pad = { l: 56, r: 56, t: 78, b: 70 }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity
    for (const r of list) {
      const p = map.project([r.lng, r.lat])
      minX = Math.min(minX, p.x - 24); maxX = Math.max(maxX, p.x + 24)
      minY = Math.min(minY, p.y - PIN_UP); maxY = Math.max(maxY, p.y + 8)
    }
    const availW = W - pad.l - pad.r, availH = H - pad.t - pad.b
    const scale = Math.min(availW / Math.max(1, maxX - minX), availH / Math.max(1, maxY - minY))
    const MIN_ZOOM = 13.4
    const z = map.getZoom()
    const dz = scale < 1 ? Math.max(Math.log2(scale), MIN_ZOOM - z) : 0

    // Move the pin cluster's visual centre to the centre of the safe area
    const dx = (minX + maxX) / 2 - (pad.l + (W - pad.r)) / 2
    const dy = (minY + maxY) / 2 - (pad.t + (H - pad.b)) / 2
    if (location.search.includes('debug')) console.log('[fit]', iter, JSON.stringify({ W, H, z, dz, dx, dy, scale, minX, maxX, minY, maxY }))
    const settled = Math.abs(dz) < 0.03 && Math.abs(dx) < 10 && Math.abs(dy) < 10
    if (settled || iter >= 4) return

    map.once('moveend', () => fitScreen(iter + 1))
    map.easeTo({
      center: map.unproject([W / 2 + dx, H / 2 + dy]),
      zoom: z + dz,
      duration: iter === 0 ? 900 : 500,
    })
  }, [])

  // ── Route framing ────────────────────────────────────────────────────────
  const fitRoute = useCallback((duration = 1400) => {
    const map = mapRef.current
    const r = routeRef.current
    if (!map || !r || r.selected.length < 2) return
    const b = new maplibregl.LngLatBounds()
    r.selected.forEach(c => b.extend(c))
    const narrow = map.getCanvas().clientWidth < 700
    map.fitBounds(b, {
      padding: { top: narrow ? 150 : 110, bottom: 180, left: 60, right: 60 },
      pitch: 40, bearing: 0, duration, maxZoom: 16.5,
    })
  }, [])

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return

    const startAt = lastKnown()
    let map: MLMap
    try {
      map = new maplibregl.Map({
        container: containerRef.current,
        style: darkStyle3d,
        // open where the device was last seen, else a view of all India: never a fixed city
        center: startAt ? [startAt.lng, startAt.lat] : [79.0, 22.5],
        zoom: startAt ? 14.2 : 4.3,
        pitch: startAt ? DEFAULT_PITCH : 0,
        maxPitch: 75,
        bearing: DEFAULT_BEARING,
        canvasContextAttributes: { antialias: true },
        attributionControl: { compact: true },
      })
    } catch {
      // WebGL unavailable (old device, software rendering blocked)
      setFailed(true)
      return
    }

    mapRef.current = map
    if (location.search.includes('debug')) { (window as any).__gmap = map; (window as any).__gm = markersRef.current; (window as any).__gc = clustersRef.current }
    map.addControl(new maplibregl.NavigationControl({ visualizePitch: true }), 'top-left')
    map.on('load', () => {
      const empty = { type: 'FeatureCollection', features: [] } as any
      map.addSource('route-alt', { type: 'geojson', data: empty })
      map.addSource('route', { type: 'geojson', data: empty })
      const before = map.getLayer('road-label') ? 'road-label' : undefined
      const round = { 'line-cap': 'round', 'line-join': 'round' } as any
      const w = (a: number, b: number) =>
        ['interpolate', ['linear'], ['zoom'], 6, a * 0.5, 12, a, 17, b] as any
      map.addLayer({ id: 'route-alt', type: 'line', source: 'route-alt', layout: round,
        paint: { 'line-color': '#6e93b8', 'line-width': w(3, 7), 'line-opacity': 0.75 } }, before)
      map.addLayer({ id: 'route-glow', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': '#00d4ff', 'line-width': w(10, 30), 'line-opacity': 0.2, 'line-blur': 8 } }, before)
      map.addLayer({ id: 'route-casing', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': '#021428', 'line-width': w(6, 16) } }, before)
      map.addLayer({ id: 'route-line', type: 'line', source: 'route', layout: round,
        paint: { 'line-color': '#19d3ff', 'line-width': w(3.5, 10) } }, before)
      map.addLayer({ id: 'route-flow', type: 'line', source: 'route', layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-width': w(1.6, 4), 'line-opacity': 0.9, 'line-dasharray': [0, 4, 3] } }, before)
      // TomTom traffic flow, fetched through our server (the key stays there). Hidden layers load nothing.
      map.addSource('tomtom-flow', {
        type: 'raster', tiles: [`${API_URL}/api/traffic/tile/{z}/{x}/{y}.png`], tileSize: 256, minzoom: 7, maxzoom: 16,
        attribution: 'Traffic © <a href="https://www.tomtom.com" target="_blank" rel="noopener">TomTom</a>',
      })
      map.addLayer({ id: 'tomtom-flow', type: 'raster', source: 'tomtom-flow',
        layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.9, 'raster-fade-duration': 150 } }, 'route-alt')
      setReady(true)
    })
    // Moving the map yourself takes the camera back from the trip follower (like Google Maps):
    // panning or rotating pauses follow, pinch-zoom and tilt keep following at the new angle.
    // Programmatic moves carry no originalEvent, so only real touches count here.
    const userMove = (e: any) => {
      if (!e?.originalEvent) return
      busyUntil.current = Date.now() + 2500
      const t = tripRef.current
      if (t?.follow && (e.type === 'dragstart' || e.type === 'rotatestart')) onFollowBreakRef.current?.()
      if (t) scheduleResume()
    }
    if (location.search.includes('debug=1')) (window as any).__gmMap = map
    map.on('dragstart', userMove)
    map.on('rotatestart', userMove)
    map.on('zoomstart', userMove)
    map.on('pitchstart', userMove)
    map.on('dragend', userMove)
    map.on('zoomend', userMove)
    map.on('move', () => scheduleDeclutter())
    map.on('error', e => {
      // Tile 404s are routine at the edges; only a style failure is fatal
      if ((e as any)?.error?.status === 404) return
    })

    return () => {
      markersRef.current.forEach(m => m.remove())
      markersRef.current.clear()
      clustersRef.current.forEach(m => m.remove())
      clustersRef.current.clear()
      carRef.current?.remove(); carRef.current = null
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
      map.remove()
      mapRef.current = null
    }
  }, [scheduleDeclutter])

  // ── Sync markers ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return

    const live = new Set(reports.map(r => r.id))

    // Remove markers whose report is gone
    markersRef.current.forEach((marker, id) => {
      if (!live.has(id)) { marker.remove(); markersRef.current.delete(id) }
    })

    for (const r of reports) {
      const existing = markersRef.current.get(r.id)
      // Popup clears the whole pin (puck + stem), measured from the ground anchor
      const pinH = (r.severity === 'critical' ? 42 : 36) + STEM
      const popup = new maplibregl.Popup({
        offset: [0, -pinH + 4], closeButton: false, maxWidth: '300px', className: 'hz-popup',
      }).setHTML(popupHTML(r))

      // Wire the upvote button each time the popup opens
      popup.on('open', () => {
        const btn = popup.getElement()?.querySelector<HTMLButtonElement>('[data-upvote]')
        btn?.addEventListener('click', () => onUpvoteRef.current(r.id), { once: true })
      })

      if (existing) {
        existing.setLngLat([r.lng, r.lat]).setPopup(popup)
      } else {
        const marker = new maplibregl.Marker({
          element: markerEl(r, r.id === newHazardId),
          // Pin tip, not puck centre, sits on the coordinate
          anchor: 'bottom',
          // Keep pins upright and ground-locked as the camera tilts and rotates
          pitchAlignment: 'viewport',
          rotationAlignment: 'viewport',
        })
          .setLngLat([r.lng, r.lat])
          .setPopup(popup)
          .addTo(map)
        markersRef.current.set(r.id, marker)
      }
    }
    declutter()
  }, [reports, ready, newHazardId, declutter])

  // ── Frame the hazards once ──────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !autoFit || fittedRef.current || centeredOnMe.current || reports.length === 0) return
    fittedRef.current = true

    if (reports.length === 1) {
      map.flyTo({ center: [reports[0].lng, reports[0].lat], zoom: 16, pitch: DEFAULT_PITCH, duration: 2200 })
      return
    }
    const b = new maplibregl.LngLatBounds()
    reports.forEach(r => b.extend([r.lng, r.lat]))
    // Extra bottom padding: under pitch the near field occupies more screen,
    // so a symmetric fit clips the southernmost markers off the bottom edge.
    const cam = map.cameraForBounds(b, {
      padding: { top: 90, bottom: 170, left: 90, right: 90 },
      maxZoom: 16.5,
    })

    // OSM building geometry only exists in tiles from z13 up. If the spread of
    // hazards would fit at a wider zoom than that we'd settle on a flat map
    // with no 3D at all — so floor the zoom and accept clipping an outlier.
    const MIN_BUILDING_ZOOM = 14.2
    const restZoom = Math.max(cam?.zoom ?? 15, MIN_BUILDING_ZOOM)
    const center = cam?.center ?? b.getCenter()

    // Opening flight: drop in low and close among the buildings, then rise and
    // rotate out to the overview. Shows the 3D massing up close before settling
    // somewhere you can actually read the whole hazard network.
    map.jumpTo({ center, zoom: Math.max(restZoom + 1.9, 16.1), pitch: 67, bearing: -46 })
    map.easeTo({
      center, zoom: restZoom, pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING,
      duration: 6200,
      easing: t => 1 - Math.pow(1 - t, 3), // easeOutCubic — fast out, long settle
    })
    // Once the flight lands, make sure every pin is actually on screen
    map.once('moveend', e => { if (!(e as any).originalEvent) fitScreen(0) })
  }, [reports, ready, fitScreen, autoFit])

  // ── Route drawing ────────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const fc = (lines: LngLatT[][]) => ({
      type: 'FeatureCollection',
      features: lines.map(c => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: c } })),
    }) as any
    ;(map.getSource('route') as maplibregl.GeoJSONSource | undefined)?.setData(fc(route ? [route.selected] : []))
    ;(map.getSource('route-alt') as maplibregl.GeoJSONSource | undefined)?.setData(fc(route ? route.alts : []))
  }, [route, ready])

  useEffect(() => { tripActive.current = !!trip }, [trip])

  // Frame the route once per plan (not on every alternative switch)
  const lastRouteKey = useRef<string | null>(null)
  useEffect(() => {
    if (!ready) return
    if (!route) { lastRouteKey.current = null; return }
    if (route.key === lastRouteKey.current) return
    lastRouteKey.current = route.key
    if (tripActive.current) return // a mid-drive reroute must not yank the camera back
    fittedRef.current = true // the hazard framing no longer applies
    fitRoute(1600)
  }, [route, ready, fitRoute])

  // Animated "flow" along the route
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !route) return
    const seq = [
      [0, 4, 3], [0.5, 4, 2.5], [1, 4, 2], [1.5, 4, 1.5], [2, 4, 1], [2.5, 4, 0.5], [3, 4, 0],
      [0, 0.5, 3, 3.5], [0, 1, 3, 3], [0, 1.5, 3, 2.5], [0, 2, 3, 2], [0, 2.5, 3, 1.5], [0, 3, 3, 1], [0, 3.5, 3, 0.5],
    ]
    let i = 0
    const id = setInterval(() => {
      if (!map.getLayer('route-flow')) return
      i = (i + 1) % seq.length
      map.setPaintProperty('route-flow', 'line-dasharray', seq[i])
    }, 90)
    return () => clearInterval(id)
  }, [route, ready])

  // "You are here": blue dot with heading arrow; centre on it the first time a fix arrives
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!me) { meRef.current?.remove(); meRef.current = null; return }
    if (!meRef.current) {
      const el = document.createElement('div')
      el.className = 'hz-me'
      el.style.cssText = 'width:22px;height:22px;'
      el.innerHTML = `
        <div class="hz-me-pulse" style="position:absolute;inset:-14px;border-radius:50%;background:rgba(66,133,244,.28);animation:hz-ping 2.4s ease-out infinite;"></div>
        <div class="hz-me-arrow" style="position:absolute;left:50%;top:-13px;width:0;height:0;margin-left:-7px;border-left:7px solid transparent;border-right:7px solid transparent;border-bottom:13px solid #4285f4;display:none;"></div>
        <div style="position:absolute;inset:0;border-radius:50%;background:#4285f4;border:3px solid #fff;box-shadow:0 0 0 1px rgba(0,0,0,.25),0 2px 8px rgba(0,0,0,.5);"></div>`
      meRef.current = new maplibregl.Marker({ element: el, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map' })
        .setLngLat([me.lng, me.lat]).addTo(map)
    }
    meRef.current.setLngLat([me.lng, me.lat])
    const el = meRef.current.getElement()
    const arrow = el.querySelector('.hz-me-arrow') as HTMLElement | null
    if (arrow) arrow.style.display = me.heading != null ? 'block' : 'none'
    meRef.current.setRotation(me.heading ?? 0)
    // hide behind the car while driving
    el.style.display = tripActive.current ? 'none' : ''
    // Fly to the user on the first fix, and again whenever their location jumps far (a new place was chosen)
    const last = lastFlownTo.current
    const jumped = !!last && Math.hypot((me.lng - last[0]) * Math.cos(me.lat * Math.PI / 180), me.lat - last[1]) * 111 > 2
    if ((!centeredOnMe.current || jumped) && !routeRef.current && !tripActive.current && (jumped || !focusId)) {
      centeredOnMe.current = true
      fittedRef.current = true
      lastFlownTo.current = [me.lng, me.lat]
      map.flyTo({ center: [me.lng, me.lat], zoom: 14.8, pitch: DEFAULT_PITCH, duration: 1800 })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [me?.lat, me?.lng, me?.heading, ready, !!trip])

  // Traffic layer on or off
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !map.getLayer('tomtom-flow')) return
    map.setLayoutProperty('tomtom-flow', 'visibility', traffic ? 'visible' : 'none')
    try { localStorage.setItem('gm-traffic', traffic ? '1' : '0') } catch { /* private mode */ }
  }, [traffic, ready])

  // People sharing their live location: a coloured marker with their name, sliding between updates
  const friendRefs = useRef<Map<string, Marker>>(new Map())
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const seen = new Set<string>()
    for (const f of friends) {
      seen.add(f.id)
      let mk = friendRefs.current.get(f.id)
      if (!mk) {
        const el = document.createElement('div')
        el.className = 'hz-friend'
        el.style.cssText = 'position:relative;width:34px;height:34px;transition:none;'
        el.innerHTML = `
          <div class="hz-f-pulse" style="position:absolute;inset:-8px;border-radius:50%;background:${f.color}33;animation:hz-ping 2.2s ease-out infinite;"></div>
          <div class="hz-f-dot" style="position:absolute;inset:0;border-radius:50%;background:${f.color};border:3px solid #fff;box-shadow:0 2px 10px rgba(0,0,0,.6);display:grid;place-items:center;color:#06101c;font:800 14px var(--font2,system-ui);"></div>
          <div class="hz-f-name" style="position:absolute;left:50%;top:40px;transform:translateX(-50%);white-space:nowrap;padding:2px 8px;border-radius:8px;background:rgba(2,6,22,.92);border:1px solid ${f.color};color:#fff;font:700 11px system-ui;"></div>`
        mk = new maplibregl.Marker({ element: el, anchor: 'center' }).setLngLat([f.lng, f.lat]).addTo(map)
        friendRefs.current.set(f.id, mk)
      }
      const el = mk.getElement()
      ;(el.querySelector('.hz-f-dot') as HTMLElement).textContent = (f.name[0] || '?').toUpperCase()
      ;(el.querySelector('.hz-f-name') as HTMLElement).textContent = f.name + (f.speed != null && f.speed > 3 ? ` · ${f.speed} km/h` : '')
      mk.setLngLat([f.lng, f.lat])
    }
    friendRefs.current.forEach((mk, id) => { if (!seen.has(id)) { mk.remove(); friendRefs.current.delete(id) } })
  }, [friends, ready])
  useEffect(() => () => { friendRefs.current.forEach(m => m.remove()); friendRefs.current.clear() }, [])

  // Vehicle marker + follow camera
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    if (!trip) {
      carRef.current?.remove(); carRef.current = null
      wasFollowing.current = false; firstFollow.current = true
      if (resumeTimer.current) { window.clearTimeout(resumeTimer.current); resumeTimer.current = null }
      return
    }
    if (!carRef.current) {
      const el = document.createElement('div')
      el.className = 'hz-car'
      el.style.cssText = 'width:38px;height:38px;'
      el.innerHTML = `
        <div style="position:absolute;inset:-16px;border-radius:50%;
             background:radial-gradient(circle,rgba(0,212,255,.45),transparent 68%);"></div>
        <svg viewBox="0 0 38 38" width="38" height="38" style="position:relative;filter:drop-shadow(0 0 8px #19d3ff)">
          <polygon points="19,3 32,33 19,26 6,33" fill="#19d3ff" stroke="#fff" stroke-width="2.2" stroke-linejoin="round"/>
        </svg>`
      carRef.current = new maplibregl.Marker({
        element: el, anchor: 'center', rotationAlignment: 'map', pitchAlignment: 'map',
      }).setLngLat(trip.pos).addTo(map)
    }
    carRef.current.setLngLat(trip.pos).setRotation(trip.heading)
    if (trip.follow) {
      const justStarted = !wasFollowing.current
      wasFollowing.current = true
      const fly = (opts: maplibregl.EaseToOptions & { duration: number }) => {
        followFlying.current = true
        const done = () => { followFlying.current = false }
        map.once('moveend', done)
        window.setTimeout(done, opts.duration + 400)
        map.easeTo(opts)
      }
      if (justStarted) {
        // One smooth glide to the driving view at the start of the trip or on Re-center.
        // After the first time, the driver's own zoom and tilt are kept.
        const z = map.getZoom()
        const first = firstFollow.current
        firstFollow.current = false
        fly({
          center: trip.pos, bearing: trip.heading,
          pitch: first ? 62 : map.getPitch(),
          zoom: first || z < 14.8 ? 16.4 : Math.min(17.8, z),
          duration: first ? 1600 : 900,
        })
      } else if (!followFlying.current && Date.now() > busyUntil.current) {
        // Re-issuing a long ease on every tick would make the camera chase the car,
        // so follow with a short linear ease and leave zoom and tilt where the driver put them.
        map.easeTo({
          center: trip.pos, bearing: trip.heading, pitch: map.getPitch(),
          zoom: Math.min(17.8, map.getZoom()), duration: 240, easing: t => t,
        })
      }
    } else {
      wasFollowing.current = false
    }
  }, [trip, ready])

  // ── Fly to a focused hazard ─────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !focusId) return
    const r = reports.find(x => x.id === focusId)
    if (!r) return
    map.flyTo({ center: [r.lng, r.lat], zoom: 17, pitch: 62, duration: 2000, essential: true })
    // Open the popup once the camera lands — mid-flight the pin may still be
    // merged into a cluster, and a hidden pin can't hold a popup.
    map.once('moveend', () => {
      const m = markersRef.current.get(r.id)
      if (m && m.getElement().style.display !== 'none' && !m.getPopup()?.isOpen()) m.togglePopup()
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusId, ready])

  // "Pick on map": the next tap on the map sets the user's location
  const [picking, setPicking] = useState(false)
  useEffect(() => {
    const on = () => setPicking(true)
    window.addEventListener('gm:pick', on)
    return () => window.removeEventListener('gm:pick', on)
  }, [])
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready || !picking) return
    const canvas = map.getCanvas()
    const prev = canvas.style.cursor
    canvas.style.cursor = 'crosshair'
    const click = (e: maplibregl.MapMouseEvent) => {
      window.dispatchEvent(new CustomEvent('gm:picked', { detail: { lat: e.lngLat.lat, lng: e.lngLat.lng } }))
      setPicking(false)
    }
    map.once('click', click)
    return () => { canvas.style.cursor = prev; map.off('click', click) }
  }, [picking, ready])

  const setView = useCallback((p: number) => {
    setPitch(p)
    busyUntil.current = Date.now() + 1200
    mapRef.current?.easeTo({ pitch: p, duration: 700 })
  }, [])

  const locateMe = useCallback(() => {
    const map = mapRef.current
    const m = meLatest.current
    if (!map) return
    if (!m) { onLocate?.(); return }
    map.flyTo({ center: [m.lng, m.lat], zoom: Math.max(map.getZoom(), 15.2), duration: 900 })
  }, [onLocate])

  // Voice / external camera commands
  useEffect(() => {
    const on = (e: Event) => {
      const map = mapRef.current
      if (!map) return
      const detail = (e as CustomEvent).detail
      if (detail && typeof detail === 'object' && Array.isArray(detail.fly)) {
        busyUntil.current = Date.now() + 2500
        if (tripRef.current?.follow) onFollowBreakRef.current?.()
        map.flyTo({ center: detail.fly as [number, number], zoom: Math.max(map.getZoom(), 15), duration: 1100 })
        return
      }
      const act = detail as string
      if (act === 'zoomIn') map.zoomIn({ duration: 500 })
      else if (act === 'zoomOut') map.zoomOut({ duration: 500 })
      else if (act === 'top') setView(0)
      else if (act === 'tilt') setView(55)
      else if (act === 'street') setView(72)
      else if (act === 'north') map.easeTo({ bearing: 0, duration: 600 })
      else if (act === 'locate') locateMe()
      else if (act === 'fit') {
        if (routeRef.current) {
          if (tripRef.current?.follow) onFollowBreakRef.current?.()
          if (tripRef.current) scheduleResume(45000)
          fitRoute(900)
        } else { setPitch(DEFAULT_PITCH); map.once('moveend', () => fitScreen(0)); map.easeTo({ pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 600 }) }
      }
    }
    window.addEventListener('gm:map', on)
    return () => window.removeEventListener('gm:map', on)
  }, [setView, fitRoute, fitScreen, locateMe])

  if (failed) {
    return (
      <div style={{
        height: '100%', display: 'grid', placeItems: 'center',
        color: 'var(--text2)', padding: 32, textAlign: 'center',
      }}>
        <div>
          <div style={{ fontSize: 34, marginBottom: 12 }}>🗺</div>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>3D view unavailable</div>
          <div style={{ fontSize: 12, color: 'var(--text3)' }}>
            This device or browser has WebGL disabled. Switch to the 2D map.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      <div ref={containerRef} style={{ height: '100%', width: '100%' }} />

      {/* HUD corner brackets */}
      {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
        <div key={c} style={{
          position: 'absolute', zIndex: 5, pointerEvents: 'none',
          top: c[0] === 't' ? 14 : undefined,
          bottom: c[0] === 'b' ? 14 : undefined,
          left: c[1] === 'l' ? 14 : undefined,
          right: c[1] === 'r' ? 14 : undefined,
          width: 26, height: 26,
          borderTop: c[0] === 't' ? '2px solid rgba(0,212,255,.3)' : 'none',
          borderBottom: c[0] === 'b' ? '2px solid rgba(0,212,255,.3)' : 'none',
          borderLeft: c[1] === 'l' ? '2px solid rgba(0,212,255,.3)' : 'none',
          borderRight: c[1] === 'r' ? '2px solid rgba(0,212,255,.3)' : 'none',
        }} />
      ))}

      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 4, pointerEvents: 'none',
        boxShadow: 'inset 0 0 130px rgba(0,8,20,.8)',
      }} />

      {/* Locate me */}
      {!trip && (
        <button onClick={locateMe} title="Show my location" aria-label="Show my location" style={{
          position: 'absolute', left: 14, bottom: 'calc(66px + var(--sab))', zIndex: 6, height: 44, padding: '0 14px 0 11px', borderRadius: 22,
          background: 'rgba(2,6,22,.92)', border: `1px solid ${me ? 'rgba(66,133,244,.6)' : 'rgba(0,212,255,.25)'}`,
          color: me ? '#8ab4ff' : 'var(--text3)', display: 'flex', alignItems: 'center', gap: 8,
          fontSize: 13, fontWeight: 700, boxShadow: '0 6px 20px rgba(0,0,0,.45)',
        }}>
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <circle cx="12" cy="12" r="3.2" fill="currentColor" /><circle cx="12" cy="12" r="7.5" />
            <path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3" />
          </svg>
          My location
        </button>
      )}

      {picking && (
        <div style={{
          position: 'absolute', left: '50%', top: 70, transform: 'translateX(-50%)', zIndex: 8,
          background: 'rgba(2,6,22,.95)', border: '1px solid rgba(66,133,244,.6)', color: '#cfe0ff',
          borderRadius: 12, padding: '10px 14px', fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
          display: 'flex', alignItems: 'center', gap: 10,
        }}>
          Tap the map to set your location
          <button onClick={() => setPicking(false)} style={{ background: 'transparent', border: 'none', color: '#8ab4ff', fontWeight: 700 }}>Cancel</button>
        </div>
      )}

      {/* Pitch control */}
      <div style={{
        position: 'absolute', top: 14, right: 14, zIndex: 6,
        display: 'flex', gap: 4, background: 'rgba(2,6,22,.86)',
        border: '1px solid rgba(0,212,255,.16)',
        borderRadius: 10, padding: 4,
      }}>
        <button
          onClick={() => {
            const map = mapRef.current
            if (!map) return
            if (routeRef.current) {
              if (tripRef.current?.follow) onFollowBreakRef.current?.()
              if (tripRef.current) scheduleResume(45000)
              fitRoute(900); return
            }
            setPitch(DEFAULT_PITCH)
            map.once('moveend', () => fitScreen(0))
            map.easeTo({ pitch: DEFAULT_PITCH, bearing: DEFAULT_BEARING, duration: 600 })
          }}
          title={route ? 'Fit the route on screen' : 'Fit all hazards on screen'}
          style={{
            background: 'transparent', color: 'var(--accent)', border: 'none',
            borderRadius: 7, padding: '5px 9px', fontSize: 10.5, fontWeight: 700,
            letterSpacing: '.07em', textTransform: 'uppercase', fontFamily: 'var(--font2)',
          }}
        >⌖ Fit</button>
        {([['Top', 0], ['Tilt', 55], ['Street', 72]] as const).map(([label, p]) => (
          <button
            key={label}
            onClick={() => setView(p)}
            style={{
              background: Math.abs(pitch - p) < 6 ? 'rgba(0,212,255,.15)' : 'transparent',
              color: Math.abs(pitch - p) < 6 ? 'var(--accent)' : 'var(--text3)',
              border: 'none', borderRadius: 7, padding: '5px 11px',
              fontSize: 10.5, fontWeight: 700, letterSpacing: '.07em',
              textTransform: 'uppercase', fontFamily: 'var(--font2)',
            }}
          >{label}</button>
        ))}
      </div>

      {/* Live traffic from TomTom */}
      <button
        onClick={() => setTraffic(t => !t)}
        aria-pressed={traffic}
        title={traffic ? 'Hide live traffic' : 'Show live traffic'}
        style={{
          position: 'absolute', top: 58, right: 14, zIndex: 6, display: 'flex', alignItems: 'center', gap: 8,
          padding: '7px 11px', borderRadius: 10, fontSize: 11.5, fontWeight: 700,
          background: traffic ? 'rgba(0,212,255,.14)' : 'rgba(2,6,22,.86)',
          border: `1px solid ${traffic ? 'rgba(0,212,255,.55)' : 'rgba(0,212,255,.16)'}`,
          color: traffic ? 'var(--accent)' : 'var(--text3)',
        }}
      >
        <span aria-hidden>🚦</span>Traffic
        {traffic && <span style={{ width: 38, height: 6, borderRadius: 3, background: 'linear-gradient(90deg,#1fd16b,#ffc233,#ff4d3d,#b3122a)' }} aria-label="Free flowing to stopped" />}
      </button>
      {traffic && (
        <div style={{ position: 'absolute', top: 94, right: 14, zIndex: 6, fontSize: 10, color: 'var(--text3)', textAlign: 'right', pointerEvents: 'none' }}>
          Live traffic by TomTom
        </div>
      )}

      {!ready && (
        <div style={{
          position: 'absolute', inset: 0, zIndex: 7, display: 'grid',
          placeItems: 'center', background: 'rgba(4,8,18,.9)', pointerEvents: 'none',
        }}>
          <div style={{ textAlign: 'center' }}>
            <div style={{
              width: 34, height: 34, margin: '0 auto 12px',
              border: '2px solid rgba(0,212,255,.18)', borderTopColor: 'var(--accent)',
              borderRadius: '50%', animation: 'hz-spin .9s linear infinite',
            }} />
            <div style={{ fontSize: 11.5, color: 'var(--text3)', letterSpacing: '.12em', textTransform: 'uppercase' }}>
              Building 3D terrain
            </div>
          </div>
        </div>
      )}

      <style>{`
        @keyframes hz-ping { 0%{transform:scale(1);opacity:.7} 100%{transform:scale(2.1);opacity:0} }
        @keyframes hz-spin { to { transform: rotate(360deg) } }
        .hz-popup .maplibregl-popup-content {
          background: rgba(4,10,20,.96);
          border: 1px solid rgba(0,212,255,.22);
          border-radius: 14px; padding: 14px 16px;
          box-shadow: 0 16px 48px rgba(0,0,0,.8);
        }
        .hz-popup .maplibregl-popup-tip { border-top-color: rgba(4,10,20,.96) !important; }
        .maplibregl-ctrl-group {
          background: rgba(4,10,24,.9) !important;
          border: 1px solid rgba(0,212,255,.18) !important;
          border-radius: 10px !important; overflow: hidden;
        }
        .maplibregl-ctrl-group button { background: transparent !important; }
        .maplibregl-ctrl-group button + button { border-top: 1px solid rgba(0,212,255,.1) !important; }
        .maplibregl-ctrl-group button span { filter: invert(1) hue-rotate(180deg) brightness(1.4); }
        .maplibregl-ctrl-attrib {
          background: rgba(4,8,16,.7) !important;
        }
        .maplibregl-ctrl-attrib a { color: #4a6a8a !important; }
      `}</style>
    </div>
  )
}

import { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react'
const HazardMap = lazy(() => import('./components/HazardMap').then(m => ({ default: m.HazardMap })))

// MapLibre is ~900 kB — far and away the largest dependency. Splitting it out
// lets the shell and boot sequence paint immediately while the 3D engine
// streams in behind the intro animation, instead of blocking first paint.
const loadMap3D = () => import('./components/HazardMap3D').then(m => ({ default: m.HazardMap3D }))
const HazardMap3D = lazy(loadMap3D)
// start streaming the engine immediately, in parallel with the boot animation
loadMap3D()
import { ReportPanel } from './components/ReportPanel'
import { HazardList } from './components/HazardList'
import { AboutSheet } from './components/AboutSheet'
import { SosSheet } from './components/SosSheet'
import { TelemetryBar } from './components/TelemetryBar'
import { BootSequence } from './components/BootSequence'
import { VoiceHUD } from './components/VoiceHUD'
import { NavPanel } from './components/NavPanel'
import { InstallHint } from './components/InstallHint'
import { useWakeLock } from './hooks/useWakeLock'
import { TripHUD } from './components/TripHUD'
import { useNavigation } from './hooks/useNavigation'
import { haversine, searchPlaces, DEMO_TRIPS, divergencePoint, fetchRoutes, pointAt, Route, fmtKm, fmtDur, clock } from './lib/routing'
import { VEHICLES, money } from './lib/fuel'
import { trafficSpeech } from './lib/traffic'
import { rainOnRoute, rainSentence, rainLikely, rainHere, RainOutlook } from './lib/weather'
import { placeLink, shareText, sharedPlaceFromUrl, clearSharedPlaceFromUrl, ShareResult } from './lib/share'
import { catFromSpeech, findNearest, fmtDist } from './lib/nearest'
import { useWebSocket } from './hooks/useWebSocket'
import { useVoice, speak, WAKE_RE } from './hooks/useVoice'
import { useLocation, lastKnown } from './hooks/useLocation'
import { useIsDesktop } from './hooks/useMediaQuery'
import { fetchReports, upvoteReport, HazardReport } from './lib/api'
import { makeSeedReports, startSimulation } from './lib/demoData'

type Tab = 'map' | 'report' | 'list' | 'nav'
type Toast = { id: string; text: string; type: 'info' | 'success' | 'warn' | 'danger' }

export default function App() {
  const [booting, setBooting] = useState(() => {
    // returning visitors skip the splash: the map is the first thing they see
    try { const t = Number(localStorage.getItem('gm-booted') || 0); return !(t && Date.now() - t < 12 * 3600_000) } catch { return true }
  })
  const [reports, setReports] = useState<HazardReport[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceTrigger, setVoiceTrigger] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [newHazardId, setNewHazardId] = useState<string | null>(null)
  const [wsConnected, setWsConnected] = useState(false)
  const [demoMode, setDemoMode] = useState(false)
  const [reportRate, setReportRate] = useState(0)
  const [showShortcuts, setShowShortcuts] = useState(false)
  const [showSos, setShowSos] = useState(false)
  /** Rain forecast for the planned route: key = plan id, done = forecast answered (or failed). */
  const [rain, setRain] = useState<{ key: number; outlook: RainOutlook; done: boolean }>({ key: -1, outlook: null, done: false })
  // 3D is the base view; 2D stays available as a fallback and for low-end devices
  const [map3d, setMap3d] = useState(true)

  const isDesktop = useIsDesktop()
  const toastId = useRef(0)
  const recentTimestamps = useRef<number[]>([])
  const reportsRef = useRef<HazardReport[]>([])
  useEffect(() => { reportsRef.current = reports }, [reports])

  const toast = useCallback((text: string, type: Toast['type'] = 'info') => {
    const id = String(toastId.current++)
    setToasts(prev => [...prev, { id, text, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4500)
  }, [])

  // Live device location (continuous). Until the first fix the map shows the demo area.
  const loc = useLocation()
  const known = useRef(lastKnown()).current
  // Before the first fix: the last place this device was, else the middle of India (never a hard-coded city)
  const userLat = loc.fix?.lat ?? known?.lat ?? 22.5
  const userLng = loc.fix?.lng ?? known?.lng ?? 79.0
  const gpsReal = !!loc.fix

  const markNew = useCallback((r: HazardReport) => {
    setNewHazardId(r.id)
    recentTimestamps.current.push(Date.now())
    setTimeout(() => setNewHazardId(cur => (cur === r.id ? null : cur)), 4000)
  }, [])

  // ── Demo mode ───────────────────────────────────────────────────────────
  // Render's free tier sleeps after ~15min idle and cold-starts in 30-60s, so
  // a live link can land on an empty map. Demo mode fills it instantly and
  // streams simulated traffic through the same handlers production uses.
  const enableDemo = useCallback((announce = true) => {
    setDemoMode(true)
    setReports(makeSeedReports())
    void announce
  }, [toast])

  const disableDemo = useCallback(() => {
    setDemoMode(false)
    setReports([])
    fetchReports()
      .then(r => { setReports(Array.isArray(r) ? r : []); setWsConnected(true) })
      .catch(() => setWsConnected(false))
  }, [toast])

  // Initial load: try the backend, fall back to demo if it isn't up
  useEffect(() => {
    let cancelled = false
    fetchReports()
      .then(r => {
        if (cancelled) return
        setReports(Array.isArray(r) ? r : [])
        setWsConnected(true)
      })
      .catch(() => {
        if (cancelled) return
        setWsConnected(false)
      })
    return () => { cancelled = true }
  }, [])

  // Hazards come only from real reports. If the server is asleep or unreachable, keep retrying until it answers
  useEffect(() => {
    if (wsConnected) return
    const t = setInterval(() => {
      fetchReports().then(r => { setReports(Array.isArray(r) ? r : []); setWsConnected(true) }).catch(() => {})
    }, 12_000)
    return () => clearInterval(t)
  }, [wsConnected])

  // Sample hazards follow the user: when "my location" moves far from where they were seeded, re-seed around it
  const seedCentre = useRef<{ lat: number; lng: number } | null>(null)
  useEffect(() => {
    if (!demoMode || !loc.fix) return
    const c = seedCentre.current
    if (c && haversine([c.lng, c.lat], [loc.fix.lng, loc.fix.lat]) < 3000) return
    seedCentre.current = { lat: loc.fix.lat, lng: loc.fix.lng }
    setReports(makeSeedReports(seedCentre.current))
  }, [demoMode, loc.fix?.lat, loc.fix?.lng])

  // Run the simulation while demo mode is on
  useEffect(() => {
    if (!demoMode) return
    const stop = startSimulation({
      onNewHazard: r => {
        setReports(prev => [r, ...prev])
        markNew(r)
        toast(`⚠ ${r.severity.toUpperCase()} — ${r.hazard_type.replace('_', ' ')}`, 'warn')
      },
      onUpvoteTick: id => {
        setReports(prev => prev.map(r => r.id === id ? { ...r, upvotes: r.upvotes + 1 } : r))
      },
      getReportIds: () => reportsRef.current.map(r => r.id),
      getCentre: () => (userPosRef.current.real ? userPosRef.current : undefined),
    })
    return stop
  }, [demoMode, markNew, toast])

  // Rolling reports/min
  useEffect(() => {
    const t = setInterval(() => {
      const now = Date.now()
      recentTimestamps.current = recentTimestamps.current.filter(ts => now - ts < 60_000)
      setReportRate(recentTimestamps.current.length)
    }, 3000)
    return () => clearInterval(t)
  }, [])

  // ── Live WebSocket ──────────────────────────────────────────────────────
  useWebSocket({
    onNewHazard: useCallback((r: HazardReport) => {
      setReports(prev => [r, ...prev.filter(x => x.id !== r.id)])
      setWsConnected(true)
      markNew(r)
      toast(`⚠ ${r.severity.toUpperCase()} — ${r.hazard_type.replace('_', ' ')}`, 'warn')
    }, [toast, markNew]),
    onUpvote: useCallback((reportId: string, upvotes: number) => {
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, upvotes } : r))
    }, []),
  })

  // ── Navigation ──────────────────────────────────────────────────────────
  const nav = useNavigation({ reports, toast, speak })
  useWakeLock(nav.status === 'trip')
  const userPos = { lat: userLat, lng: userLng, real: gpsReal }
  // "Pick on map" answer from the map
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent).detail as { lat: number; lng: number }
      loc.setManual({ name: 'Pinned location', lat: d.lat, lng: d.lng })
      toast('📍 Location set. Tap “Use GPS” to go back to your device location', 'info')
    }
    window.addEventListener('gm:picked', on)
    return () => window.removeEventListener('gm:picked', on)
  }, [loc, toast])

  const userPosRef = useRef(userPos)
  userPosRef.current = userPos
  const navRef = useRef(nav)
  navRef.current = nav

  // One-tap demo drive: plan, wait for the fuel/hazard data, then roll
  const autoStart = useRef(false)
  const autoStartMode = useRef<'sim' | 'gps'>('sim')
  const demoDriveRef = useRef(false)
  const injected = useRef(false)
  const demoDrive = useCallback(() => {
    const t = DEMO_TRIPS[0]
    autoStart.current = true
    autoStartMode.current = 'sim'
    demoDriveRef.current = true
    injected.current = false
    navRef.current.plan(t.from, t.to)
    setActiveTab('map')
  }, [])
  useEffect(() => {
    if (autoStart.current && nav.status === 'ready' && nav.current && !nav.fuelLoading) {
      autoStart.current = false
      nav.startTrip(autoStartMode.current)
      autoStartMode.current = 'sim'
    }
  }, [nav.status, nav.current, nav.fuelLoading, nav])

  // Real navigation: follow the phone's actual GPS. If the route was planned from somewhere
  // else, re-plan from where the user really is, then go.
  const fixRef = useRef(loc.fix)
  fixRef.current = loc.fix
  const startLive = useCallback(() => {
    const n = navRef.current
    if (!n.current || !n.to) return
    const f = fixRef.current
    if (!f) {
      loc.request()
      toast('📍 Allow location to navigate — or use Simulate drive', 'warn')
      speak('Please allow location access to start navigation')
      return
    }
    if (loc.manual) { // a chosen location can't be followed by real GPS: drive it in simulation
      n.startTrip('sim'); setActiveTab('map')
      toast('Driving from the location you chose (simulated)', 'info')
      return
    }
    const [lng0, lat0] = n.current.route.coords[0]
    if (haversine([f.lng, f.lat], [lng0, lat0]) > 250) {
      autoStart.current = true
      autoStartMode.current = 'gps'
      n.plan({ name: 'My location', sub: '', lat: f.lat, lng: f.lng }, n.to)
      return
    }
    n.startTrip('gps')
    setActiveTab('map')
  }, [loc, toast])
  const startLiveRef = useRef(startLive)
  startLiveRef.current = startLive

  // Demo drives stage one live event: a driver ahead reports a critical hazard on the
  // road, so the Guardian agent can be seen re-planning around it. Clearly labelled.
  useEffect(() => {
    if (!demoDriveRef.current || injected.current) return
    if (nav.status !== 'trip' || !nav.current || !nav.trip || nav.trip.traveled < 250) return
    injected.current = true
    const cur = nav.current
    const here = nav.tripPos!.pos
    const along = nav.trip.traveled
    const dest = nav.to
    // Ask the router what the Guardian will be able to choose from at this point,
    // and stage the hazard where one of those roads genuinely avoids it.
    const stage = (alts: Route[]) => {
      const spot = divergencePoint(cur.route, alts, along) ?? { pos: pointAt(cur.route, along + 1000).pos }
      const r = {
        id: `demo-live-${Date.now()}`,
        hazard_type: 'accident', severity: 'critical',
        description: 'Simulated hazard for this test drive only. It is not a real report and is not shared.',
        voice_summary: 'Simulated accident ahead. Road blocked.',
        suggested_action: 'Take the alternative road.',
        confidence: 0.97, upvotes: 4,
        lat: spot.pos[1], lng: spot.pos[0], created_at: new Date().toISOString(),
      } as HazardReport
      setReports(prev => [r, ...prev])
      markNew(r)
    }
    if (dest) {
      fetchRoutes(here, [dest.lng, dest.lat]).then(stage).catch(() => stage([]))
    } else stage([])
  }, [nav.status, nav.current, nav.trip, nav.tripPos, nav.to, markNew])
  useEffect(() => {
    if (nav.status === 'idle') {
      demoDriveRef.current = false; injected.current = false
      setReports(prev => prev.some(r => r.id.startsWith('demo-live')) ? prev.filter(r => !r.id.startsWith('demo-live')) : prev) // the staged test hazard never outlives its drive
    }
  }, [nav.status])

  // When a trip is ready, say how traffic is and how long it will take (once per destination and place, and only while voice is on)
  const spokenFor = useRef('')
  useEffect(() => {
    if (nav.status !== 'ready' || !nav.trafficReady || !nav.current || !nav.to || !voiceEnabled) return
    if (rain.key !== nav.planId || !rain.done) return
    const key = `${nav.to.lat.toFixed(4)},${nav.to.lng.toFixed(4)}|${nav.from?.lat.toFixed(3)},${nav.from?.lng.toFixed(3)}`
    if (spokenFor.current === key) return
    spokenFor.current = key
    const wet = rainLikely(rain.outlook) ? ' ' + rainSentence(rain.outlook) : ''
    speak(trafficSpeech(nav.current.route, nav.to.name, nav.current.hazards.length) + wet)
  }, [nav.status, nav.trafficReady, nav.current, nav.to, nav.from, voiceEnabled, rain, nav.planId])

  // Rain on the route, once per planned route (never blocks the trip: gives up after 7 s)
  useEffect(() => {
    if (nav.status !== 'ready' || !nav.current) return
    const key = nav.planId
    if (rain.key === key) return
    setRain({ key, outlook: null, done: false })
    let alive = true
    rainOnRoute(nav.current.route)
      .then(o => { if (alive) setRain({ key, outlook: o, done: true }) })
      .catch(() => { if (alive) setRain({ key, outlook: null, done: true }) })
    return () => { alive = false }
  }, [nav.status, nav.current, nav.planId])
  useEffect(() => { if (nav.status === 'idle') spokenFor.current = '' }, [nav.status])

  // Routes are drawn on the 3D map, so make sure it is the one showing
  useEffect(() => { if (nav.status !== 'idle') setMap3d(true) }, [nav.status])

  // ── Sharing and emergency ─────────────────────────────────────────────
  const shareToast = useCallback((r: ShareResult, what: string) => {
    if (r === 'shared' || r === 'whatsapp') toast(`📤 ${what} ready to send`, 'success')
    else if (r === 'copied') toast(`📋 ${what} copied. Paste it in WhatsApp or SMS`, 'success')
    else if (r === 'failed') toast(`Could not open sharing. Tap the share button instead`, 'warn')
  }, [toast])

  const shareLocation = useCallback(async () => {
    const f = loc.fix
    if (!f) { loc.request(); toast('📍 Allow location access to share where you are', 'warn'); return }
    const name = loc.manual?.name
    const text = name ? `I'm at ${name}.` : `I'm here (accurate to about ${Math.max(5, Math.round(f.accuracy ?? 20))} m).`
    shareToast(await shareText('My location', `${text} Open for directions:`, placeLink(f.lat, f.lng, name ?? 'My location')), 'Your location')
  }, [loc, toast, shareToast])

  const shareEta = useCallback(async () => {
    const n = navRef.current
    if (!n.current || !n.to) { toast('Plan a route first, then share your arrival time', 'info'); return }
    const driving = n.status === 'trip'
    const secs = driving ? n.remainingSec : n.current.route.duration
    const left = driving ? n.remainingM : n.current.route.distance
    const text = `${driving ? 'On my way' : 'Leaving soon'} to ${n.to.name}. Arriving around ${clock(secs * 1000)} (${fmtKm(left)} away).`
    shareToast(await shareText('My ETA', text, placeLink(n.to.lat, n.to.lng, n.to.name)), 'Your arrival time')
  }, [toast, shareToast])

  const shareDestination = useCallback(async () => {
    const n = navRef.current
    if (!n.to) return
    shareToast(await shareText(n.to.name, `Meet me at ${n.to.name}. Open for directions:`, placeLink(n.to.lat, n.to.lng, n.to.name)), 'The place')
  }, [shareToast])

  // the voice handler is created once, so it reads these through refs
  const rainRef = useRef(rain); rainRef.current = rain
  const shareLocationRef = useRef(shareLocation); shareLocationRef.current = shareLocation
  const shareEtaRef = useRef(shareEta); shareEtaRef.current = shareEta

  // A shared place link (?at=lat,lng&label=...) opens with directions to it
  const sharedHandled = useRef(false)
  useEffect(() => {
    if (sharedHandled.current) return
    const place = sharedPlaceFromUrl()
    if (!place) { sharedHandled.current = true; return }
    if (!loc.fix && loc.status !== 'denied' && loc.status !== 'unavailable') {
      const t = setTimeout(() => { if (!sharedHandled.current) { sharedHandled.current = true; planShared(place) } }, 6000)
      return () => clearTimeout(t)
    }
    sharedHandled.current = true
    planShared(place)
    function planShared(p: typeof place & {}) {
      const u = userPosRef.current
      clearSharedPlaceFromUrl()
      navRef.current.plan({ name: loc.manual?.name ?? 'My location', sub: '', lat: u.lat, lng: u.lng }, p)
      setActiveTab('map')
      toast(`📍 Directions to ${p.name}, shared with you`, 'info')
    }
  }, [loc.fix, loc.status, loc.manual, toast])

  // ── Voice ───────────────────────────────────────────────────────────────
  const demoDriveFn = useRef<() => void>(() => {})
  demoDriveFn.current = demoDrive
  const handleVoiceCommand = useCallback((cmd: string, raw?: string) => {
    const n = navRef.current
    const say = (t: string) => { speak(t); toast(`🎙 ${t}`, 'info') }
    const camera = (act: string) => window.dispatchEvent(new CustomEvent('gm:map', { detail: act }))
    const driving = n.status === 'trip' && !!n.current && !!n.trip
    if (cmd.startsWith('VEHICLE:')) {
      const k = cmd.slice(8)
      const id = /diesel/.test(k) ? 'suv-d' : /suv/.test(k) ? 'suv-p' : /hatch/.test(k) ? 'hatch'
        : /sedan/.test(k) ? 'sedan' : /bike|motor/.test(k) ? 'bike' : 'ev'
      n.setVehicleId(id)
      say(`Vehicle set to ${VEHICLES.find(v => v.id === id)?.label}`)
      return
    }
    switch (cmd) {
      case 'WAKE': say(n.status === 'trip' ? 'Yes? I am here and the Guardian is watching.' : 'Yes? I am listening. Say help to hear what I can do.'); break
      case 'NAVIGATE': {
        const raw0 = (raw ?? '').replace(WAKE_RE, '')
        const m = raw0.match(/(?:navigate to|take me to|directions to|drive to|route to|go to|find)\s+(.+)/i)
        const dest = m?.[1]?.replace(/[.?!]+$/, '').trim()
        if (!dest) { speak('Where would you like to go?'); break }
        speak(`Finding ${dest}`)
        const u = userPosRef.current
        searchPlaces(dest, u).then(r => {
          if (!r[0]) { speak(`I couldn't find ${dest}`); toast(`No place found for "${dest}"`, 'warn'); return }
          navRef.current.plan({ name: loc.manual?.name ?? 'My location', sub: '', lat: u.lat, lng: u.lng }, r[0])
          setActiveTab('map')
          toast(`🧭 Routing to ${r[0].name}`, 'info')
        }).catch(() => toast('Place search unavailable', 'warn'))
        break
      }
      case 'START_TRIP':
        if (n.current && n.status === 'ready') { startLiveRef.current(); speak('Starting navigation. Guardian is watching.') }
        else say('Plan a route first. Say navigate to, then a place.')
        break
      case 'STOP_TRIP':
        n.status === 'trip' ? n.stopTrip() : n.clear(); speak('Trip ended'); break
      case 'PAUSE': if (driving) { n.patchTrip({ paused: true }); speak('Paused') } break
      case 'RESUME': if (driving) { n.patchTrip({ paused: false }); speak('Resuming') } break
      case 'FASTER': case 'SLOWER': if (driving && n.trip) {
        const steps = [1, 8, 30, 120]; const i = steps.indexOf(n.trip.speedMul)
        const m = steps[Math.max(0, Math.min(3, (i < 0 ? 1 : i) + (cmd === 'FASTER' ? 1 : -1)))]
        n.patchTrip({ speedMul: m }); say(`Simulation ${m} times`)
      } break
      case 'FOLLOW': if (driving && n.trip) { n.patchTrip({ follow: true }); speak('Following') } break
      case 'DEMO': demoDriveFn.current(); setActiveTab('map'); speak('Starting a drive'); break
      case 'ASK_DISTANCE':
        driving ? say(`${fmtKm(n.remainingM)} to go`) : n.current ? say(`The route is ${fmtKm(n.current.route.distance)}`) : say('No route yet')
        break
      case 'ASK_TIME':
        if (driving) say(`${fmtDur(n.remainingSec)} left. You arrive at ${clock(n.remainingSec * 1000)}`)
        else if (n.current) say(`The drive takes ${fmtDur(n.current.route.duration)}`)
        else say('No route yet')
        break
      case 'ASK_FUEL':
        if (n.current) say(`About ${money(n.current.fuel.cost, n.current.fuel.currency)}, ${n.current.fuel.litres.toFixed(1)} ${n.current.fuel.unit === 'kWh' ? 'kilowatt hours' : 'litres'}${driving ? `. Used so far ${money(n.fuelUsed.cost, n.current.fuel.currency)}` : ''}`)
        else say('Plan a route and I will estimate the fuel')
        break
      case 'ASK_LIMIT':
        driving ? say(`Limit ${n.limitKmh}. You are doing ${Math.round(n.speedKmh)}`) : say('Start a trip and I will track the limit')
        break
      case 'ASK_AHEAD': {
        const h = n.ahead[0]
        if (driving && h) say(`${h.report.severity} ${h.report.hazard_type.replace(/_/g, ' ')} in ${fmtKm(Math.max(0, h.at - n.traveled))}. ${h.report.suggested_action ?? 'Slow down.'}`)
        else if (driving) say('The road ahead is clear of reports')
        else say(`${reportsRef.current.length} hazards are reported around you`)
        break
      }
      case 'NEAREST': {
        const cat = catFromSpeech(raw ?? '')
        if (!cat) { say('What are you looking for? Try nearest petrol pump, restaurant, ATM or hospital.'); break }
        const u = userPosRef.current
        if (!u.real) { say('I need your location first. Allow location access or pick it on the map.'); break }
        speak(`Looking for the nearest ${cat.say}`)
        findNearest(cat, u).then(hits => {
          const h = hits[0]
          if (!h) { say(`I couldn't find a ${cat.say} near you.`); return }
          const more = hits[1] ? ` Next closest is ${hits[1].name}, ${fmtDist(hits[1].km)} away.` : ''
          say(`Nearest ${cat.say} is ${h.name}, ${fmtDist(h.km)} away. Routing you there.${more}`)
          navRef.current.plan({ name: loc.manual?.name ?? 'My location', sub: '', lat: u.lat, lng: u.lng }, h)
          setActiveTab('map')
        }).catch(() => say('Search is unavailable right now.'))
        break
      }
      case 'LOCATE': {
        const u = userPosRef.current
        setActiveTab('map'); window.dispatchEvent(new CustomEvent('gm:map', { detail: 'locate' }))
        say(u.real || loc.manual ? `You are ${loc.manual ? 'at ' + loc.manual.name : 'here'}. I have centred the map on you.` : 'I do not have your location yet. Allow location access, or pick it on the map.')
        break
      }
      case 'ASK_TRAFFIC':
        if (n.current) speak(trafficSpeech(n.current.route, n.to?.name ?? 'your destination', n.current.hazards.length))
        else say('Plan a route and I will tell you about the traffic.')
        break
      case 'ROUTE_PICK': {
        if (n.options.length < 2) { say(n.options.length ? 'There is only one route to this place.' : 'Plan a route first.'); break }
        const t = (raw ?? '').toLowerCase()
        const idx = /safe|hazard/.test(t) ? n.options.reduce((b, o, i, a) => o.hazards.length < a[b].hazards.length ? i : b, 0)
          : /fast|quick|short/.test(t) ? n.options.reduce((b, o, i, a) => o.route.duration < a[b].route.duration ? i : b, 0)
          : /two|second|2|other|alternative/.test(t) ? 1 : /three|3/.test(t) ? Math.min(2, n.options.length - 1) : 0
        n.choose(idx); say(`Route ${idx + 1} selected. ${fmtDur(n.options[idx].route.duration)}, ${n.options[idx].hazards.length} reported hazards.`)
        break
      }
      case 'REROUTE':
        if (driving) { window.dispatchEvent(new CustomEvent('gm:guardian')); say('Guardian is checking for a better road.') }
        else if (n.options.length > 1) { const i = (n.selected + 1) % n.options.length; n.choose(i); say(`Switched to route ${i + 1}.`) }
        else say(n.current ? 'There is no other route to this place.' : 'Plan a route first.')
        break
      case 'REPEAT':
        if (n.current && n.to) speak(trafficSpeech(n.current.route, n.to.name, n.current.hazards.length)); break
      case 'ASK_COUNT': say(`${reportsRef.current.length} hazards reported`); break
      case 'HELP': say('Try: navigate to a place, nearest petrol pump, how is the traffic, will it rain, share my location, any hazards ahead, report pothole, or reroute.'); break
      case 'SOS': setShowSos(true); say('Emergency. Call 112 for police, fire or ambulance. Tap send my location to share where you are.'); break
      case 'SHARE_LOCATION': void shareLocationRef.current(); break
      case 'SHARE_ETA': void shareEtaRef.current(); break
      case 'WEATHER': {
        const rn = rainRef.current
        if (n.current && rn.key === n.planId && rn.done) { say(rainSentence(rn.outlook)); break }
        const u = userPosRef.current
        if (n.current) {
          say('Checking the rain forecast for your route.')
          rainOnRoute(n.current.route).then(o => speak(rainSentence(o))).catch(() => speak('I could not get the rain forecast right now.'))
        } else {
          say('Checking the rain forecast here.')
          rainHere(u.lat, u.lng).then(speak).catch(() => speak('I could not get the rain forecast right now.'))
        }
        break
      }
      case 'REPORT_HAZARD': setVoiceTrigger(true); setActiveTab('report'); break
      case 'ZOOM_IN': camera('zoomIn'); break
      case 'ZOOM_OUT': camera('zoomOut'); break
      case 'FIT': camera('fit'); break
      case 'VIEW_TOP': setActiveTab('map'); camera('top'); break
      case 'VIEW_TILT': setActiveTab('map'); camera('tilt'); break
      case 'VIEW_STREET': setActiveTab('map'); camera('street'); break
      case 'NORTH': camera('north'); break
      case 'MAP_2D': if (!driving) { setMap3d(false); speak('Two D map') } break
      case 'MAP_3D': setMap3d(true); speak('Three D map'); break
      case 'TAB_LIST': setActiveTab('list'); speak(`${reportsRef.current.length} hazards reported`); break
      case 'TAB_NAV': setActiveTab('nav'); break
      case 'TAB_MAP': setActiveTab('map'); break
      case 'TAB_REPORT': setActiveTab('report'); break
      case 'VOICE_OFF': speak('Voice off'); setVoiceEnabled(false); break
      default:
        if (cmd === 'UNKNOWN' && (raw ?? '').split(' ').length > 1) toast(`🎙 "${raw}" — say help to hear what I understand`, 'info')
    }
  }, [toast])

  const { listening, supported, transcript, level } = useVoice({
    onCommand: handleVoiceCommand,
    enabled: voiceEnabled && !booting,
  })

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  useEffect(() => {
    if (booting) return
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && /^(INPUT|TEXTAREA)$/.test(el.tagName)) return
      if (e.metaKey || e.ctrlKey || e.altKey) return

      switch (e.key.toLowerCase()) {
        case 'r': setVoiceTrigger(true); setActiveTab('report'); break
        case 'm': setActiveTab('map'); break
        case 'f': setActiveTab('list'); break
        case 'n': setActiveTab('nav'); break
        case 'v': setVoiceEnabled(v => !v); break
        case '3': setMap3d(v => !v); break
        case '?': setShowShortcuts(s => !s); break
        case 'escape': setShowShortcuts(false); setShowSos(false); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [booting])

  const handleUpvote = useCallback(async (id: string) => {
    if (demoMode || id.startsWith('demo-')) {
      setReports(prev => prev.map(r => r.id === id ? { ...r, upvotes: r.upvotes + 1 } : r))
      return
    }
    try {
      const upvotes = await upvoteReport(id)
      if (upvotes > 0) setReports(prev => prev.map(r => r.id === id ? { ...r, upvotes } : r))
    } catch {}
  }, [demoMode])

  const handleNewReport = useCallback((r: HazardReport, merged = false) => {
    // The server also broadcasts this report over the WebSocket: replace by id, never double-add
    setReports(prev => [r, ...prev.filter(x => x.id !== r.id)])
    setFocusId(r.id)
    markNew(r)
    setTimeout(() => setActiveTab('map'), 1200)
    toast(merged ? '👍 Already reported nearby — your report counted as an upvote' : '✅ Hazard pinned — live on map', 'success')
  }, [toast, markNew])

  const criticals = reports.filter(r => r.severity === 'critical').length
  const highs = reports.filter(r => r.severity === 'high').length

  if (booting) return <BootSequence onDone={() => { try { localStorage.setItem('gm-booted', String(Date.now())) } catch {} setBooting(false) }} />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden', position: 'relative' }}>

      {/* ══ HEADER ══════════════════════════════════════════════════════ */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 16px', height: 58, gap: 12,
        background: 'rgba(2,6,16,0.95)', backdropFilter: 'blur(40px)',
        borderBottom: '1px solid rgba(0,212,255,0.12)',
        flexShrink: 0, position: 'relative', zIndex: 200,
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, right: 0, height: 1,
          background: 'linear-gradient(90deg, transparent, rgba(0,212,255,0.7) 50%, transparent)',
          animation: 'header-shine 3s ease-in-out infinite',
        }} />

        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 }}>
          <div style={{ position: 'relative', flexShrink: 0 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: 'linear-gradient(135deg, #001aff, #00d4ff)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 18, boxShadow: '0 0 20px rgba(0,212,255,0.5)',
              animation: 'logo-float 4s ease-in-out infinite',
            }}>🚧</div>
            <div style={{
              position: 'absolute', inset: -3, borderRadius: 13,
              border: '1px solid rgba(0,212,255,0.3)',
              animation: 'ping 3s ease-out infinite',
            }} />
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{
              fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 17, letterSpacing: '-0.4px',
              background: 'linear-gradient(90deg, #fff 0%, #00d4ff 60%, #0096ff 100%)',
              WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
              whiteSpace: 'nowrap',
            }}>Gemini Maps</div>
            {isDesktop && (
              <div style={{ fontSize: 9.5, color: 'var(--text3)', letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                AI · Real-Time · Road Intelligence
              </div>
            )}
          </div>
        </div>

        {/* Severity badges */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, flexShrink: 0 }}>
          {criticals > 0 && (
            <Badge color="#ff2266" bg="rgba(255,34,102,0.1)" border="rgba(255,34,102,0.4)" glow>
              <Dot color="#ff2266" fast /> {criticals}{isDesktop ? ' CRITICAL' : ''}
            </Badge>
          )}
          {highs > 0 && isDesktop && (
            <Badge color="#ff6600" bg="rgba(255,102,0,0.1)" border="rgba(255,102,0,0.3)">
              ◆ {highs} HIGH
            </Badge>
          )}
        </div>

        {/* Right cluster */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          {(isDesktop || !demoMode) && (
            <Badge
              color={wsConnected ? '#00ff88' : '#ff6600'}
              bg={wsConnected ? 'rgba(0,255,136,0.06)' : 'rgba(255,100,0,0.06)'}
              border={wsConnected ? 'rgba(0,255,136,0.2)' : 'rgba(255,100,0,0.2)'}
            >
              <Dot color={wsConnected ? '#00ff88' : '#ff6600'} />
              {isDesktop ? (wsConnected ? 'LIVE' : 'OFFLINE') : null}
            </Badge>
          )}

          <button
            onClick={() => setVoiceEnabled(v => !v)}
            title="Toggle voice (V)"
            style={{
              background: listening ? 'rgba(0,212,255,0.1)' : voiceEnabled ? 'rgba(0,100,255,0.07)' : 'rgba(255,255,255,0.03)',
              border: `1px solid ${listening ? 'rgba(0,212,255,0.5)' : voiceEnabled ? 'rgba(0,100,255,0.2)' : 'rgba(255,255,255,0.08)'}`,
              color: listening ? 'var(--accent)' : voiceEnabled ? '#7ab8ff' : 'var(--text3)',
              padding: '6px 13px', fontSize: 11, fontWeight: 700, letterSpacing: '0.05em',
              display: 'flex', alignItems: 'center', gap: 7, borderRadius: 20,
              animation: listening ? 'glow-pulse 2s ease infinite' : 'none',
            }}
          >
            {listening ? (
              <span style={{ position: 'relative', width: 13, height: 13, display: 'inline-flex' }}>
                <span style={{ position: 'absolute', inset: 0, borderRadius: '50%', border: '2px solid var(--accent)', animation: 'ping 1s ease-out infinite' }} />
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)', margin: 'auto', position: 'absolute', inset: 0 }} />
              </span>
            ) : <span style={{ fontSize: 13 }}>🎙</span>}
            {isDesktop && (listening ? 'LISTENING' : voiceEnabled ? 'VOICE ON' : 'VOICE OFF')}
          </button>

          <button
            onClick={() => setShowShortcuts(s => !s)}
            title="About, voice commands and shortcuts (?)"
            aria-label="About Gemini Maps"
            style={{
              background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.09)',
              color: 'var(--text3)', width: isDesktop ? 28 : 36, height: isDesktop ? 28 : 36, borderRadius: 8,
              fontSize: 13, fontWeight: 700, display: 'grid', placeItems: 'center',
            }}
          >?</button>
        </div>
      </header>

      <TelemetryBar
        reports={reports} reportRate={reportRate}
        userLat={userLat} userLng={userLng}
        compact={!isDesktop}
      />

      {/* ══ TABS ════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', background: 'rgba(2,6,16,0.8)', backdropFilter: 'blur(16px)',
        borderBottom: '1px solid rgba(0,212,255,0.07)', flexShrink: 0, zIndex: 150,
      }}>
        {([
          { key: 'map' as Tab, label: 'LIVE MAP', icon: '◉', hint: 'M' },
          { key: 'nav' as Tab, label: 'NAVIGATE', icon: '➤', hint: 'N' },
          { key: 'report' as Tab, label: 'REPORT', icon: '⊕', hint: 'R' },
          { key: 'list' as Tab, label: 'FEED', icon: '≡', hint: 'F', count: reports.length },
        ] as const).map(t => {
          const on = activeTab === t.key
          return (
            <button
              key={t.key}
              onClick={() => setActiveTab(t.key)}
              style={{
                flex: 1, padding: '10px 0', background: 'transparent',
                color: on ? 'var(--accent)' : 'var(--text3)',
                borderBottom: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                borderRadius: 0, fontSize: 11, fontWeight: 700,
                letterSpacing: '0.1em', textTransform: 'uppercase',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                fontFamily: 'var(--font2)', transition: 'all 0.2s ease',
              }}
            >
              <span style={{ fontSize: 13, opacity: 0.85 }}>{t.icon}</span>
              {t.label}
              {'count' in t && (t.count as number) > 0 && (
                <span style={{
                  background: on ? 'rgba(0,212,255,0.15)' : 'rgba(255,255,255,0.07)',
                  color: on ? 'var(--accent)' : 'var(--text3)',
                  borderRadius: 10, padding: '1px 7px', fontSize: 10, fontWeight: 700,
                }}>{t.count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* ══ MAIN ════════════════════════════════════════════════════════ */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex', position: 'relative' }}>
        <div style={{
          flex: 1, position: 'relative',
          display: isDesktop || activeTab === 'map' ? 'block' : 'none',
        }}>
          {map3d ? (
            <Suspense fallback={<MapLoading />}>
              <HazardMap3D
                autoFit={loc.status === 'denied' || loc.status === 'unavailable'}
                reports={reports} focusId={focusId} newHazardId={newHazardId} onUpvote={handleUpvote}
                route={nav.current ? {
                  selected: nav.current.route.coords,
                  alts: nav.options.filter((_, i) => i !== nav.selected).map(o => o.route.coords),
                  key: String(nav.planId),
                } : null}
                trip={nav.trip && nav.tripPos
                  ? { pos: nav.tripPos.pos, heading: nav.tripPos.heading, follow: nav.trip.follow } : null}
                onFollowBreak={() => nav.patchTrip({ follow: false })}
                me={loc.fix ? { lat: loc.fix.lat, lng: loc.fix.lng, heading: loc.fix.heading, accuracy: loc.fix.accuracy } : null}
                onLocate={loc.request}
              />
            </Suspense>
          ) : (
            <Suspense fallback={<MapLoading />}>
              <HazardMap reports={reports} focusId={focusId} newHazardId={newHazardId} onUpvote={handleUpvote} />
            </Suspense>
          )}

          <TripHUD
            nav={nav} isDesktop={isDesktop} onStartLive={startLive}
            rain={rain.key === nav.planId ? rain.outlook : null}
            onShareEta={shareEta} onShareDestination={shareDestination} onSos={() => setShowSos(true)}
          />

          {/* Emergency and share-my-location, one tap away when not driving */}
          {!nav.trip && (
            <div style={{ position: 'absolute', left: 14, bottom: 120, zIndex: 6, display: 'flex', gap: 8 }}>
              <button onClick={() => setShowSos(true)} aria-label="Emergency" title="Emergency numbers and share your location" style={{
                height: 40, padding: '0 14px', borderRadius: 20, fontWeight: 800, fontSize: 13, letterSpacing: '.04em',
                background: 'rgba(40,4,14,.92)', border: '1px solid rgba(255,51,85,.6)', color: '#ff5c77',
                boxShadow: '0 6px 20px rgba(0,0,0,.45)',
              }}>SOS</button>
              <button onClick={shareLocation} aria-label="Share my location" title="Send your location on WhatsApp or SMS" style={{
                height: 40, padding: '0 14px', borderRadius: 20, fontWeight: 700, fontSize: 13,
                background: 'rgba(2,6,22,.92)', border: '1px solid rgba(0,212,255,.3)', color: 'var(--text2)',
                boxShadow: '0 6px 20px rgba(0,0,0,.45)', display: 'flex', alignItems: 'center', gap: 6,
              }}><span aria-hidden>📤</span>{isDesktop ? 'Share location' : 'Share'}</button>
            </div>
          )}

          {/* Search entry — the first thing a driver reaches for */}
          {nav.status === 'idle' && (
            <div style={{ position: 'absolute', top: isDesktop ? 14 : 62, left: 58, zIndex: 20, display: 'flex', gap: 8 }}>
              <button
                onClick={() => setActiveTab('nav')}
                title="Plan a route (N)"
                style={{
                  background: 'rgba(3,9,20,.9)', 
                  border: '1px solid rgba(0,212,255,.3)', borderRadius: 12, height: 40,
                  padding: isDesktop ? '0 18px 0 14px' : '0 13px', color: 'var(--text)',
                  display: 'flex', alignItems: 'center', gap: 9, fontSize: 14, fontWeight: 600,
                  boxShadow: '0 6px 24px rgba(0,0,0,.5)',
                }}
              >
                <span style={{ fontSize: 15 }}>🔍</span>
                {isDesktop && <span style={{ color: 'var(--text2)' }}>Where to?</span>}
              </button>
              <button
                onClick={demoDrive}
                title="Plan a route and start driving"
                style={{
                  background: 'linear-gradient(135deg,#0050ff,#00b4ff)', border: 'none', borderRadius: 12,
                  height: 40, padding: '0 15px', color: '#fff', fontSize: 13, fontWeight: 800,
                  boxShadow: '0 6px 22px rgba(0,120,255,.45)', whiteSpace: 'nowrap',
                }}
              >▶ {isDesktop ? 'Try a drive' : 'Drive'}</button>
            </div>
          )}

          {/* 2D / 3D switch */}
          <div style={{
            position: 'absolute', bottom: 78, right: 14, zIndex: 1001,
            display: !isDesktop && (nav.status === 'trip' || nav.status === 'arrived') ? 'none' : 'flex', gap: 4, background: 'rgba(2,6,22,.86)',
            border: '1px solid rgba(0,212,255,.16)',
            borderRadius: 10, padding: 4,
          }}>
            {([['2D', false], ['3D', true]] as const).map(([label, on]) => (
              <button
                key={label}
                onClick={() => setMap3d(on)}
                style={{
                  background: map3d === on ? 'rgba(0,212,255,.15)' : 'transparent',
                  color: map3d === on ? 'var(--accent)' : 'var(--text3)',
                  border: 'none', borderRadius: 7, padding: '5px 13px',
                  fontSize: 11, fontWeight: 800, letterSpacing: '.08em',
                  fontFamily: 'var(--font2)',
                }}
              >{label}</button>
            ))}
          </div>
          {activeTab === 'map' && nav.status !== 'trip' && nav.status !== 'arrived' && (
            <VoiceHUD
              listening={listening} transcript={transcript} level={level}
              enabled={voiceEnabled} supported={supported}
            />
          )}
        </div>

        <div style={{
          width: isDesktop ? 390 : '100%', flexShrink: 0,
          display: isDesktop || activeTab !== 'map' ? 'flex' : 'none',
          flexDirection: 'column',
          borderLeft: isDesktop ? '1px solid rgba(0,212,255,0.08)' : 'none',
          overflow: 'hidden',
          background: 'rgba(2,6,16,0.7)', backdropFilter: 'blur(24px)',
        }}>
          {activeTab === 'nav' ? (
            <NavPanel
              nav={nav} userPos={userPos} locStatus={loc.status} onRequestLocation={loc.request} onStartLive={startLive}
              manualName={loc.manual?.name ?? null} accuracy={loc.gps?.accuracy ?? null}
              onSetLocation={p => { loc.setManual({ name: p.name, lat: p.lat, lng: p.lng }); toast(`📍 Location set to ${p.name}`, 'success') }}
              onUseGps={() => { loc.setManual(null); toast('📍 Using your device location', 'info') }}
              onShowMap={() => { if (!isDesktop) setActiveTab('map') }}
            />
          ) : activeTab !== 'list' ? (
            <ReportPanel
              userLat={userLat} userLng={userLng}
              triggerCapture={voiceTrigger}
              onCaptureHandled={() => setVoiceTrigger(false)}
              onNewReport={handleNewReport}
            />
          ) : (
            <HazardList
              reports={reports}
              onFocus={id => { setFocusId(id); if (!isDesktop) setActiveTab('map') }}
              onUpvote={handleUpvote}
            />
          )}
        </div>
      </div>

      {/* ══ ABOUT SHEET ═════════════════════════════════════════════════ */}
      {showShortcuts && <AboutSheet onClose={() => setShowShortcuts(false)} isDesktop={isDesktop} />}
      {showSos && <SosSheet onClose={() => setShowSos(false)} onShareLocation={shareLocation} hasFix={!!loc.fix} isDesktop={isDesktop} />}

      {/* ══ TOASTS ══════════════════════════════════════════════════════ */}
      <div style={{
        position: 'fixed',
        ...(!isDesktop && (nav.status === 'trip' || nav.status === 'arrived')
          ? { top: 318, left: 20, right: 20 } : { bottom: 20, right: 20 }),
        display: 'flex', flexDirection: 'column-reverse', gap: 8,
        zIndex: 9999, maxWidth: !isDesktop ? undefined : 340, pointerEvents: 'none',
      }}>
        {toasts.map(t => {
          const s = {
            success: { bg: 'rgba(0,255,136,0.07)', bd: 'rgba(0,255,136,0.3)', dot: '#00ff88' },
            warn: { bg: 'rgba(255,170,0,0.07)', bd: 'rgba(255,170,0,0.35)', dot: '#ffaa00' },
            danger: { bg: 'rgba(255,34,102,0.08)', bd: 'rgba(255,34,102,0.35)', dot: '#ff2266' },
            info: { bg: 'rgba(0,150,255,0.07)', bd: 'rgba(0,150,255,0.25)', dot: '#0096ff' },
          }[t.type]
          return (
            <div key={t.id} style={{
              background: s.bg, backdropFilter: 'blur(24px)',
              border: `1px solid ${s.bd}`, borderRadius: 12,
              padding: '11px 16px', fontSize: 13, lineHeight: 1.4,
              animation: 'slideIn 0.25s cubic-bezier(0.4,0,0.2,1)',
              boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
              display: 'flex', alignItems: 'center', gap: 10, color: 'var(--text)',
              position: 'relative', overflow: 'hidden',
            }}>
              <span style={{
                width: 7, height: 7, borderRadius: '50%', background: s.dot,
                flexShrink: 0, boxShadow: `0 0 6px ${s.dot}`,
              }} />
              {t.text}
              {/* Life bar */}
              <span style={{
                position: 'absolute', bottom: 0, left: 0, height: 2,
                background: s.dot, opacity: 0.5,
                animation: 'toast-life 4.5s linear forwards',
              }} />
            </div>
          )
        })}
      </div>

      <style>{`
        @keyframes pulse { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.4;transform:scale(0.8)} }
        @keyframes ping { 0%{transform:scale(1);opacity:0.8} 100%{transform:scale(2.5);opacity:0} }
        @keyframes slideIn { from{opacity:0;transform:translateX(20px)} to{opacity:1;transform:translateX(0)} }
        @keyframes slideUp { from{opacity:0;transform:translateY(14px)} to{opacity:1;transform:translateY(0)} }
        @keyframes fadeIn { from{opacity:0} to{opacity:1} }
        @keyframes logo-float { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-3px)} }
        @keyframes header-shine { 0%,100%{opacity:0.25} 50%{opacity:1} }
        @keyframes glow-pulse {
          0%,100%{box-shadow:0 0 8px rgba(0,212,255,0.2)}
          50%{box-shadow:0 0 20px rgba(0,212,255,0.6),0 0 40px rgba(0,212,255,0.2)}
        }
        @keyframes toast-life { from{width:100%} to{width:0%} }
        @media (prefers-reduced-motion: reduce) {
          *, *::before, *::after {
            animation-duration: 0.01ms !important;
            animation-iteration-count: 1 !important;
            transition-duration: 0.01ms !important;
          }
        }
      `}</style>
    </div>
  )
}

/* ── Small presentational helpers ──────────────────────────────────────── */

function Badge({
  children, color, bg, border, glow,
}: {
  children: React.ReactNode
  color: string; bg: string; border: string; glow?: boolean
}) {
  return (
    <div style={{
      background: bg, border: `1px solid ${border}`, color,
      borderRadius: 20, padding: '4px 12px',
      fontSize: 10.5, fontWeight: 700, letterSpacing: '0.05em',
      display: 'flex', alignItems: 'center', gap: 6, whiteSpace: 'nowrap',
      animation: glow ? 'glow-critical 1.6s ease-in-out infinite' : 'none',
    }}>
      {children}
      <style>{`
        @keyframes glow-critical {
          0%,100%{box-shadow:0 0 6px rgba(255,34,102,0.2)}
          50%{box-shadow:0 0 18px rgba(255,34,102,0.5)}
        }
      `}</style>
    </div>
  )
}

function MapLoading() {
  return (
    <div style={{
      height: '100%', display: 'grid', placeItems: 'center',
      background: '#050a14',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: 34, height: 34, margin: '0 auto 12px',
          border: '2px solid rgba(0,212,255,.18)', borderTopColor: 'var(--accent)',
          borderRadius: '50%', animation: 'map-spin .9s linear infinite',
        }} />
        <div style={{
          fontSize: 11.5, color: 'var(--text3)',
          letterSpacing: '.12em', textTransform: 'uppercase',
        }}>Loading 3D engine</div>
      </div>
      <style>{`@keyframes map-spin { to { transform: rotate(360deg) } }`}</style>
      <InstallHint />
    </div>
  )
}

function Dot({ color, fast }: { color: string; fast?: boolean }) {
  return (
    <span style={{
      width: 6, height: 6, borderRadius: '50%', background: color,
      display: 'inline-block', boxShadow: `0 0 6px ${color}`,
      animation: `pulse ${fast ? '0.8s' : '2s'} ease infinite`,
    }} />
  )
}

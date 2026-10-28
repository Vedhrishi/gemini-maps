/**
 * useVoice — hands-free voice control hook
 *
 * Recognition uses the browser's Web Speech API (works hands-free while driving);
 * replies use SpeechSynthesis. The backend's /api/transcribe (Muse Voice Transcribe)
 * is available for server-side transcription.
 *
 * Wake phrase: "Hey Meta". See VOICE_COMMANDS for everything it understands.
 */

import { useRef, useCallback, useEffect, useState } from 'react'
import { transcribeAudio } from '../lib/api'

export type VoiceCommand = string

interface UseVoiceOptions {
  onCommand: (cmd: VoiceCommand, raw: string) => void
  enabled?: boolean
}

export const VOICE_COMMANDS: { phrase: string; does: string }[] = [
  { phrase: 'Hey Meta', does: 'Wake me — I answer back' },
  { phrase: 'navigate to <place>', does: 'Plan a route anywhere' },
  { phrase: 'start trip · stop trip · pause · resume', does: 'Drive controls' },
  { phrase: 'how far · how long · when do I arrive', does: 'Trip answers' },
  { phrase: "how's the traffic · where am I", does: 'Traffic and your location' },
  { phrase: 'nearest petrol pump · restaurant · ATM · hospital', does: 'Find and route to the closest one' },
  { phrase: 'fastest route · safer route · reroute', does: 'Pick or re-plan a route' },
  { phrase: "what's the speed limit", does: 'Limit and your speed' },
  { phrase: 'any hazards ahead', does: 'Road ahead' },
  { phrase: 'how much fuel', does: 'Fuel cost estimate' },
  { phrase: 'use SUV diesel / bike / EV', does: 'Switch vehicle' },
  { phrase: 'report pothole', does: 'Capture and analyze' },
  { phrase: 'show map · feed · navigation · report', does: 'Switch screens' },
  { phrase: 'zoom in · zoom out · fit · top view · street view', does: 'Map camera' },
  { phrase: '2D map · 3D map', does: 'Map mode' },
  { phrase: 'try a drive', does: 'Watch the Guardian reroute' },
  { phrase: 'will it rain', does: 'Rain on your route' },
  { phrase: 'share my location · share my ETA', does: 'Send it on WhatsApp or SMS' },
  { phrase: 'emergency · SOS', does: 'Emergency numbers and share your location' },
  { phrase: 'help', does: 'Hear what you can say' },
]

/** Turn a spoken phrase into an intent. Order matters: questions and specifics first. */
// "Hey Meta" is the wake phrase. Speech engines often hear it as metta / mehta / meda,
// so those are accepted too; the older "Hey Gemini" still works.
export const WAKE_NAMES = 'meta maps|gemini maps|meta|metta|mehta|meda|medha|matta|gemini|jemini|geminy'
export const WAKE_RE = new RegExp(`^\\s*(hey|hi|ok|okay|hello|yo|a)[ ,]+(${WAKE_NAMES})\\b[ ,.!]*`, 'i')

export function parseCommand(text: string): VoiceCommand {
  const wake = text.match(WAKE_RE)
  if (wake) {
    const rest = text.slice(wake[0].length).trim()
    return rest ? parseCommand(rest) : 'WAKE'
  }
  const t = text.toLowerCase().replace(/[.?!,]/g, ' ').replace(/\s+/g, ' ').trim()
  const has = (re: RegExp) => re.test(t)
  const going = has(/\b(navigate to|take me to|directions to|drive to|route to|go to|find|nearest|nearby|closest)\b/)
  if (!going && has(/\b(sos|emergency)\b|i need help$|^help me$|call (the )?(police|ambulance)|i('m| am) in danger/)) return 'SOS'
  if (has(/(share|send) (my )?(eta|trip|arrival|journey|ride)|tell (them|him|her|everyone) i'?m (coming|on my way)/)) return 'SHARE_ETA'
  if (has(/(share|send) (my )?(live |current )?location|share where i am/)) return 'SHARE_LOCATION'
  if (!going && has(/\b(rain|raining|rainy|weather|umbrella|forecast)\b/)) return 'WEATHER'
  if (has(/\b(nearest|nearby|closest|near me|around me)\b|where can i (eat|get|find|fill)|i('m| am) (hungry|low on (fuel|petrol|diesel))|i need (petrol|fuel|diesel|a (doctor|hospital|atm|mechanic))/)) return 'NEAREST'
  if (has(/where am i|my (current )?location|locate me|find me|show me on the map|centre on me|center on me/)) return 'LOCATE'
  if (has(/^(show|open|go to|switch to) (the )?(report|map|live map|feed|list|navigation|directions)( tab| screen)?$/)) {
    return /report/.test(t) ? 'TAB_REPORT' : /feed|list/.test(t) ? 'TAB_LIST' : /navigation|directions/.test(t) ? 'TAB_NAV' : 'TAB_MAP'
  }
  if (has(/traffic/)) return 'ASK_TRAFFIC'
  if (has(/(re-?route|another route|different route|avoid (the )?hazards?|safer (way|route)|find a better)/)) return 'REROUTE'
  if (has(/(fastest|quickest|shortest|safest|safer|least hazards?|alternative|second|other) (route|way|option)|route (one|two|three|1|2|3)\b/)) return 'ROUTE_PICK'
  if (has(/\b(navigate to|take me to|directions to|drive to|route to|go to|find)\b/)) return 'NAVIGATE'
  if (has(/\b(repeat|say that again|again)\b/)) return 'REPEAT'
  if (has(/\bmute\b|be quiet|silence/)) return 'VOICE_OFF'
  if (has(/\bhelp\b|what can i say|what can you do/)) return 'HELP'
  if (has(/speed limit|how fast|my speed/)) return 'ASK_LIMIT'
  if (has(/how (far|many (km|kilometres|kilometers|miles))|distance (left|remaining)|km left/)) return 'ASK_DISTANCE'
  if (has(/how long|time left|time remaining|\beta\b|when (will|do) i (get|arrive)|what time.*arrive/)) return 'ASK_TIME'
  if (has(/\b(fuel|petrol|diesel|gas|mileage)\b.*(cost|use|used|much|need|spend)|how much.*(fuel|petrol|diesel)/)) return 'ASK_FUEL'
  if (has(/(hazards?|danger|accident|pothole|road).*(ahead|on (my|the) (way|route))|anything ahead|what'?s ahead|any hazards?/)) return 'ASK_AHEAD'
  if (has(/how many (hazards|reports)|count hazards/)) return 'ASK_COUNT'
  if (has(/\b(demo|simulate|try a drive|sample drive)\b/)) return 'DEMO'
  if (has(/\b(stop|end|cancel|finish) (the |my )?(trip|navigation|drive|route)\b|\bstop navigation\b/)) return 'STOP_TRIP'
  if (has(/\bpause\b/)) return 'PAUSE'
  if (has(/\b(resume|continue|carry on)\b/)) return 'RESUME'
  if (has(/\b(start|begin)\b.*(trip|navigation|drive|route|going)|let'?s go|^go$|^start$/)) return 'START_TRIP'
  if (has(/\bfaster\b|speed up/)) return 'FASTER'
  if (has(/\bslower\b|slow down/)) return 'SLOWER'
  if (has(/\bfollow\b/)) return 'FOLLOW'
  const veh = t.match(/\b(?:use|switch to|drive|i drive|change (?:vehicle )?to)\s+(?:a |an |the )?(hatchback|hatch|sedan|suv diesel|diesel suv|suv petrol|petrol suv|suv|bike|motorbike|motorcycle|electric car|electric|ev)\b/)
  if (veh) return 'VEHICLE:' + veh[1]
  if (has(/^(show|open|go to|switch to) (the )?report( tab| screen)?$/)) return 'TAB_REPORT'
  if (has(/\b(report|capture|photograph|photo|spotted|there'?s a)\b/)) return 'REPORT_HAZARD'
  if (has(/zoom in|closer/)) return 'ZOOM_IN'
  if (has(/zoom out|farther|further out/)) return 'ZOOM_OUT'
  if (has(/\b(fit|show everything|show all)\b/)) return 'FIT'
  if (has(/top (down )?view|from above|flat/)) return 'VIEW_TOP'
  if (has(/street view|ground level|driver view/)) return 'VIEW_STREET'
  if (has(/tilt|3d view|angled/)) return 'VIEW_TILT'
  if (has(/\b2d\b|two d/)) return 'MAP_2D'
  if (has(/\b3d\b|three d/)) return 'MAP_3D'
  if (has(/rotate|north up|face north/)) return 'NORTH'
  if (has(/(show|open|go to|switch to)?\s*(the )?(feed|list|hazards)$|list hazards|show hazards/)) return 'TAB_LIST'
  if (has(/(show|open|go to|switch to)\s*(the )?(navigation|navigate|directions|routes?)|^navigation$/)) return 'TAB_NAV'
  if (has(/(show|open|go to|switch to)\s*(the )?(map|live map)|^map$/)) return 'TAB_MAP'
  if (has(/(show|open|go to|switch to)\s*(the )?report/)) return 'TAB_REPORT'
  if (has(/stop listening|voice off|mute voice/)) return 'VOICE_OFF'
  return 'UNKNOWN'
}

// ── Speaking ─────────────────────────────────────────────────────────────────
// The microphone must not hear the app's own voice: listeners pause while it talks.
let ttsActive = false
const ttsListeners = new Set<(on: boolean) => void>()
function setTts(on: boolean) {
  if (ttsActive === on) return
  ttsActive = on
  ttsListeners.forEach(f => f(on))
}

let chosenVoice: SpeechSynthesisVoice | null | undefined
function pickVoice(): SpeechSynthesisVoice | null {
  if (chosenVoice !== undefined) return chosenVoice
  const vs = window.speechSynthesis?.getVoices?.() ?? []
  if (!vs.length) return null // voices load asynchronously; try again next time
  chosenVoice = vs.find(v => v.lang === 'en-IN') ?? vs.find(v => /^en[-_]GB/.test(v.lang)) ?? vs.find(v => /^en/.test(v.lang)) ?? null
  return chosenVoice
}

export function speak(text: string) {
  if (!('speechSynthesis' in window) || !text) return
  const synth = window.speechSynthesis
  synth.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  const v = pickVoice()
  if (v) { utt.voice = v; utt.lang = v.lang }
  utt.rate = 1.05
  utt.pitch = 1.0
  utt.volume = 1
  // Chrome sometimes never fires onend: release the microphone after a generous estimate anyway
  let done = false
  const finish = () => { if (done) return; done = true; setTimeout(() => setTts(false), 250) }
  const guard = setTimeout(finish, 1500 + text.length * 85)
  utt.onstart = () => setTts(true)
  utt.onend = () => { clearTimeout(guard); finish() }
  utt.onerror = () => { clearTimeout(guard); finish() }
  setTts(true)
  synth.speak(utt)
}

// ── Recognition ──────────────────────────────────────────────────────────────

export type VoiceStatus =
  | 'off'          // voice switched off
  | 'listening'    // hands-free, waiting for speech
  | 'hearing'      // words arriving
  | 'recording'    // tap-to-talk: recording one phrase
  | 'thinking'     // tap-to-talk: transcribing on the server
  | 'ready'        // tap-to-talk: idle, tap the mic to speak
  | 'blocked'      // microphone permission denied
  | 'unsupported'  // no way to listen in this browser

/** iPhone and iPad: Safari's speech recognition stops and restarts unpredictably, and is
 *  unavailable in home-screen apps, so they use tap-to-talk with server transcription. */
export function isIOS(): boolean {
  const ua = navigator.userAgent
  return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && (navigator.maxTouchPoints ?? 0) > 1)
}

const DEBUG = typeof location !== 'undefined' && location.search.includes('debug')
const norm = (t: string) => t.toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim()

interface UseVoiceOptions {
  onCommand: (cmd: VoiceCommand, raw: string) => void
  enabled?: boolean
}

export function useVoice({ onCommand, enabled = true }: UseVoiceOptions) {
  const [status, setStatus] = useState<VoiceStatus>('off')
  const [transcript, setTranscript] = useState('')
  const [level, setLevel] = useState(0)
  const [mode, setMode] = useState<'continuous' | 'push'>('continuous')

  const onCommandRef = useRef(onCommand)
  useEffect(() => { onCommandRef.current = onCommand }, [onCommand])
  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  // ── command dispatch with de-duplication (interim commit + final may both arrive) ──
  const lastRun = useRef<{ text: string; at: number }>({ text: '', at: 0 })
  const run = useCallback((text: string) => {
    const n = norm(text)
    if (!n) return false
    const prev = lastRun.current
    if (Date.now() - prev.at < 4000 && (n === prev.text || prev.text.startsWith(n) || n.startsWith(prev.text))) return false
    lastRun.current = { text: n, at: Date.now() }
    onCommandRef.current(parseCommand(text), text)
    return true
  }, [])
  const clearSoon = useCallback((text: string) => {
    setTimeout(() => setTranscript(t => (t === text ? '' : t)), 2200)
  }, [])

  // ── continuous engine (Chrome, Edge, Android) ──
  const recRef = useRef<any>(null)
  const want = useRef(false)          // the user wants hands-free listening on
  const fatal = useRef(false)
  const startedAt = useRef(0)
  const backoff = useRef(300)
  const restartT = useRef<number | undefined>(undefined)
  const commitT = useRef<number | undefined>(undefined)

  const startContinuous = useCallback(() => {
    const w = window as any
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    if (DEBUG) console.log('[voice] start?', { sr: !!SR, want: want.current, fatal: fatal.current, tts: ttsActive, hidden: document.hidden, busy: !!recRef.current })
    if (!SR || !want.current || fatal.current || ttsActive || document.hidden) return
    if (recRef.current) return
    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.maxAlternatives = 3
    const lang = navigator.language || 'en-IN'
    const india = /Calcutta|Kolkata/.test(Intl.DateTimeFormat().resolvedOptions().timeZone || '')
    rec.lang = india || !/^en/.test(lang) ? 'en-IN' : lang

    rec.onstart = () => { startedAt.current = Date.now(); setStatus('listening') }
    rec.onaudiostart = () => setStatus(s => (s === 'off' ? 'listening' : s))
    rec.onresult = (e: any) => {
      if (ttsActive || recRef.current !== rec) return // our own voice, or a recogniser being replaced
      let interim = ''
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i]
        if (r.isFinal) {
          // of the alternatives, prefer one that is a real command
          let best = r[0].transcript as string
          for (let k = 0; k < r.length; k++) {
            const t = r[k].transcript as string
            if (parseCommand(t) !== 'UNKNOWN') { best = t; break }
          }
          window.clearTimeout(commitT.current)
          setTranscript(best.trim())
          run(best)
          clearSoon(best.trim())
          backoff.current = 300
        } else {
          interim += r[0].transcript
        }
      }
      interim = interim.trim()
      if (interim) {
        setStatus('hearing')
        setTranscript(interim)
        setLevel(Math.min(1, 0.35 + interim.length / 40))
        // Some phones never mark a phrase final: act once the words stop changing
        window.clearTimeout(commitT.current)
        commitT.current = window.setTimeout(() => {
          if (parseCommand(interim) !== 'UNKNOWN') { run(interim); clearSoon(interim) }
        }, 1300)
      } else {
        setStatus('listening')
        setLevel(0)
      }
    }
    rec.onerror = (ev: any) => {
      if (recRef.current !== rec) return
      const err = ev?.error
      if (err === 'not-allowed' || err === 'service-not-allowed' || err === 'audio-capture') {
        fatal.current = true
        // speech service refused but the microphone itself may work: fall back to tap-to-talk
        if (err === 'service-not-allowed' && typeof MediaRecorder !== 'undefined') { setMode('push'); setStatus('ready') }
        else setStatus('blocked')
      } else if (err === 'network') {
        backoff.current = Math.min(backoff.current * 2, 8000)
      }
    }
    rec.onend = () => {
      if (recRef.current !== rec) return // an older recogniser that was replaced: ignore it
      recRef.current = null
      setLevel(0)
      if (!want.current || fatal.current) { if (!fatal.current) setStatus('off'); return }
      // ended almost immediately: back off instead of flickering the microphone on and off
      const quick = Date.now() - startedAt.current < 1500
      backoff.current = quick ? Math.min(backoff.current * 2, 8000) : 300
      window.clearTimeout(restartT.current)
      restartT.current = window.setTimeout(startContinuous, backoff.current)
    }
    recRef.current = rec
    try { rec.start() } catch { recRef.current = null }
  }, [run, clearSoon])

  const stopContinuous = useCallback(() => {
    window.clearTimeout(restartT.current)
    window.clearTimeout(commitT.current)
    const rec = recRef.current
    recRef.current = null
    try { rec?.abort() } catch { /* already stopped */ }
  }, [])

  // ── tap-to-talk engine (iPhone, iPad, or when the speech service is unavailable) ──
  const pushBusy = useRef(false)
  const pushStop = useRef<(() => void) | null>(null)

  const talk = useCallback(async () => {
    if (pushBusy.current) { pushStop.current?.(); return } // second tap ends the recording early
    if (typeof navigator.mediaDevices?.getUserMedia !== 'function' || typeof MediaRecorder === 'undefined') { setStatus('unsupported'); return }
    pushBusy.current = true
    window.speechSynthesis?.cancel()
    let stream: MediaStream | null = null
    let ctx: AudioContext | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    } catch {
      pushBusy.current = false
      setStatus('blocked')
      return
    }
    const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/aac'].find(t => MediaRecorder.isTypeSupported?.(t)) || ''
    const rec = new MediaRecorder(stream, type ? { mimeType: type } : undefined)
    const chunks: Blob[] = []
    rec.ondataavailable = e => { if (e.data.size) chunks.push(e.data) }
    setStatus('recording')
    setTranscript('')

    // silence detection: stop 1.1 s after speech ends, or after 7 s
    let spoke = false, quietSince = 0, raf = 0
    const t0 = Date.now()
    const end = () => { cancelAnimationFrame(raf); if (rec.state !== 'inactive') rec.stop() }
    pushStop.current = end
    try {
      const AC = (window as any).AudioContext || (window as any).webkitAudioContext
      ctx = new AC() as AudioContext
      const an = ctx.createAnalyser()
      an.fftSize = 1024
      ctx.createMediaStreamSource(stream).connect(an)
      const buf = new Uint8Array(an.fftSize)
      const tick = () => {
        an.getByteTimeDomainData(buf)
        let sum = 0
        for (let i = 0; i < buf.length; i++) { const d = (buf[i] - 128) / 128; sum += d * d }
        const rms = Math.sqrt(sum / buf.length)
        setLevel(Math.min(1, rms * 6))
        const now = Date.now()
        if (rms > 0.04) { spoke = true; quietSince = 0 } else if (spoke && !quietSince) quietSince = now
        if ((spoke && quietSince && now - quietSince > 1100) || now - t0 > 7000 || (!spoke && now - t0 > 4000)) { end(); return }
        raf = requestAnimationFrame(tick)
      }
      raf = requestAnimationFrame(tick)
    } catch {
      window.setTimeout(end, 4500) // no Web Audio: fixed-length phrase
    }

    await new Promise<void>(res => { rec.onstop = () => res(); rec.start(250) })
    stream.getTracks().forEach(t => t.stop())
    try { await ctx?.close() } catch { /* ignore */ }
    setLevel(0)
    pushStop.current = null

    const blob = new Blob(chunks, { type: rec.mimeType || type || 'audio/webm' })
    if (!spoke || blob.size < 2000) {
      pushBusy.current = false
      setStatus(enabledRef.current ? 'ready' : 'off')
      setTranscript('')
      speak('I did not hear anything. Tap the microphone and speak.')
      return
    }
    setStatus('thinking')
    try {
      const text = (await transcribeAudio(blob)).trim()
      if (text) { setTranscript(text); run(text); clearSoon(text) }
      else speak('Sorry, I did not catch that.')
    } catch {
      speak('Voice is not available right now. Please try again.')
    } finally {
      pushBusy.current = false
      setStatus(enabledRef.current ? 'ready' : 'off')
    }
  }, [run, clearSoon])

  // ── lifecycle ──
  useEffect(() => {
    const w = window as any
    const SR = w.SpeechRecognition || w.webkitSpeechRecognition
    const push = isIOS() || !SR
    setMode(push ? 'push' : 'continuous')
    if (!enabled) {
      want.current = false
      stopContinuous()
      pushStop.current?.()
      setStatus('off')
      return
    }
    if (push) {
      setStatus(typeof MediaRecorder !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function' ? 'ready' : 'unsupported')
      return
    }
    want.current = true
    fatal.current = false
    backoff.current = 300
    startContinuous()
    return () => { want.current = false; stopContinuous() }
  }, [enabled, startContinuous, stopContinuous])

  // pause while the app is talking, resume afterwards; pause in the background
  useEffect(() => {
    const onTts = (on: boolean) => {
      if (!want.current) return
      if (on) { window.clearTimeout(restartT.current); stopContinuous() }
      else { window.clearTimeout(restartT.current); restartT.current = window.setTimeout(startContinuous, 300) }
    }
    ttsListeners.add(onTts)
    const onVis = () => {
      if (!want.current) return
      if (document.hidden) stopContinuous()
      else startContinuous()
    }
    document.addEventListener('visibilitychange', onVis)
    return () => { ttsListeners.delete(onTts); document.removeEventListener('visibilitychange', onVis) }
  }, [startContinuous, stopContinuous])

  const listening = status === 'listening' || status === 'hearing' || status === 'recording'
  const supported = status !== 'unsupported'
  return { listening, supported, transcript, level, status, mode, talk }
}

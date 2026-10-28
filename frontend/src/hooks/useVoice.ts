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

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.rate = 1.1
  utt.pitch = 1.0
  utt.volume = 0.9
  window.speechSynthesis.speak(utt)
}

export function useVoice({ onCommand, enabled = true }: UseVoiceOptions) {
  const recognitionRef = useRef<any>(null)
  const [listening, setListening] = useState(false)
  const [supported, setSupported] = useState(false)
  /** Last phrase heard, interim or final — drives the on-screen transcript. */
  const [transcript, setTranscript] = useState('')
  /** Rough input level 0..1, bumped on each result so the meter reacts. */
  const [level, setLevel] = useState(0)

  // Keep the latest callback without restarting recognition on every render
  const onCommandRef = useRef(onCommand)
  useEffect(() => { onCommandRef.current = onCommand }, [onCommand])

  const enabledRef = useRef(enabled)
  useEffect(() => { enabledRef.current = enabled }, [enabled])

  const start = useCallback(() => {
    const w = window as any
    const SR: { new(): any } | undefined = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR || !enabledRef.current) return
    setSupported(true)

    const rec = new SR()
    rec.continuous = true
    rec.interimResults = true
    rec.lang = navigator.language?.startsWith('en') ? navigator.language : 'en-IN'

    rec.onresult = (e: any) => {
      const last = e.results[e.results.length - 1]
      const text = last[0].transcript as string
      setTranscript(text)
      setLevel(Math.min(1, 0.35 + text.length / 40))

      if (last.isFinal) {
        const cmd = parseCommand(text)
        onCommandRef.current(cmd, text)
        // Let the phrase linger briefly, then clear
        setTimeout(() => setTranscript(t => (t === text ? '' : t)), 2200)
      }
    }

    rec.onstart = () => setListening(true)
    rec.onend = () => {
      setListening(false)
      setLevel(0)
      if (enabledRef.current) setTimeout(() => start(), 500)
    }
    rec.onerror = (ev: any) => {
      if (ev.error !== 'no-speech') console.warn('[Voice]', ev.error)
    }

    recognitionRef.current = rec
    try { rec.start() } catch {}
  }, [])

  const stop = useCallback(() => {
    const rec = recognitionRef.current
    recognitionRef.current = null
    try { rec?.stop() } catch {}
    setListening(false)
    setTranscript('')
    setLevel(0)
  }, [])

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)
    if (enabled && SR) start()
    return () => stop()
  }, [enabled, start, stop])

  return { listening, supported, transcript, level }
}

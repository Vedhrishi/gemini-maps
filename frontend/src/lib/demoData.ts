/**
 * Demo mode — a self-contained simulation of a live hazard network.
 *
 * Why this exists: the backend runs on Render's free tier, which sleeps after
 * ~15 min idle and takes 30-60s to cold start. A judge opening the link would
 * otherwise see an empty, dead map. Demo mode guarantees the app is always
 * demoable: seeded hazards render instantly and new ones stream in on a timer,
 * exercising the exact same WebSocket code path as production.
 *
 * It activates automatically when the backend can't be reached, and can be
 * toggled manually at any time.
 */

import { HazardReport } from './api'

// Hyderabad road network — real coordinates along actual corridors
const SEED_SPOTS: Array<Omit<HazardReport, 'id' | 'created_at' | 'upvotes'>> = [
  {
    hazard_type: 'pothole',
    severity: 'critical',
    description: 'Deep pothole occupying most of the left lane near the flyover exit. Roughly 70 cm across and deep enough to damage a wheel rim.',
    voice_summary: 'Critical pothole ahead. Avoid left lane.',
    suggested_action: 'Move to the right lane well before the exit. Reduce speed to 20 km/h.',
    confidence: 0.96,
    lat: 17.4504, lng: 78.3808,
    address: 'Cyber Towers Flyover',
  },
  {
    hazard_type: 'waterlogging',
    severity: 'high',
    description: 'Standing water across both carriageways after overnight rain. Depth appears to exceed 25 cm at the centre.',
    voice_summary: 'Heavy waterlogging. Use alternate route.',
    suggested_action: 'Avoid this stretch. Divert via the service road.',
    confidence: 0.91,
    lat: 17.453, lng: 78.3795,
    address: 'Shilparamam Junction',
  },
  {
    hazard_type: 'broken_signal',
    severity: 'high',
    description: 'Traffic signal fully dark at a four-way junction with no traffic warden present. Vehicles are negotiating the crossing unaided.',
    voice_summary: 'Signal down at junction. Proceed with caution.',
    suggested_action: 'Treat as an all-way stop. Expect cross traffic.',
    confidence: 0.94,
    lat: 17.4435, lng: 78.3772,
    address: 'HITEC City Main Road',
  },
  {
    hazard_type: 'debris',
    severity: 'medium',
    description: 'Construction rubble and loose gravel spilled across the shoulder and partway into the slow lane.',
    voice_summary: 'Debris on shoulder. Stay centre lane.',
    suggested_action: 'Keep to the centre lane through this stretch.',
    confidence: 0.83,
    lat: 17.447, lng: 78.386,
    address: 'Madhapur Road',
  },
  {
    hazard_type: 'road_crack',
    severity: 'medium',
    description: 'Longitudinal cracking along the lane divider, widening near the bend. Surface is uneven but passable.',
    voice_summary: 'Surface cracking ahead. Minor.',
    suggested_action: 'Reduce speed on the bend.',
    confidence: 0.78,
    lat: 17.4352, lng: 78.3805,
    address: 'Mindspace Junction',
  },
  {
    hazard_type: 'accident',
    severity: 'critical',
    description: 'Two-vehicle collision blocking the right lane. Emergency services on scene, traffic reduced to single file.',
    voice_summary: 'Accident ahead. Right lane blocked.',
    suggested_action: 'Expect delays. Merge left early.',
    confidence: 0.97,
    lat: 17.4338, lng: 78.3868,
    address: 'Durgam Cheruvu Road',
  },
  {
    hazard_type: 'pothole',
    severity: 'low',
    description: 'Shallow surface depression near the kerb, around 20 cm wide. Unlikely to cause damage at normal speeds.',
    voice_summary: 'Minor pothole near kerb.',
    suggested_action: 'No action required. Monitor.',
    confidence: 0.71,
    lat: 17.4398, lng: 78.3838,
    address: 'Raidurg Metro Road',
  },
  {
    hazard_type: 'flood',
    severity: 'critical',
    description: 'Road submerged beyond safe fording depth. Water is actively flowing across the carriageway.',
    voice_summary: 'Road flooded. Do not attempt.',
    suggested_action: 'Do not enter. Turn around and use the elevated route.',
    confidence: 0.98,
    lat: 17.4345, lng: 78.3905,
    address: 'Inorbit Mall Road',
  },
]

// Hazards that stream in during the demo, in order
const INCOMING: Array<Omit<HazardReport, 'id' | 'created_at' | 'upvotes'>> = [
  {
    hazard_type: 'pothole',
    severity: 'high',
    description: 'Freshly opened pothole after this morning\'s rain. Edges are sharp and the depression is filling with water.',
    voice_summary: 'New pothole detected. High severity.',
    suggested_action: 'Avoid the left lane approaching the signal.',
    confidence: 0.89,
    lat: 17.4462, lng: 78.3818,
    address: 'Ayyappa Society Road',
  },
  {
    hazard_type: 'debris',
    severity: 'high',
    description: 'Fallen tree branch partially blocking a lane after high winds.',
    voice_summary: 'Branch blocking lane.',
    suggested_action: 'Single-file past the obstruction.',
    confidence: 0.92,
    lat: 17.4418, lng: 78.3884,
    address: 'Kavuri Hills Road',
  },
  {
    hazard_type: 'waterlogging',
    severity: 'medium',
    description: 'Water pooling at the kerbside drain, encroaching about a metre into the slow lane.',
    voice_summary: 'Water pooling at kerb.',
    suggested_action: 'Keep right through the dip.',
    confidence: 0.81,
    lat: 17.4489, lng: 78.3901,
    address: 'Image Gardens Road',
  },
  {
    hazard_type: 'broken_signal',
    severity: 'medium',
    description: 'Pedestrian crossing signal stuck on red. Vehicle signals are operating normally.',
    voice_summary: 'Pedestrian signal fault.',
    suggested_action: 'Watch for pedestrians crossing against the signal.',
    confidence: 0.86,
    lat: 17.4512, lng: 78.376,
    address: 'Hitex Road',
  },
]

const BASE = { lat: 17.4435, lng: 78.3772 }
export type Centre = { lat: number; lng: number }
/** Sample hazards were authored around HITEC City; shift them so they sit around the given centre. */
function shift<T extends { lat: number; lng: number; address?: string }>(r: T, c?: Centre): T {
  if (!c || (Math.abs(c.lat - BASE.lat) < 0.02 && Math.abs(c.lng - BASE.lng) < 0.02)) return r
  return { ...r, lat: r.lat + (c.lat - BASE.lat), lng: r.lng + (c.lng - BASE.lng), address: 'Near you' }
}

let seq = 0
function mkId() {
  seq += 1
  return `demo-${Date.now()}-${seq}`
}

/** Seeded hazards, aged so the feed reads naturally. */
export function makeSeedReports(centre?: Centre): HazardReport[] {
  const ageMinutes = [2, 7, 14, 23, 38, 51, 74, 96]
  return SEED_SPOTS.map((spot0, i) => { const spot = shift(spot0, centre); return {
    ...spot,
    id: mkId(),
    upvotes: Math.max(0, Math.round((spot.confidence * 22) - i * 2)),
    created_at: new Date(Date.now() - ageMinutes[i] * 60_000).toISOString(),
  } })
}

/**
 * Streams simulated hazards and upvotes through the given callbacks.
 * Returns a stop function.
 */
export function startSimulation(opts: {
  onNewHazard: (r: HazardReport) => void
  /** Called with the id to increment; the caller owns the running total. */
  onUpvoteTick: (id: string) => void
  /** Current report ids, read fresh on each tick. */
  getReportIds: () => string[]
  /** where the sample hazards appear (default: HITEC City) */
  getCentre?: () => Centre | undefined
  /** ms between incoming hazards */
  hazardInterval?: number
  /** ms between upvote bursts */
  upvoteInterval?: number
}): () => void {
  const { onNewHazard, onUpvoteTick, getReportIds } = opts
  const hazardInterval = opts.hazardInterval ?? 11_000
  const upvoteInterval = opts.upvoteInterval ?? 4_000

  let idx = 0

  const hazardTimer = setInterval(() => {
    const next = INCOMING[idx % INCOMING.length]
    idx += 1
    // Jitter position slightly once we loop, so repeats don't stack exactly
    const looped = idx > INCOMING.length
    const jitter = () => (Math.random() - 0.5) * 0.004
    onNewHazard(shift({
      ...next,
      id: mkId(),
      upvotes: 0,
      lat: next.lat + (looped ? jitter() : 0),
      lng: next.lng + (looped ? jitter() : 0),
      created_at: new Date().toISOString(),
    }, opts.getCentre?.()))
  }, hazardInterval)

  const upvoteTimer = setInterval(() => {
    const ids = getReportIds()
    if (ids.length === 0) return
    onUpvoteTick(ids[Math.floor(Math.random() * ids.length)])
  }, upvoteInterval)

  return () => {
    clearInterval(hazardTimer)
    clearInterval(upvoteTimer)
  }
}

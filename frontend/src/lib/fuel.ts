/**
 * Fuel cost model for Indian roads.
 *
 * Prices are retail pump prices per litre (INR) by state / UT, taken from
 * Goodreturns' state-wise tables on 26-27 Oct 2026. Pump prices move, so the
 * UI labels every figure "approx". Andhra Pradesh diesel was missing from the
 * source table; the figure here is an estimate from the reported high in
 * Chittoor.
 *
 * Consumption is real-world, not brochure: the efficiency factor drops in
 * stop-start city traffic and above highway cruising speed.
 */

export type FuelType = 'petrol' | 'diesel' | 'ev'

export interface Vehicle {
  id: string
  label: string
  icon: string
  fuel: FuelType
  /** km per litre (km per kWh for EV) at steady 50-80 km/h */
  kmpl: number
  /** fuel tank in litres (usable battery in kWh for an EV) */
  tank: number
}

export const VEHICLES: Vehicle[] = [
  { id: 'hatch', label: 'Hatchback · petrol', icon: '🚗', fuel: 'petrol', kmpl: 17, tank: 37 },
  { id: 'sedan', label: 'Sedan · petrol', icon: '🚙', fuel: 'petrol', kmpl: 14, tank: 45 },
  { id: 'suv-p', label: 'SUV · petrol', icon: '🚐', fuel: 'petrol', kmpl: 11, tank: 55 },
  { id: 'suv-d', label: 'SUV · diesel', icon: '🛻', fuel: 'diesel', kmpl: 15, tank: 55 },
  { id: 'bike', label: 'Motorbike · petrol', icon: '🏍️', fuel: 'petrol', kmpl: 42, tank: 13 },
  { id: 'ev', label: 'Electric car', icon: '⚡', fuel: 'ev', kmpl: 6.5, tank: 40 },
]

/** Public charging, average across networks (INR per kWh). */
export const EV_PRICE_PER_KWH = 9.5

export const PRICE_DATE = '26 Oct 2026'

// [petrol, diesel] INR/litre
export const STATE_PRICES: Record<string, [number, number]> = {
  'andaman and nicobar islands': [88.66, 84.56],
  'andhra pradesh': [117.51, 105.0],
  'arunachal pradesh': [97.96, 87.32],
  assam: [105.73, 97.23],
  bihar: [113.37, 99.36],
  chandigarh: [101.54, 89.47],
  chhattisgarh: [108.3, 101.55],
  'dadra and nagar haveli and daman and diu': [99.44, 95.33],
  delhi: [102.12, 95.2],
  goa: [104.0, 95.88],
  gujarat: [102.04, 98.15],
  haryana: [103.35, 96.01],
  'himachal pradesh': [103.15, 95.28],
  'jammu and kashmir': [104.13, 92.81],
  jharkhand: [106.19, 101.31],
  karnataka: [111.68, 99.56],
  kerala: [115.49, 104.4],
  ladakh: [110.01, 94.73],
  lakshadweep: [107.5, 102.8],
  'madhya pradesh': [114.54, 99.64],
  maharashtra: [111.21, 97.83],
  manipur: [106.9, 92.59],
  meghalaya: [102.64, 94.13],
  mizoram: [106.54, 95.16],
  nagaland: [104.9, 96.18],
  odisha: [108.97, 100.68],
  puducherry: [103.58, 93.79],
  punjab: [105.56, 95.47],
  rajasthan: [113.19, 98.25],
  sikkim: [110.8, 97.7],
  'tamil nadu': [107.76, 99.55],
  telangana: [116.15, 104.23],
  tripura: [104.96, 93.85],
  'uttar pradesh': [101.86, 95.36],
  uttarakhand: [99.54, 95.05],
  'west bengal': [113.51, 99.82],
}

/** Nationwide average, used when a state can't be resolved. */
const AVG: [number, number] = [
  Object.values(STATE_PRICES).reduce((s, p) => s + p[0], 0) / Object.keys(STATE_PRICES).length,
  Object.values(STATE_PRICES).reduce((s, p) => s + p[1], 0) / Object.keys(STATE_PRICES).length,
]

const ALIASES: Record<string, string> = {
  'nct of delhi': 'delhi',
  'national capital territory of delhi': 'delhi',
  'new delhi': 'delhi',
  orissa: 'odisha',
  pondicherry: 'puducherry',
  'andaman and nicobar': 'andaman and nicobar islands',
  'andaman & nicobar islands': 'andaman and nicobar islands',
  'dadra and nagar haveli': 'dadra and nagar haveli and daman and diu',
  'daman and diu': 'dadra and nagar haveli and daman and diu',
  'jammu & kashmir': 'jammu and kashmir',
  uttaranchal: 'uttarakhand',
}

/** Outside India: world-average pump price (about US$1.30/L, Feb 2026 survey) at roughly ₹88/US$. */
const WORLD: [number, number] = [114, 114]
export const INR_PER_USD = 88
const WORLD_EV_INR_PER_KWH = 26.4 // about US$0.30/kWh

export function normaliseState(raw: string | undefined | null): string | null {
  if (!raw) return null
  if (raw === 'world') return 'world'
  const k = raw.toLowerCase().replace(/&/g, 'and').replace(/\s+/g, ' ').trim()
  const key = ALIASES[k] ?? k
  return STATE_PRICES[key] ? key : null
}

export function prettyState(key: string | null): string {
  if (!key) return 'India (avg)'
  if (key === 'world') return 'Outside India (world avg)'
  return key.replace(/\b\w/g, c => c.toUpperCase()).replace(/ And /g, ' & ')
}

export function priceFor(state: string | null, v: Vehicle): number {
  if (v.fuel === 'ev') return state === 'world' ? WORLD_EV_INR_PER_KWH : EV_PRICE_PER_KWH
  const p = state === 'world' ? WORLD : state && STATE_PRICES[state] ? STATE_PRICES[state] : AVG
  return v.fuel === 'diesel' ? p[1] : p[0]
}

/** Piecewise-linear lookup through [speed km/h, factor] points. */
function lerp(pts: [number, number][], x: number): number {
  if (x <= pts[0][0]) return pts[0][1]
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const [x0, y0] = pts[i - 1], [x1, y1] = pts[i]
      return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0)
    }
  }
  return pts[pts.length - 1][1]
}

// Fuel economy against steady speed (1.0 = the vehicle's rated real-world figure at 55-70 km/h).
// Stop-start traffic and fast cruising both burn more than the sweet spot.
const ICE_CURVE: [number, number][] = [[5, 0.5], [15, 0.62], [25, 0.78], [35, 0.9], [50, 0.99], [62, 1.0], [80, 0.97], [90, 0.91], [100, 0.84], [110, 0.76], [125, 0.66]]
// An EV recovers energy in the city but loses range quickly at highway speed (air drag).
const EV_CURVE: [number, number][] = [[5, 1.05], [15, 1.12], [30, 1.12], [50, 1.06], [65, 1.0], [80, 0.9], [100, 0.74], [120, 0.6]]
// Motorbikes are light: less penalty from drag, same stop-start penalty
const BIKE_CURVE: [number, number][] = [[5, 0.55], [15, 0.68], [25, 0.84], [40, 0.97], [55, 1.0], [70, 0.97], [85, 0.88], [100, 0.76]]

/** Efficiency multiplier at a given average speed (km/h). */
export function efficiencyFactor(kmh: number, v: Vehicle): number {
  return lerp(v.fuel === 'ev' ? EV_CURVE : v.id === 'bike' ? BIKE_CURVE : ICE_CURVE, kmh)
}

export interface FuelChunk {
  /** metres along the route where this chunk starts / ends */
  start: number
  end: number
  state: string | null
  price: number
  litres: number
  cost: number
}

export interface FuelEstimate {
  chunks: FuelChunk[]
  litres: number
  cost: number
  unit: 'L' | 'kWh'
  perState: { state: string; km: number; price: number; cost: number }[]
  avgKmh: number
  /** true when at least one state could not be resolved */
  partial: boolean
  /** costs and prices are in this currency: INR in India, USD elsewhere */
  currency: 'INR' | 'USD'
  /** how far one full tank (or charge) really lasts on this route, km */
  rangeKm: number
  /** fuel or charging stops needed on the way */
  stops: number
}

/**
 * Build the estimate from per-chunk state labels.
 * `states[i]` is the state for chunk i; chunks are equal-length slices of the route.
 */
export function buildEstimate(
  totalMeters: number,
  durationSec: number,
  states: (string | null)[],
  v: Vehicle,
  /** speed (km/h) actually driven at `d` metres along the route; falls back to the route average */
  speedAt?: (d: number) => number,
): FuelEstimate {
  const n = Math.max(1, states.length)
  const step = totalMeters / n
  const avgKmh = durationSec > 0 ? (totalMeters / 1000) / (durationSec / 3600) : 50
  const usd = states.filter(x => x === 'world').length > states.length / 2
  const fx = usd ? 1 / INR_PER_USD : 1
  const chunks: FuelChunk[] = []
  const agg = new Map<string, { km: number; cost: number; price: number }>()
  let litres = 0
  let cost = 0
  states.forEach((s, i) => {
    const km = step / 1000
    const speed = speedAt ? speedAt((i + 0.5) * step) : avgKmh
    const l = km / (v.kmpl * efficiencyFactor(speed, v))
    const price = priceFor(s, v) * fx
    const c = l * price
    litres += l
    cost += c
    chunks.push({ start: i * step, end: (i + 1) * step, state: s, price, litres: l, cost: c })
    const label = prettyState(s)
    const cur = agg.get(label) ?? { km: 0, cost: 0, price }
    cur.km += km
    cur.cost += c
    agg.set(label, cur)
  })
  // Usable range: a full tank less a 10% reserve, at this route's own economy
  const kmPerUnit = litres > 0 ? totalMeters / 1000 / litres : v.kmpl
  const rangeKm = Math.max(50, v.tank * kmPerUnit * 0.9)
  const stops = Math.max(0, Math.ceil(totalMeters / 1000 / rangeKm) - 1)
  return {
    rangeKm, stops,
    chunks, litres, cost,
    unit: v.fuel === 'ev' ? 'kWh' : 'L',
    perState: [...agg.entries()].map(([state, a]) => ({ state, ...a })),
    avgKmh,
    partial: states.some(s => !s),
    currency: usd ? 'USD' : 'INR',
  }
}

/** Cost and litres consumed by distance `d` (metres) along the route. */
export function fuelUsedAt(est: FuelEstimate, d: number): { litres: number; cost: number } {
  let litres = 0
  let cost = 0
  for (const c of est.chunks) {
    if (d >= c.end) { litres += c.litres; cost += c.cost; continue }
    if (d > c.start) {
      const f = (d - c.start) / (c.end - c.start)
      litres += c.litres * f
      cost += c.cost * f
    }
    break
  }
  return { litres, cost }
}

export const sym = (cur: 'INR' | 'USD') => (cur === 'USD' ? '$' : '₹')

/** Format a cost in the estimate's own currency. */
export const money = (n: number, cur: 'INR' | 'USD' = 'INR') =>
  cur === 'USD' ? '$' + (n >= 100 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)) : inr(n)

export const inr = (n: number) =>
  '₹' + (n >= 1000 ? Math.round(n).toLocaleString('en-IN') : n.toFixed(n >= 100 ? 0 : 1))

/**
 * How much a given hazard matters to a given vehicle. A pothole that a lifted SUV
 * shrugs off can bend a hatchback's rim or throw a motorbike; waterlogging that
 * is fine for a diesel SUV can swamp a low car or an EV's battery pack.
 */
const SENSITIVITY: Record<string, Record<string, number>> = {
  hatch: { pothole: 1.3, road_crack: 1.1, waterlogging: 1.3, flood: 1.2, debris: 1.1 },
  sedan: { pothole: 1.5, road_crack: 1.2, waterlogging: 1.5, flood: 1.3, debris: 1.2 },
  'suv-p': { pothole: 0.8, road_crack: 0.8, waterlogging: 0.7, flood: 1.0, debris: 0.9 },
  'suv-d': { pothole: 0.8, road_crack: 0.8, waterlogging: 0.7, flood: 1.0, debris: 0.9 },
  bike: { pothole: 2.2, road_crack: 1.8, waterlogging: 2.0, flood: 1.5, debris: 2.0, accident: 1.3 },
  ev: { pothole: 1.4, road_crack: 1.1, waterlogging: 1.6, flood: 1.5, debris: 1.1 },
}

export function hazardMultiplier(vehicleId: string, hazardType: string): number {
  return SENSITIVITY[vehicleId]?.[hazardType] ?? 1
}

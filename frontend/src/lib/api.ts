import axios from 'axios'

export const API_URL = import.meta.env.VITE_API_URL || 'https://gemini-maps-api.onrender.com'
/** The free backend sleeps when idle. Waking it now overlaps its start-up with the splash and first paint. */
if (typeof window !== 'undefined') {
  const wake = () => { fetch(`${API_URL}/health`, { mode: 'cors', cache: 'no-store' }).catch(() => {}) }
  if ('requestIdleCallback' in window) (window as any).requestIdleCallback(wake, { timeout: 1500 }); else setTimeout(wake, 300)
}
export const WS_URL = API_URL.replace('https://', 'wss://').replace('http://', 'ws://')

export interface HazardReport {
  id: string
  hazard_type: string
  severity: 'low' | 'medium' | 'high' | 'critical'
  description: string
  voice_summary: string
  suggested_action: string
  confidence: number
  lat: number
  lng: number
  address?: string
  upvotes: number
  created_at: string
  /** Which model classified the photo: "muse-spark", "gemini" or "mock". */
  ai_model?: string
  /** SAM 3.1 boxes around the hazard, normalised 0..1 to the photo. */
  segments?: { x1: number; y1: number; x2: number; y2: number; c?: number }[]
}

export interface AnalyzeResponse {
  is_road_hazard: boolean
  report?: HazardReport
  merged?: boolean
  confidence?: number
  voice_summary?: string
  ai_model?: string
}

export async function analyzeImage(
  blob: Blob,
  lat: number,
  lng: number,
  address = '',
): Promise<AnalyzeResponse> {
  const form = new FormData()
  form.append('file', blob, 'capture.jpg')
  form.append('lat', String(lat))
  form.append('lng', String(lng))
  form.append('address', address)
  const { data } = await axios.post<AnalyzeResponse>(`${API_URL}/api/analyze`, form)
  return data
}

export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData()
  const ext = /mp4|aac|m4a/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : /wav/.test(blob.type) ? 'wav' : 'webm'
  form.append('file', blob, `voice.${ext}`)
  const { data } = await axios.post<{ text: string }>(`${API_URL}/api/transcribe`, form, { timeout: 25000 })
  return data.text
}

export async function fetchReports(): Promise<HazardReport[]> {
  const { data } = await axios.get<{ reports?: HazardReport[] } | HazardReport[]>(
    `${API_URL}/api/reports`
  )
  // Tolerate both {reports:[...]} and a bare [...] payload
  if (Array.isArray(data)) return data
  return Array.isArray(data?.reports) ? data.reports : []
}

export async function upvoteReport(id: string): Promise<number> {
  const { data } = await axios.post<{ upvotes?: number }>(`${API_URL}/api/reports/${id}/upvote`)
  return typeof data?.upvotes === 'number' ? data.upvotes : 0
}


/** Which AI model the backend is really using ("gemini" | "muse" | "mock"). */
export async function fetchProvider(): Promise<string> {
  try {
    const r = await fetch(`${API_URL}/health`, { mode: 'cors', cache: 'no-store' })
    const j = await r.json()
    return String(j.serving || j.provider || '')
  } catch { return '' }
}

export const providerLabel = (p: string) =>
  p === 'muse-wonder' ? 'Meta Muse Wonder' : p.startsWith('muse') ? 'Meta Muse Spark' : p === 'gemini' ? 'Gemini' : 'AI vision'

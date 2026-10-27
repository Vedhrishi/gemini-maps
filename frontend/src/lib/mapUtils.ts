
export const HAZARD_ICONS: Record<string, string> = {
  pothole: '🕳️',
  debris: '🪨',
  flood: '🌊',
  accident: '💥',
  broken_signal: '🚦',
  road_crack: '⚡',
  waterlogging: '💧',
  other: '⚠️',
}

export const HAZARD_LABELS: Record<string, string> = {
  pothole: 'Pothole',
  debris: 'Debris',
  flood: 'Flood',
  accident: 'Accident',
  broken_signal: 'Broken Signal',
  road_crack: 'Road Crack',
  waterlogging: 'Waterlogging',
  other: 'Hazard',
}

export const SEVERITY_COLORS: Record<string, string> = {
  low: '#00cc66',
  medium: '#ffaa00',
  high: '#ff6600',
  critical: '#ff2266',
}

export const SEVERITY_BG: Record<string, string> = {
  low: 'rgba(0,204,102,0.15)',
  medium: 'rgba(255,170,0,0.15)',
  high: 'rgba(255,102,0,0.15)',
  critical: 'rgba(255,34,102,0.18)',
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

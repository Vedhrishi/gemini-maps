import L from 'leaflet'

export const HAZARD_ICONS: Record<string, string> = {
  pothole: '🕳️',
  debris: '🪨',
  flood: '🌊',
  accident: '🚗',
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
  low: '#388bfd',
  medium: '#d29922',
  high: '#f85149',
  critical: '#da3633',
}

export const SEVERITY_BG: Record<string, string> = {
  low: 'rgba(56,139,253,0.15)',
  medium: 'rgba(210,153,34,0.15)',
  high: 'rgba(248,81,73,0.15)',
  critical: 'rgba(218,54,51,0.2)',
}

export function createHazardIcon(hazardType: string, severity: string) {
  const emoji = HAZARD_ICONS[hazardType] || '⚠️'
  const color = SEVERITY_COLORS[severity] || '#8b949e'
  return L.divIcon({
    className: '',
    html: `
      <div style="
        display:flex;align-items:center;justify-content:center;
        width:40px;height:40px;border-radius:50%;
        background:${color};
        border:2px solid #fff;
        box-shadow:0 2px 8px rgba(0,0,0,0.5);
        font-size:20px;
        cursor:pointer;
        transition:transform 0.15s;
      ">${emoji}</div>
    `,
    iconSize: [40, 40],
    iconAnchor: [20, 20],
    popupAnchor: [0, -20],
  })
}

export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  if (diff < 60000) return 'just now'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`
  return `${Math.floor(diff / 86400000)}d ago`
}

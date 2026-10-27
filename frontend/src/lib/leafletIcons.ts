import L from 'leaflet'
import { HAZARD_ICONS, SEVERITY_COLORS, SEVERITY_BG } from './mapUtils'

export function createHazardIcon(hazardType: string, severity: string, isNew = false) {
  const emoji = HAZARD_ICONS[hazardType] || '⚠️'
  const color = SEVERITY_COLORS[severity] || '#00d4ff'
  const pulse = severity === 'critical' || severity === 'high'
  const size = severity === 'critical' ? 46 : 40

  return L.divIcon({
    className: '',
    html: `
      <div style="position:relative;width:${size}px;height:${size}px;">
        ${pulse ? `
          <div style="
            position:absolute;inset:-8px;border-radius:50%;
            border:2px solid ${color};
            opacity:0.5;
            animation:hazard-ping 1.8s ease-out infinite;
          "></div>
          <div style="
            position:absolute;inset:-4px;border-radius:50%;
            border:1.5px solid ${color};
            opacity:0.3;
            animation:hazard-ping 1.8s ease-out 0.6s infinite;
          "></div>
        ` : ''}
        ${isNew ? `
          <div style="
            position:absolute;inset:-12px;border-radius:50%;
            border:2px solid ${color};
            opacity:0.7;
            animation:hazard-ping 1s ease-out infinite;
          "></div>
        ` : ''}
        <div style="
          position:relative;
          width:${size}px;height:${size}px;border-radius:50%;
          background:radial-gradient(circle at 35% 35%, ${color}cc, ${color}66);
          border:2px solid ${color};
          box-shadow:0 0 16px ${color}88, 0 0 32px ${color}33, inset 0 1px 0 rgba(255,255,255,0.3);
          display:flex;align-items:center;justify-content:center;
          font-size:${severity === 'critical' ? 22 : 18}px;
          cursor:pointer;
          backdrop-filter:blur(4px);
        ">${emoji}</div>
      </div>
      <style>
        @keyframes hazard-ping {
          0% { transform:scale(1); opacity:0.7; }
          100% { transform:scale(2); opacity:0; }
        }
      </style>
    `,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
    popupAnchor: [0, -(size / 2 + 8)],
  })
}


import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet'
import L from 'leaflet'
import { HazardReport } from '../lib/api'
import {
  createHazardIcon, HAZARD_LABELS, SEVERITY_COLORS,
  SEVERITY_BG, timeAgo,
} from '../lib/mapUtils'
import 'leaflet/dist/leaflet.css'

// Fix leaflet marker icons in Vite
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => { map.flyTo([lat, lng], 16, { duration: 1 }) }, [lat, lng])
  return null
}

interface Props {
  reports: HazardReport[]
  focusId?: string | null
  onUpvote: (id: string) => void
}

export function HazardMap({ reports, focusId, onUpvote }: Props) {
  const focused = focusId ? reports.find(r => r.id === focusId) : null

  return (
    <div style={{ height: '100%', width: '100%' }}>
      <MapContainer
        center={[20.5937, 78.9629]}
        zoom={5}
        style={{ height: '100%', width: '100%' }}
        zoomControl={true}
      >
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a>'
        />

        {focused && <FlyTo lat={focused.lat} lng={focused.lng} />}

        {reports.map(r => (
          <Marker
            key={r.id}
            position={[r.lat, r.lng]}
            icon={createHazardIcon(r.hazard_type, r.severity)}
          >
            <Popup maxWidth={280}>
              <div style={{
                background: 'var(--surface)',
                color: 'var(--text)',
                minWidth: 240,
                padding: '4px 0',
              }}>
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  marginBottom: 8,
                }}>
                  <span style={{
                    background: SEVERITY_BG[r.severity],
                    color: SEVERITY_COLORS[r.severity],
                    border: `1px solid ${SEVERITY_COLORS[r.severity]}`,
                    borderRadius: 4,
                    padding: '2px 8px',
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'uppercase',
                  }}>{r.severity}</span>
                  <span style={{ fontWeight: 600, fontSize: 13 }}>
                    {HAZARD_LABELS[r.hazard_type] || 'Hazard'}
                  </span>
                </div>

                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.4 }}>
                  {r.description}
                </p>

                {r.suggested_action && (
                  <p style={{ fontSize: 11, color: '#d29922', marginBottom: 8 }}>
                    💡 {r.suggested_action}
                  </p>
                )}

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <span style={{ fontSize: 11, color: 'var(--text2)' }}>{timeAgo(r.created_at)}</span>
                  <button
                    onClick={() => onUpvote(r.id)}
                    style={{
                      background: 'var(--surface2)',
                      color: 'var(--text)',
                      padding: '4px 10px',
                      fontSize: 12,
                      border: '1px solid var(--border)',
                    }}
                  >
                    👍 {r.upvotes}
                  </button>
                </div>
              </div>
            </Popup>
          </Marker>
        ))}
      </MapContainer>
    </div>
  )
}

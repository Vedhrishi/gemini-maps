import { useEffect, useRef } from 'react'
import { MapContainer, TileLayer, Marker, Popup, Circle, useMap } from 'react-leaflet'
import L from 'leaflet'
import { HazardReport } from '../lib/api'
import {
  HAZARD_LABELS, SEVERITY_COLORS,
  SEVERITY_BG, timeAgo,
} from '../lib/mapUtils'
import { createHazardIcon } from '../lib/leafletIcons'
import 'leaflet/dist/leaflet.css'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

function FlyTo({ lat, lng }: { lat: number; lng: number }) {
  const map = useMap()
  useEffect(() => {
    map.flyTo([lat, lng], 16, { duration: 1.4, easeLinearity: 0.2 })
  }, [lat, lng, map])
  return null
}

/**
 * Frames the map on the hazards the first time any arrive.
 * Without this the view sits at the country-wide default while every pin is
 * clustered in one city — the map reads as empty until you manually zoom.
 * Only fires once, so it never fights the user's own panning afterwards.
 */
function FitToHazards({ reports }: { reports: HazardReport[] }) {
  const map = useMap()
  const done = useRef(false)

  useEffect(() => {
    if (done.current || reports.length === 0) return
    done.current = true

    if (reports.length === 1) {
      map.flyTo([reports[0].lat, reports[0].lng], 15, { duration: 1.6 })
      return
    }
    const bounds = L.latLngBounds(reports.map(r => [r.lat, r.lng] as [number, number]))
    map.flyToBounds(bounds, { padding: [70, 70], maxZoom: 15, duration: 1.8 })
  }, [reports, map])

  return null
}

interface Props {
  reports: HazardReport[]
  focusId?: string | null
  newHazardId?: string | null
  onUpvote: (id: string) => void
}

export function HazardMap({ reports, focusId, newHazardId, onUpvote }: Props) {
  const focused = focusId ? reports.find(r => r.id === focusId) : null

  return (
    <div style={{ height: '100%', width: '100%', position: 'relative' }}>
      {/* HUD corner brackets over the map */}
      {(['tl', 'tr', 'bl', 'br'] as const).map(c => (
        <div key={c} style={{
          position: 'absolute', zIndex: 900, pointerEvents: 'none',
          top: c.startsWith('t') ? 14 : undefined,
          bottom: c.startsWith('b') ? 14 : undefined,
          left: c.endsWith('l') ? 14 : undefined,
          right: c.endsWith('r') ? 14 : undefined,
          width: 26, height: 26,
          borderTop: c.startsWith('t') ? '2px solid rgba(0,212,255,0.35)' : 'none',
          borderBottom: c.startsWith('b') ? '2px solid rgba(0,212,255,0.35)' : 'none',
          borderLeft: c.endsWith('l') ? '2px solid rgba(0,212,255,0.35)' : 'none',
          borderRight: c.endsWith('r') ? '2px solid rgba(0,212,255,0.35)' : 'none',
          borderRadius: c === 'tl' ? '6px 0 0 0' : c === 'tr' ? '0 6px 0 0' : c === 'bl' ? '0 0 0 6px' : '0 0 6px 0',
        }} />
      ))}

      {/* Vignette */}
      <div style={{
        position: 'absolute', inset: 0, zIndex: 850, pointerEvents: 'none',
        boxShadow: 'inset 0 0 120px rgba(0,8,20,0.75)',
      }} />

      <MapContainer
        center={[20.5937, 78.9629]}
        zoom={5}
        style={{ height: '100%', width: '100%', background: '#020608' }}
        zoomControl={true}
      >
        {/* OSM tiles, darkened via CSS filter — mission control look, no API key */}
        <TileLayer
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          attribution='© <a href="https://openstreetmap.org">OpenStreetMap</a>'
          maxZoom={19}
          className="dark-tiles"
        />

        <FitToHazards reports={reports} />
        {focused && <FlyTo lat={focused.lat} lng={focused.lng} />}

        {/* Danger radius for critical/high hazards */}
        {reports.map(r => (
          (r.severity === 'critical' || r.severity === 'high') && (
            <Circle
              key={`circle-${r.id}`}
              center={[r.lat, r.lng]}
              radius={r.severity === 'critical' ? 160 : 100}
              pathOptions={{
                color: SEVERITY_COLORS[r.severity],
                fillColor: SEVERITY_COLORS[r.severity],
                fillOpacity: 0.07,
                weight: 1,
                opacity: 0.35,
              }}
            />
          )
        ))}

        {reports.map(r => (
          <Marker
            key={r.id}
            position={[r.lat, r.lng]}
            icon={createHazardIcon(r.hazard_type, r.severity, r.id === newHazardId)}
          >
            <Popup maxWidth={300}>
              <div style={{ color: '#e8f4ff', minWidth: 250 }}>
                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginBottom: 10 }}>
                  <span style={{
                    background: SEVERITY_COLORS[r.severity],
                    color: '#000',
                    borderRadius: 5,
                    padding: '3px 9px',
                    fontSize: 10,
                    fontWeight: 800,
                    letterSpacing: '0.07em',
                    textTransform: 'uppercase',
                    boxShadow: `0 0 12px ${SEVERITY_COLORS[r.severity]}70`,
                  }}>{r.severity}</span>
                  <span style={{ fontWeight: 700, fontSize: 14, fontFamily: "'Space Grotesk', sans-serif" }}>
                    {HAZARD_LABELS[r.hazard_type] || 'Hazard'}
                  </span>
                </div>

                <p style={{ fontSize: 12.5, color: '#9fc0dd', marginBottom: 10, lineHeight: 1.5 }}>
                  {r.description}
                </p>

                {r.suggested_action && (
                  <div style={{
                    background: 'rgba(255,170,0,0.08)',
                    border: '1px solid rgba(255,170,0,0.22)',
                    borderRadius: 7, padding: '7px 10px',
                    fontSize: 11.5, color: '#ffaa00', marginBottom: 10,
                  }}>
                    💡 {r.suggested_action}
                  </div>
                )}

                {/* Telemetry row */}
                <div style={{
                  display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8,
                  marginBottom: 10, fontSize: 10.5,
                }}>
                  <div>
                    <div style={{ color: '#4a6a8a', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 9 }}>Confidence</div>
                    <div style={{ color: '#00d4ff', fontWeight: 700, fontSize: 12 }}>
                      {Math.round((r.confidence ?? 0) * 100)}%
                    </div>
                  </div>
                  <div>
                    <div style={{ color: '#4a6a8a', letterSpacing: '0.1em', textTransform: 'uppercase', fontSize: 9 }}>Coordinates</div>
                    <div style={{ color: '#7ab8ff', fontWeight: 600, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>
                      {r.lat.toFixed(4)}, {r.lng.toFixed(4)}
                    </div>
                  </div>
                </div>

                <div style={{
                  display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                  borderTop: '1px solid rgba(0,212,255,0.1)', paddingTop: 9,
                }}>
                  <span style={{ fontSize: 11, color: '#4a6a8a' }}>{timeAgo(r.created_at)}</span>
                  <button
                    onClick={() => onUpvote(r.id)}
                    style={{
                      background: 'rgba(0,212,255,0.08)',
                      color: '#00d4ff',
                      padding: '5px 12px',
                      fontSize: 12,
                      fontWeight: 600,
                      border: '1px solid rgba(0,212,255,0.22)',
                      borderRadius: 8,
                      cursor: 'pointer',
                    }}
                  >
                    ▲ Confirm · {r.upvotes}
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

import { HazardReport } from '../lib/api'
import { HAZARD_ICONS, HAZARD_LABELS, SEVERITY_COLORS, timeAgo } from '../lib/mapUtils'

interface Props {
  reports: HazardReport[]
  onFocus: (id: string) => void
  onUpvote: (id: string) => void
}

export function HazardList({ reports, onFocus, onUpvote }: Props) {
  if (reports.length === 0) {
    return (
      <div style={{
        display: 'flex', flexDirection: 'column', alignItems: 'center',
        justifyContent: 'center', height: '100%', gap: 16, padding: 32,
      }}>
        {/* Animated radar */}
        <div style={{ position: 'relative', width: 90, height: 90 }}>
          {[0, 1, 2].map(i => (
            <div key={i} style={{
              position: 'absolute', inset: 0, borderRadius: '50%',
              border: '1px solid rgba(0,212,255,0.25)',
              animation: `radar-sweep 3s ease-out ${i * 1}s infinite`,
            }} />
          ))}
          <div style={{
            position: 'absolute', inset: 0, display: 'flex',
            alignItems: 'center', justifyContent: 'center', fontSize: 30, opacity: 0.7,
          }}>🛰</div>
        </div>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            fontWeight: 700, marginBottom: 6, fontSize: 15,
            fontFamily: 'var(--font2)', color: 'var(--text2)',
          }}>Scanning for hazards</div>
          <div style={{ fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            No reports in range yet.<br />
            Say <span style={{ color: 'var(--accent)' }}>"report hazard"</span> to add the first one.
          </div>
        </div>
        <style>{`
          @keyframes radar-sweep {
            0% { transform: scale(0.4); opacity: 0.8; }
            100% { transform: scale(1.4); opacity: 0; }
          }
        `}</style>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', overflow: 'auto', height: '100%' }}>
      {reports.map((r, i) => {
        const c = SEVERITY_COLORS[r.severity] ?? '#00d4ff'
        return (
          <div
            key={r.id}
            onClick={() => onFocus(r.id)}
            style={{
              padding: '13px 16px',
              display: 'flex', alignItems: 'flex-start', gap: 12,
              cursor: 'pointer',
              borderBottom: '1px solid rgba(0,212,255,0.05)',
              borderLeft: `2px solid ${c}`,
              background: 'transparent',
              transition: 'background 0.15s ease',
              animation: `slideUp 0.3s ease ${Math.min(i * 0.04, 0.4)}s both`,
            }}
            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(0,212,255,0.04)')}
            onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
          >
            {/* Icon orb */}
            <div style={{
              width: 38, height: 38, borderRadius: '50%', flexShrink: 0,
              background: `radial-gradient(circle at 35% 35%, ${c}44, ${c}11)`,
              border: `1px solid ${c}55`,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 17,
              boxShadow: `0 0 12px ${c}33`,
            }}>
              {HAZARD_ICONS[r.hazard_type] || '⚠️'}
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 5 }}>
                <span style={{
                  background: c, color: '#000',
                  borderRadius: 4, padding: '1px 7px', fontSize: 9, fontWeight: 800,
                  letterSpacing: '0.07em', textTransform: 'uppercase',
                }}>{r.severity}</span>
                <span style={{ fontWeight: 600, fontSize: 13, fontFamily: 'var(--font2)' }}>
                  {HAZARD_LABELS[r.hazard_type] ?? r.hazard_type}
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 10, color: 'var(--text3)' }}>
                  {Math.round((r.confidence ?? 0) * 100)}%
                </span>
              </div>

              <p style={{
                fontSize: 12, color: 'var(--text2)', marginBottom: 8, lineHeight: 1.45,
                display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical',
                overflow: 'hidden',
              }}>
                {r.description}
              </p>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{
                  fontSize: 10.5, color: 'var(--text3)',
                  fontVariantNumeric: 'tabular-nums',
                }}>
                  {timeAgo(r.created_at)} · {r.lat.toFixed(3)}, {r.lng.toFixed(3)}
                </span>
                <button
                  onClick={e => { e.stopPropagation(); onUpvote(r.id) }}
                  style={{
                    background: 'rgba(0,212,255,0.07)',
                    color: 'var(--accent)',
                    padding: '4px 10px', fontSize: 11, fontWeight: 600,
                    border: '1px solid rgba(0,212,255,0.18)',
                    borderRadius: 7,
                  }}
                >▲ {r.upvotes}</button>
              </div>
            </div>
          </div>
        )
      })}
      <style>{`
        @keyframes slideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      `}</style>
    </div>
  )
}

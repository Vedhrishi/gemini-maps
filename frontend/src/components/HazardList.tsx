import { HazardReport } from '../lib/api'
import { HAZARD_ICONS, HAZARD_LABELS, SEVERITY_COLORS, SEVERITY_BG, timeAgo } from '../lib/mapUtils'

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
        justifyContent: 'center', height: '100%',
        color: 'var(--text2)', gap: 12, padding: 24,
      }}>
        <span style={{ fontSize: 48 }}>🗺️</span>
        <div style={{ textAlign: 'center' }}>
          <div style={{ fontWeight: 600, marginBottom: 4 }}>No reports yet</div>
          <div style={{ fontSize: 12 }}>Be the first to report a road hazard!</div>
        </div>
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1, overflow: 'auto', height: '100%' }}>
      {reports.map(r => (
        <div
          key={r.id}
          style={{
            background: 'var(--surface)',
            padding: '12px 16px',
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            cursor: 'pointer',
            transition: 'background 0.1s',
          }}
          onClick={() => onFocus(r.id)}
          onMouseEnter={e => (e.currentTarget.style.background = 'var(--surface2)')}
          onMouseLeave={e => (e.currentTarget.style.background = 'var(--surface)')}
        >
          <span style={{ fontSize: 24, flexShrink: 0, marginTop: 2 }}>
            {HAZARD_ICONS[r.hazard_type] || '⚠️'}
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
              <span style={{
                background: SEVERITY_BG[r.severity],
                color: SEVERITY_COLORS[r.severity],
                border: `1px solid ${SEVERITY_COLORS[r.severity]}44`,
                borderRadius: 4, padding: '1px 6px', fontSize: 10, fontWeight: 700,
                textTransform: 'uppercase',
              }}>{r.severity}</span>
              <span style={{ fontWeight: 600, fontSize: 13 }}>
                {HAZARD_LABELS[r.hazard_type]}
              </span>
            </div>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6, lineHeight: 1.4 }}>
              {r.description}
            </p>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ fontSize: 11, color: 'var(--text2)' }}>{timeAgo(r.created_at)}</span>
              <button
                onClick={e => { e.stopPropagation(); onUpvote(r.id) }}
                style={{
                  background: 'var(--surface2)',
                  color: 'var(--text)',
                  padding: '3px 8px',
                  fontSize: 11,
                  border: '1px solid var(--border)',
                }}
              >
                👍 {r.upvotes}
              </button>
            </div>
          </div>
        </div>
      ))}
    </div>
  )
}

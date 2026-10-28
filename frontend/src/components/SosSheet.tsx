/**
 * Emergency sheet: one tap to call India's emergency numbers, and one tap to
 * send your exact location to someone you trust.
 */
const NUMBERS: { n: string; label: string; note: string }[] = [
  { n: '112', label: 'Emergency', note: 'Police, fire and ambulance, anywhere in India' },
  { n: '108', label: 'Ambulance', note: 'Medical emergency in most states' },
  { n: '1033', label: 'Highway helpline', note: 'Accidents and breakdowns on national highways' },
]

export function SosSheet({ onClose, onShareLocation, hasFix, isDesktop }: {
  onClose: () => void
  onShareLocation: () => void
  hasFix: boolean
  isDesktop: boolean
}) {
  return (
    <div onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sos-title" style={{
      position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(2,6,16,0.8)',
      display: 'grid', placeItems: isDesktop ? 'center' : 'end stretch', animation: 'fadeIn 0.2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0b0f1c', border: '1px solid rgba(255,51,85,0.45)',
        borderRadius: isDesktop ? 16 : '18px 18px 0 0', width: isDesktop ? 420 : '100%',
        padding: isDesktop ? '22px 24px' : '20px 18px calc(20px + env(safe-area-inset-bottom))',
        boxShadow: '0 24px 64px rgba(0,0,0,0.7)', display: 'flex', flexDirection: 'column', gap: 12,
        animation: 'slideUp 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 id="sos-title" style={{ margin: 0, flex: 1, fontFamily: 'var(--font2)', fontSize: 19, color: '#ff5c77' }}>Emergency</h2>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text2)', width: 32, height: 32, borderRadius: 8, fontSize: 18,
          }}>×</button>
        </div>

        {NUMBERS.map(x => (
          <a key={x.n} href={`tel:${x.n}`} style={{
            display: 'flex', alignItems: 'center', gap: 14, textDecoration: 'none',
            background: 'rgba(255,51,85,0.08)', border: '1px solid rgba(255,51,85,0.3)',
            borderRadius: 12, padding: '12px 14px', color: 'var(--text)',
          }}>
            <span style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 22, color: '#ff5c77', minWidth: 58 }}>{x.n}</span>
            <span style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              <span style={{ fontWeight: 700, fontSize: 14 }}>Call {x.label}</span>
              <span style={{ fontSize: 12, color: 'var(--text3)' }}>{x.note}</span>
            </span>
          </a>
        ))}

        <button onClick={onShareLocation} disabled={!hasFix} style={{
          marginTop: 4, padding: '13px 14px', borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 14,
          color: '#fff', background: hasFix ? 'linear-gradient(135deg,#0050ff,#00b4ff)' : 'rgba(255,255,255,0.08)',
          opacity: hasFix ? 1 : 0.7,
        }}>
          {hasFix ? '📍 Send my exact location' : 'Turn on location to share where you are'}
        </button>
        <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
          Your location is only sent to the person you choose. Numbers shown are for India.
        </p>
      </div>
    </div>
  )
}

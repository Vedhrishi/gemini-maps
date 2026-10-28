/**
 * Floating voice pill over the map. Shows what the voice engine is doing right now
 * and, in tap-to-talk mode (iPhone), is itself the button you tap to speak.
 */
import type { VoiceStatus } from '../hooks/useVoice'

export function VoiceHUD({
  status,
  transcript,
  level,
  enabled,
  onTalk,
}: {
  status: VoiceStatus
  transcript: string
  level: number
  enabled: boolean
  onTalk?: () => void
}) {
  if (!enabled) return null
  const words = transcript.trim()
  const live = status === 'listening' || status === 'hearing' || status === 'recording'
  const tappable = !!onTalk && (status === 'ready' || status === 'recording')

  let tone: 'idle' | 'live' | 'active' | 'warn' = live ? 'live' : 'idle'
  let text: React.ReactNode
  if (status === 'unsupported') {
    tone = 'warn'
    text = <>Voice isn't available in this browser. Use <b style={{ color: '#ffaa00' }}>Open Camera</b> to report.</>
  } else if (status === 'blocked') {
    tone = 'warn'
    text = <>Microphone is blocked. Allow it in your browser settings to use voice.</>
  } else if (words) {
    tone = 'active'
    text = <>“<span style={{ color: '#00ff88' }}>{words}</span>”</>
  } else if (status === 'recording') {
    text = <span style={{ color: '#cfe8ff', whiteSpace: 'nowrap' }}>Listening… tap to finish</span>
  } else if (status === 'thinking') {
    text = <span style={{ color: '#7a9cc0' }}>Understanding…</span>
  } else if (status === 'ready') {
    text = <span style={{ color: '#cfe8ff', whiteSpace: 'nowrap' }}>Tap to talk</span>
  } else if (live) {
    text = <span style={{ color: '#7a9cc0', whiteSpace: 'nowrap' }}>Say <b style={{ color: '#00d4ff' }}>“Hey Meta”</b></span>
  } else {
    text = <span style={{ color: '#5e82a6' }}>Starting voice…</span>
  }

  const bars = (
    <div aria-hidden style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 18 }}>
      {[0.35, 0.65, 1, 0.65, 0.35].map((base, i) => (
        <span key={i} style={{
          width: 2.5, borderRadius: 2,
          height: live ? 4 + base * (4 + level * 13) : status === 'thinking' ? 6 : 3,
          background: words ? '#00ff88' : live ? '#00d4ff' : status === 'thinking' ? '#7a9cc0' : '#1e3550',
          transition: 'height 0.1s ease, background 0.2s ease',
          animation: (live && !words) || status === 'thinking' ? `wave 1.1s ease-in-out ${i * 0.12}s infinite` : 'none',
        }} />
      ))}
    </div>
  )

  return (
    <Shell tone={tone} onClick={tappable ? onTalk : undefined}>
      {tappable && status === 'ready' ? <span aria-hidden style={{ fontSize: 15 }}>🎙</span> : bars}
      <span style={{ fontSize: 12.5, color: '#e8f4ff' }}>{text}</span>
    </Shell>
  )
}

function Shell({ children, tone, onClick }: {
  children: React.ReactNode
  tone: 'idle' | 'live' | 'active' | 'warn'
  onClick?: () => void
}) {
  const border = { idle: 'rgba(0,212,255,0.18)', live: 'rgba(0,212,255,0.45)', active: 'rgba(0,255,136,0.5)', warn: 'rgba(255,170,0,0.4)' }[tone]
  const glow = { idle: 'none', live: '0 0 24px rgba(0,212,255,0.18)', active: '0 0 32px rgba(0,255,136,0.22)', warn: 'none' }[tone]
  const style: React.CSSProperties = {
    position: 'absolute', bottom: 'calc(18px + var(--sab, 0px))', left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(2,6,22,0.92)', border: `1px solid ${border}`, boxShadow: glow,
    borderRadius: 22, padding: onClick ? '10px 18px' : '7px 14px',
    display: 'flex', alignItems: 'center', gap: 12,
    zIndex: 1000, pointerEvents: onClick ? 'auto' : 'none',
    maxWidth: 'min(86%, 440px)', color: 'inherit', textAlign: 'left',
    transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
    animation: 'fadeIn 0.6s ease both',
  }
  const kf = <style>{`@keyframes wave { 0%, 100% { transform: scaleY(0.6); } 50% { transform: scaleY(1.25); } }`}</style>
  return onClick
    ? <button onClick={onClick} aria-label="Talk to Meta Maps" style={style}>{children}{kf}</button>
    : <div role="status" aria-live="polite" style={style}>{children}{kf}</div>
}

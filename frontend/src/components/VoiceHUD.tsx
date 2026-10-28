/**
 * Floating voice HUD over the map.
 * Shows live transcript while speaking, and the command list otherwise —
 * so what the app responds to is discoverable without a manual.
 */
export function VoiceHUD({
  listening,
  transcript,
  level,
  enabled,
  supported,
}: {
  listening: boolean
  transcript: string
  level: number
  enabled: boolean
  supported: boolean
}) {
  if (!enabled) return null

  const speaking = transcript.trim().length > 0

  if (!supported) {
    return (
      <Shell tone="warn">
        <span style={{ fontSize: 12 }}>
          Voice needs Chrome or Edge — use <strong style={{ color: '#ffaa00' }}>Open Camera</strong> instead
        </span>
      </Shell>
    )
  }

  return (
    <Shell tone={speaking ? 'active' : listening ? 'live' : 'idle'}>
      {/* Waveform meter */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 2.5, height: 18 }}>
        {[0, 1, 2, 3, 4].map(i => {
          const base = [0.35, 0.65, 1, 0.65, 0.35][i]
          const h = listening ? 4 + base * (4 + level * 13) : 3
          return (
            <span
              key={i}
              style={{
                width: 2.5, height: h, borderRadius: 2,
                background: speaking ? '#00ff88' : listening ? '#00d4ff' : '#1e3550',
                transition: 'height 0.12s ease, background 0.2s ease',
                animation: listening && !speaking
                  ? `wave 1.1s ease-in-out ${i * 0.12}s infinite`
                  : 'none',
              }}
            />
          )
        })}
      </div>

      {speaking ? (
        <span style={{ fontSize: 12.5, color: '#e8f4ff' }}>
          “<span style={{ color: '#00ff88' }}>{transcript}</span>”
        </span>
      ) : listening ? (
        <span style={{ fontSize: 12, color: '#7a9cc0', whiteSpace: 'nowrap' }}>
          Say <span style={{ color: '#00d4ff', fontWeight: 600 }}>“Hey Meta”</span>
        </span>
      ) : (
        <span style={{ fontSize: 12, color: '#5e82a6' }}>Voice paused</span>
      )}
    </Shell>
  )
}

function Shell({
  children,
  tone,
}: {
  children: React.ReactNode
  tone: 'idle' | 'live' | 'active' | 'warn'
}) {
  const border = {
    idle: 'rgba(0,212,255,0.12)',
    live: 'rgba(0,212,255,0.35)',
    active: 'rgba(0,255,136,0.5)',
    warn: 'rgba(255,170,0,0.35)',
  }[tone]
  const glow = {
    idle: 'none',
    live: '0 0 24px rgba(0,212,255,0.16)',
    active: '0 0 32px rgba(0,255,136,0.22)',
    warn: 'none',
  }[tone]

  return (
    <div style={{
      position: 'absolute', bottom: 18, left: '50%', transform: 'translateX(-50%)',
      background: 'rgba(2,6,22,0.9)', 
      border: `1px solid ${border}`, boxShadow: glow,
      borderRadius: 22, padding: '7px 14px',
      display: 'flex', alignItems: 'center', gap: 13,
      zIndex: 1000, pointerEvents: 'none',
      maxWidth: 'min(70%, 420px)',
      transition: 'border-color 0.3s ease, box-shadow 0.3s ease',
      animation: 'fadeIn 0.6s ease both',
    }}>
      {children}
      <style>{`
        @keyframes wave {
          0%, 100% { transform: scaleY(0.6); }
          50%      { transform: scaleY(1.25); }
        }
      `}</style>
    </div>
  )
}

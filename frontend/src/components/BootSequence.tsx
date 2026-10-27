import { useEffect, useState } from 'react'

/**
 * Cinematic system-init overlay shown once on first load.
 * Doubles as cover for the map's initial tile fetch, so the first frame a
 * viewer sees is deliberate rather than a half-painted map.
 */

const LINES = [
  'Initializing hazard network',
  'Acquiring GPS fix',
  'Connecting to Gemini Vision',
  'Opening realtime channel',
  'Calibrating voice recognition',
]

export function BootSequence({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState(0)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduced) { onDone(); return }

    const perStep = 260
    const timers: ReturnType<typeof setTimeout>[] = []

    LINES.forEach((_, i) => {
      timers.push(setTimeout(() => setStep(i + 1), perStep * (i + 1)))
    })
    timers.push(setTimeout(() => setLeaving(true), perStep * LINES.length + 380))
    timers.push(setTimeout(() => onDone(), perStep * LINES.length + 900))

    // Any key or click skips ahead
    const skip = () => { setLeaving(true); setTimeout(onDone, 400) }
    window.addEventListener('keydown', skip, { once: true })
    window.addEventListener('pointerdown', skip, { once: true })

    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener('keydown', skip)
      window.removeEventListener('pointerdown', skip)
    }
  }, [onDone])

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'fixed', inset: 0, zIndex: 10000,
        background: 'radial-gradient(ellipse at 50% 45%, #061225 0%, #020610 70%)',
        display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', gap: 28,
        opacity: leaving ? 0 : 1,
        transform: leaving ? 'scale(1.04)' : 'scale(1)',
        transition: 'opacity 0.45s ease, transform 0.45s ease',
        pointerEvents: leaving ? 'none' : 'auto',
      }}
    >
      {/* Expanding radar rings */}
      <div style={{ position: 'relative', width: 120, height: 120 }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{
            position: 'absolute', inset: 0, borderRadius: '50%',
            border: '1px solid rgba(0,212,255,0.4)',
            animation: `boot-ring 2.4s cubic-bezier(0.2,0.7,0.3,1) ${i * 0.8}s infinite`,
          }} />
        ))}
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 44,
          filter: 'drop-shadow(0 0 20px rgba(0,212,255,0.6))',
        }}>🚧</div>
      </div>

      {/* Wordmark */}
      <div style={{ textAlign: 'center' }}>
        <div style={{
          fontFamily: "'Space Grotesk', sans-serif",
          fontWeight: 800, fontSize: 34, letterSpacing: '-0.8px',
          background: 'linear-gradient(90deg, #ffffff, #00d4ff)',
          WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
        }}>Gemini Maps</div>
        <div style={{
          fontSize: 10.5, color: '#4a6a8a', letterSpacing: '0.3em',
          textTransform: 'uppercase', marginTop: 6,
        }}>Real-Time Road Intelligence</div>
      </div>

      {/* Init checklist */}
      <div style={{
        display: 'flex', flexDirection: 'column', gap: 7,
        minWidth: 280, fontSize: 12,
      }}>
        {LINES.map((line, i) => {
          const done = step > i
          const active = step === i
          return (
            <div key={line} style={{
              display: 'flex', alignItems: 'center', gap: 10,
              color: done ? '#00ff88' : active ? '#00d4ff' : '#1e3550',
              transition: 'color 0.3s ease',
              fontFamily: "'Space Grotesk', sans-serif",
            }}>
              <span style={{
                width: 14, display: 'inline-block', textAlign: 'center',
                fontSize: 11,
              }}>
                {done ? '✓' : active ? '▸' : '·'}
              </span>
              <span>{line}</span>
              {done && (
                <span style={{ marginLeft: 'auto', fontSize: 10, opacity: 0.7 }}>OK</span>
              )}
            </div>
          )
        })}
      </div>

      {/* Progress rail */}
      <div style={{ width: 280, height: 2, background: 'rgba(0,212,255,0.1)', borderRadius: 1 }}>
        <div style={{
          height: '100%', borderRadius: 1,
          width: `${(step / LINES.length) * 100}%`,
          background: 'linear-gradient(90deg, #0040ff, #00d4ff)',
          boxShadow: '0 0 10px rgba(0,212,255,0.6)',
          transition: 'width 0.26s cubic-bezier(0.4,0,0.2,1)',
        }} />
      </div>

      <div style={{ fontSize: 10, color: '#1e3550', letterSpacing: '0.1em' }}>
        PRESS ANY KEY TO SKIP
      </div>

      <style>{`
        @keyframes boot-ring {
          0%   { transform: scale(0.5); opacity: 0.9; }
          100% { transform: scale(1.8); opacity: 0; }
        }
      `}</style>
    </div>
  )
}

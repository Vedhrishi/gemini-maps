/**
 * About sheet: what the app does, which models are live right now, voice
 * commands, shortcuts, data credits and where the code lives. Opened from the
 * "?" button or the ? key. Model status is read from the backend's /health,
 * so the sheet never claims a model that is not actually serving.
 */
import { useEffect, useState } from 'react'
import { API_URL } from '../lib/api'
import { VOICE_COMMANDS } from '../hooks/useVoice'

type Health = {
  provider?: string
  serving?: string
  muse_ok?: boolean | null
  supabase?: boolean
}

const REPO = 'https://github.com/Vedhrishi/meta-maps'

const SHORTCUTS: [string, string][] = [
  ['R', 'Report a hazard'],
  ['M', 'Live map'],
  ['F', 'Hazard feed'],
  ['N', 'Navigate'],
  ['V', 'Voice on or off'],
  ['3', '2D or 3D map'],
  ['?', 'This panel'],
]

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <h3 style={{ margin: 0, fontFamily: 'var(--font2)', fontSize: 13.5, fontWeight: 700, color: 'var(--text)' }}>
        {title}
      </h3>
      {children}
    </section>
  )
}

function Dot({ state }: { state: 'on' | 'fallback' | 'off' | 'checking' }) {
  const color = { on: '#00e08a', fallback: '#ffaa00', off: '#5b6b7d', checking: '#5b6b7d' }[state]
  return <span aria-hidden style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0, boxShadow: state === 'on' ? `0 0 8px ${color}` : 'none' }} />
}

export function AboutSheet({ onClose, isDesktop }: { onClose: () => void; isDesktop: boolean }) {
  const [health, setHealth] = useState<Health | null>(null)
  const [failed, setFailed] = useState(false)
  const [allCommands, setAllCommands] = useState(false)

  useEffect(() => {
    let alive = true
    fetch(`${API_URL}/health`, { cache: 'no-store' })
      .then(r => r.json())
      .then(j => { if (alive) setHealth(j) })
      .catch(() => { if (alive) setFailed(true) })
    return () => { alive = false }
  }, [])

  const museServing = health?.serving === 'muse'
  const museConfigured = health?.provider === 'muse'
  const visionState: 'on' | 'fallback' | 'off' | 'checking' =
    !health ? (failed ? 'off' : 'checking') : museServing ? 'on' : 'fallback'
  const visionText = !health
    ? (failed ? 'Server is waking up. Try again in a minute.' : 'Checking…')
    : museServing
      ? 'Meta Muse Spark is classifying hazard photos.'
      : museConfigured
        ? 'Meta Muse Spark is set up but not reachable right now, so Gemini is answering until it is back.'
        : 'Gemini is classifying hazard photos.'

  const commands = allCommands ? VOICE_COMMANDS : VOICE_COMMANDS.slice(0, 7)

  return (
    <div
      onClick={onClose}
      role="dialog" aria-modal="true" aria-labelledby="about-title"
      style={{
        position: 'fixed', inset: 0, zIndex: 9000,
        background: 'rgba(2,6,16,0.78)',
        display: 'grid', placeItems: isDesktop ? 'center' : 'end stretch',
        animation: 'fadeIn 0.2s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: '#07101f', border: '1px solid rgba(0,212,255,0.2)',
          borderRadius: isDesktop ? 16 : '18px 18px 0 0',
          width: isDesktop ? 560 : '100%', maxHeight: isDesktop ? '86vh' : '88vh', overflowY: 'auto',
          padding: isDesktop ? '24px 28px' : '20px 18px calc(20px + env(safe-area-inset-bottom))',
          boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
          display: 'flex', flexDirection: 'column', gap: 20,
          animation: 'slideUp 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ flex: 1 }}>
            <h2 id="about-title" style={{ margin: 0, fontFamily: 'var(--font2)', fontSize: 19, fontWeight: 700 }}>
              Meta Maps
            </h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
              Navigation that knows about the pothole, the flooded underpass and the broken signal,
              because drivers report them with one photo and everyone's route avoids them.
            </p>
          </div>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'var(--text2)', width: 32, height: 32, borderRadius: 8, fontSize: 18, flexShrink: 0,
          }}>×</button>
        </div>

        <Section title="How a report works">
          <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12.5, color: 'var(--text2)', lineHeight: 1.65 }}>
            <li>You take a photo of the hazard, or say "report pothole".</li>
            <li>A vision model decides whether it is a road hazard, what kind and how severe.</li>
            <li>Meta SAM 3.1 marks where the hazard is in the photo, when Meta Model API is reachable.</li>
            <li>The pin appears on every driver's map. A second report within 60 m counts as a confirmation.</li>
            <li>Routes are ranked around reported hazards, and the Guardian reroutes you mid-drive if one appears ahead.</li>
          </ol>
        </Section>

        <Section title="AI right now">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, color: 'var(--text2)' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Dot state={visionState} /><span>{visionText}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Dot state={museServing ? 'on' : 'off'} />
              <span>Meta SAM 3.1 outlines the hazard{museServing ? '.' : ' when Meta Model API is reachable.'}</span>
            </div>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <Dot state={health ? (health.supabase ? 'on' : 'fallback') : 'checking'} />
              <span>{!health ? 'Checking report storage…' : health.supabase ? 'Reports are stored permanently.' : 'Reports are kept in server memory and reset when the server restarts.'}</span>
            </div>
          </div>
        </Section>

        <Section title="Say it instead">
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1.2fr) minmax(0,1fr)', gap: '6px 14px', fontSize: 12.5 }}>
            {commands.map(c => (
              <div key={c.phrase} style={{ display: 'contents' }}>
                <span style={{ color: 'var(--accent)' }}>"{c.phrase}"</span>
                <span style={{ color: 'var(--text3)' }}>{c.does}</span>
              </div>
            ))}
          </div>
          {VOICE_COMMANDS.length > 7 && (
            <button onClick={() => setAllCommands(v => !v)} style={{
              alignSelf: 'flex-start', background: 'transparent', border: 'none', padding: 0,
              color: 'var(--accent)', fontSize: 12.5, fontWeight: 600,
            }}>{allCommands ? 'Show fewer' : `Show all ${VOICE_COMMANDS.length} commands`}</button>
          )}
        </Section>

        {isDesktop && (
          <Section title="Keyboard">
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0,1fr))', gap: '6px 18px' }}>
              {SHORTCUTS.map(([k, label]) => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 12.5, color: 'var(--text2)' }}>
                  <kbd style={{
                    background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.22)',
                    borderRadius: 6, padding: '2px 8px', fontSize: 11, fontWeight: 700,
                    color: 'var(--accent)', fontFamily: 'var(--font2)', minWidth: 24, textAlign: 'center',
                  }}>{k}</kbd>
                  {label}
                </div>
              ))}
            </div>
          </Section>
        )}

        <Section title="Data and credits">
          <p style={{ margin: 0, fontSize: 12, color: 'var(--text3)', lineHeight: 1.6 }}>
            Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap and OpenMapTiles.
            About 4.9 million Indian place and building names from Overture Maps and OpenStreetMap,
            searched on your device. Routing by OSRM, address search by Photon and
            Nominatim. Live traffic from TomTom where available, otherwise a time-of-day estimate. Rain forecast from Open-Meteo and MET Norway. Fuel prices are
            per state averages and may be out of date.
          </p>
        </Section>

        <div style={{
          display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center',
          borderTop: '1px solid rgba(255,255,255,0.07)', paddingTop: 16, fontSize: 12.5,
        }}>
          <span style={{ color: 'var(--text3)', flexBasis: '100%' }}>
            Built for the Meta Global AI Developer Hackathon, Oct 26 to Nov 4, 2026. An independent project, not made by or endorsed by Meta.
          </span>
          <a href={REPO} target="_blank" rel="noopener" style={{ color: 'var(--accent)', fontWeight: 600 }}>Source code on GitHub</a>
          <a href={`${import.meta.env.BASE_URL}privacy.html`} target="_blank" rel="noopener" style={{ color: 'var(--text2)' }}>Privacy</a>
        </div>
      </div>
    </div>
  )
}

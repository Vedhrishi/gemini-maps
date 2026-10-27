/**
 * TripHUD — overlays on the map: a route summary before leaving, and a live
 * dashboard while driving (next turn, km left, time left, fuel used).
 */

import { LEVEL_COLOR } from '../lib/traffic'
import { Nav } from '../hooks/useNavigation'
import { money } from '../lib/fuel'
import { fmtKm, fmtDur, clock } from '../lib/routing'

const glass: React.CSSProperties = {
  background: 'rgba(3,9,20,.9)', 
  border: '1px solid rgba(0,212,255,.22)', boxShadow: '0 14px 44px rgba(0,0,0,.65)',
}

const SEV: Record<string, string> = {
  critical: '#ff2266', high: '#ff6600', medium: '#ffaa00', low: '#00cc66',
}

function Big({ value, unit, label, color, compact }: { value: string; unit?: string; label: string; color?: string; compact?: boolean }) {
  return (
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{
        fontSize: 9.5, letterSpacing: '.13em', textTransform: 'uppercase',
        color: 'var(--text3)', fontWeight: 700, fontFamily: 'var(--font2)',
      }}>{label}</div>
      <div style={{
        fontFamily: 'var(--font2)', fontWeight: 800, fontSize: compact ? 18 : 24, letterSpacing: '-.6px',
        color: color ?? 'var(--text)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap',
      }}>
        {value}
        {unit && (compact
          ? <div style={{ fontSize: 10.5, fontWeight: 600, color: 'var(--text3)', letterSpacing: 0 }}>{unit}</div>
          : <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text3)', marginLeft: 3 }}>{unit}</span>)}
      </div>
    </div>
  )
}

function Arrow({ kind, text }: { kind: string; text: string }) {
  const t = text.toLowerCase()
  const glyph =
    kind === 'arrive' ? '⚑'
    : kind === 'roundabout' ? '⟳'
    : t.includes('sharp left') || t.includes('turn left') ? '↰'
    : t.includes('sharp right') || t.includes('turn right') ? '↱'
    : t.includes('left') ? '↖'
    : t.includes('right') ? '↗'
    : '↑'
  return <span style={{ fontSize: 34, lineHeight: 1, color: 'var(--accent)' }}>{glyph}</span>
}

export function TripHUD({ nav, isDesktop, onStartLive }: { nav: Nav; isDesktop: boolean; onStartLive: () => void }) {
  const { status, current, trip } = nav
  if (!current) return null

  // ── Before leaving ─────────────────────────────────────────────────────
  if (status === 'ready') {
    return (
      <div style={{
        ...glass, position: 'absolute', top: isDesktop ? 14 : 108, left: '50%', transform: 'translateX(-50%)',
        zIndex: 20, borderRadius: 16, padding: isDesktop ? '10px 12px 10px 18px' : '8px 8px 8px 14px', display: 'flex', alignItems: 'center', gap: isDesktop ? 16 : 10,
        width: isDesktop ? 'max-content' : 'calc(100% - 28px)', maxWidth: 'calc(100% - 28px)',
      }}>
        <div style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap' }}>
          <div style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 19, letterSpacing: '-.4px' }}>
            {fmtDur(current.route.duration)}
            <span style={{ fontSize: 13, color: 'var(--text2)', fontWeight: 600, marginLeft: 8 }}>
              {fmtKm(current.route.distance)}
            </span>
          </div>
          <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 1 }}>
            <span style={{ color: '#ffcc66', fontWeight: 700 }}>⛽ ~{money(current.fuel.cost, current.fuel.currency)}</span>
            {' · '}
            <span style={{ color: current.hazards.length ? '#ffaa00' : '#00ff88' }}>
              {current.hazards.length ? `${current.hazards.length} hazard${current.hazards.length > 1 ? 's' : ''}${isDesktop ? ' on route' : ''}` : 'no hazards'}
            </span>
            {current.route.traffic && (
              <>
                {' · '}
                <span style={{ color: LEVEL_COLOR[current.route.traffic.level], fontWeight: 700 }}>
                  {current.route.traffic.level} traffic
                </span>
              </>
            )}
          </div>
        </div>
        <button onClick={onStartLive} style={{
          padding: isDesktop ? '11px 20px' : '10px 16px', flexShrink: 0, borderRadius: 12, fontWeight: 800, fontSize: 14, border: 'none', color: '#fff',
          background: 'linear-gradient(135deg,#0050ff,#00b4ff)', boxShadow: '0 4px 18px rgba(0,120,255,.45)',
          whiteSpace: 'nowrap',
        }}>▶ Start</button>
        <button onClick={nav.clear} title="Cancel" style={{
          background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: 20, padding: '0 4px',
        }}>×</button>
      </div>
    )
  }

  if (!trip || (status !== 'trip' && status !== 'arrived')) return null

  const before = nav.tripTotals.km - nav.total // metres already driven before any reroute
  const pct = Math.min(100, ((before + nav.traveled) / Math.max(1, nav.tripTotals.km)) * 100)
  const arrived = status === 'arrived'
  const step = nav.nextStep

  return (
    <>
      {/* Next manoeuvre */}
      {!arrived && step && (
        <div style={{
          ...glass, position: 'absolute', top: isDesktop ? 14 : 62, left: '50%', transform: 'translateX(-50%)',
          zIndex: 20, borderRadius: 16, padding: '11px 20px', display: 'flex', alignItems: 'center', gap: 16,
          minWidth: isDesktop ? 340 : 0, maxWidth: 'calc(100% - 28px)',
        }}>
          <Arrow kind={step.kind} text={step.text} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 22, letterSpacing: '-.4px' }}>
              {fmtKm(step.distanceTo)}
            </div>
            <div style={{ fontSize: 13, color: 'var(--text2)', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {step.text}
            </div>
          </div>
        </div>
      )}

      {/* Hazard heads-up */}
      {!arrived && nav.ahead[0] && nav.ahead[0].at - nav.traveled < 700 && nav.ahead[0].at - nav.traveled > -20 && (
        <div style={{
          ...glass, position: 'absolute', top: isDesktop ? 86 : 134, left: '50%', transform: 'translateX(-50%)',
          zIndex: 19, borderRadius: 12, padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 10,
          borderColor: SEV[nav.ahead[0].report.severity], boxShadow: `0 0 28px ${SEV[nav.ahead[0].report.severity]}55`,
          animation: 'pulse 1.4s ease infinite', maxWidth: 'calc(100% - 28px)',
        }}>
          <span style={{ fontSize: 18 }}>⚠</span>
          <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'capitalize' }}>
            {nav.ahead[0].report.hazard_type.replace(/_/g, ' ')} · {fmtKm(Math.max(0, nav.ahead[0].at - nav.traveled))}
          </span>
        </div>
      )}

      {/* Speed limit + current speed */}
      {!arrived && nav.limitKmh > 0 && (
        <div style={{ position: 'absolute', left: 12, top: isDesktop ? 86 : 190, zIndex: 19, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
          <div title="Typical speed limit on this road (estimated)" style={{
            width: 58, height: 58, borderRadius: '50%', background: '#fff', border: '6px solid #e11d2e',
            display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#111',
            fontWeight: 900, fontSize: 22, fontFamily: 'var(--font2)', boxShadow: '0 4px 14px rgba(0,0,0,.5)',
          }}>{nav.limitKmh}</div>
          <div style={{
            ...glass, borderRadius: 10, padding: '3px 9px', textAlign: 'center', minWidth: 58,
            borderColor: nav.speedKmh > nav.limitKmh * 1.1 + 3 ? '#ff3355' : undefined,
            color: nav.speedKmh > nav.limitKmh * 1.1 + 3 ? '#ff3355' : 'var(--text)',
          }}>
            <div style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.1 }}>{Math.round(nav.speedKmh)}</div>
            <div style={{ fontSize: 9.5, color: 'var(--text3)' }}>km/h</div>
          </div>
          {nav.advisedKmh != null && (
            <div style={{ ...glass, borderRadius: 10, padding: '3px 8px', fontSize: 10.5, fontWeight: 700, color: '#ffaa00', borderColor: '#ffaa00', textAlign: 'center' }}>
              Hazard ahead<br />ease to {nav.advisedKmh}
            </div>
          )}
        </div>
      )}

      {/* Dashboard */}
      <div style={{
        ...glass, position: 'absolute', bottom: isDesktop ? 18 : 12, left: '50%', transform: 'translateX(-50%)',
        zIndex: 20, borderRadius: 18, padding: '14px 18px 12px',
        width: isDesktop ? 560 : 'calc(100% - 20px)', maxWidth: 'calc(100% - 20px)',
      }}>
        {arrived ? (
          <div style={{ textAlign: 'center', padding: '4px 0 8px' }}>
            <div style={{ fontSize: 28 }}>⚑</div>
            <div style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 20, marginTop: 2 }}>
              Arrived at {nav.to?.name}
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--text2)', marginTop: 6 }}>
              {fmtKm(nav.tripTotals.km)} · {fmtDur(nav.tripTotals.sec)} ·{' '}
              <b style={{ color: '#ffcc66' }}>~{money(nav.tripTotals.cost, current.fuel.currency)} fuel</b>
              {' '}({nav.tripTotals.litres.toFixed(1)} {current.fuel.unit})
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: isDesktop ? 14 : 8 }}>
            <Big compact={!isDesktop} label="Km left" value={(nav.remainingM / 1000).toFixed(nav.remainingM < 10000 ? 1 : 0)} unit="km" color="var(--accent)" />
            <Big compact={!isDesktop} label="Time left" value={fmtDur(nav.remainingSec)} />
            <Big compact={!isDesktop} label="Arrive" value={clock(nav.remainingSec * 1000).replace(/\s?(am|pm)/i, ' $1')} />
            <Big
              compact={!isDesktop}
              label="Fuel used"
              value={money(nav.fuelUsed.cost, current.fuel.currency)}
              unit={`${nav.fuelUsed.litres.toFixed(nav.fuelUsed.litres < 10 ? 2 : 1)} ${current.fuel.unit}`}
              color="#ffcc66"
            />
          </div>
        )}

        {!arrived && (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8, marginTop: 10, fontSize: 12,
            color: nav.guardian === 'checking' ? '#ffaa00' : 'var(--text3)',
          }}>
            <span style={{ fontSize: 13 }}>🛡</span>
            <span style={{ fontWeight: 700, color: nav.guardian === 'checking' ? '#ffaa00' : '#00ff88' }}>
              Guardian {nav.guardian === 'checking' ? 'checking alternatives…' : 'watching'}
            </span>
            {nav.agentLog[0] && nav.agentLog.length > 1 && (
              <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>
                · {nav.agentLog[0].text}
              </span>
            )}
          </div>
        )}

        {/* Progress with hazard ticks */}
        <div style={{ position: 'relative', height: 8, margin: '12px 0 10px', borderRadius: 4, background: 'rgba(255,255,255,.07)' }}>
          <div style={{
            position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 4,
            background: 'linear-gradient(90deg,#0050ff,#00d4ff)', boxShadow: '0 0 14px rgba(0,212,255,.6)',
            transition: 'width .2s linear',
          }} />
          {current.hazards.map(h => (
            <span key={h.report.id} title={h.report.hazard_type} style={{
              position: 'absolute', top: -3, width: 4, height: 14, borderRadius: 2,
              left: `calc(${((before + h.at) / Math.max(1, nav.tripTotals.km)) * 100}% - 2px)`,
              background: SEV[h.report.severity] ?? '#fa0', boxShadow: `0 0 8px ${SEV[h.report.severity]}`,
            }} />
          ))}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          {!arrived && trip.mode === 'sim' && (
            <>
              <button onClick={() => nav.patchTrip({ paused: !trip.paused })} style={ctl(trip.paused)}>
                {trip.paused ? '▶ Resume' : '❚❚ Pause'}
              </button>
              {[1, 8, 30, 120].map(m => (
                <button key={m} onClick={() => nav.patchTrip({ speedMul: m })} style={ctl(trip.speedMul === m)}>{m}×</button>
              ))}
            </>
          )}
          {!arrived && trip.mode === 'gps' && (
            <span style={{ fontSize: 12, color: trip.offRoute ? '#ff8aa8' : '#00ff88', fontWeight: 700 }}>
              ◎ {trip.offRoute ? 'Off route' : 'Live GPS'}
            </span>
          )}
          {!arrived && (
            <button onClick={() => nav.patchTrip({ follow: !trip.follow })} style={ctl(trip.follow)}>
              {trip.follow ? '◉ Following' : '○ Follow'}
            </button>
          )}
          <button onClick={arrived ? nav.clear : nav.stopTrip} style={{
            ...ctl(false), marginLeft: 'auto', color: '#ff8aa8', borderColor: 'rgba(255,34,102,.35)',
          }}>{arrived ? 'Done' : 'End trip'}</button>
        </div>
      </div>
    </>
  )
}

const ctl = (on: boolean): React.CSSProperties => ({
  padding: '7px 12px', borderRadius: 9, fontSize: 12, fontWeight: 700,
  background: on ? 'rgba(0,212,255,.15)' : 'rgba(255,255,255,.04)',
  border: `1px solid ${on ? 'rgba(0,212,255,.5)' : 'rgba(255,255,255,.1)'}`,
  color: on ? 'var(--accent)' : 'var(--text2)',
})

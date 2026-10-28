/**
 * NavPanel — destination search anywhere, vehicle choice, and a
 * comparison of route options by time, distance, fuel cost and road hazards.
 */

import { addUserPlace } from '../lib/userPlaces'
import { LEVEL_COLOR, LEVEL_LABEL } from '../lib/traffic'
import { useEffect, useRef, useState } from 'react'
import { NEAR_CATS, findNearest, fmtDist, NearCat, NearHit } from '../lib/nearest'
import { Nav } from '../hooks/useNavigation'
import { VEHICLES, money, sym, PRICE_DATE } from '../lib/fuel'
import {
  Place, searchPlaces, DEMO_TRIPS, fmtKm, fmtDur, clock, safetyScore,
} from '../lib/routing'

interface Props {
  nav: Nav
  userPos: { lat: number; lng: number; real: boolean }
  locStatus: 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable'
  onRequestLocation: () => void
  onStartLive: () => void
  manualName: string | null
  accuracy: number | null
  onSetLocation: (p: Place) => void
  onUseGps: () => void
  onShowMap: () => void
}

const SEV: Record<string, string> = {
  critical: '#ff2266', high: '#ff6600', medium: '#ffaa00', low: '#00cc66',
}

const label: React.CSSProperties = {
  fontSize: 10, letterSpacing: '.12em', textTransform: 'uppercase',
  color: 'var(--text3)', fontWeight: 700, fontFamily: 'var(--font2)',
}

function PlaceInput({
  value, placeholder, dot, near, onPick, onClear, autoFocus, addAt,
}: {
  value: Place | null
  placeholder: string
  dot: string
  near: { lat: number; lng: number }
  onPick: (p: Place) => void
  onClear?: () => void
  autoFocus?: boolean
  /** my real GPS position, or null: where a missing place would be saved */
  addAt?: { lat: number; lng: number } | null
}) {
  const [text, setText] = useState('')
  const [results, setResults] = useState<Place[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const seq = useRef(0)
  const [added, setAdded] = useState(false)
  const typed = text.trim()
  const canOffer = open && !busy && typed.length >= 3 && !(value && text === value.name) && results.length < 4

  // keyed by content, not identity: the parent rebuilds this object on every render, which would wipe what the user is typing
  useEffect(() => { setText(value ? value.name : '') }, [value?.name, value?.lat, value?.lng])

  useEffect(() => {
    if (!open || text.trim().length < 2 || (value && text === value.name)) { setResults([]); return }
    const my = ++seq.current
    setBusy(true); setFailed(false)
    // offline results are instant: start the lookup at once for them, debounce only the network layers
    const t = setTimeout(async () => {
      try {
        const r = await searchPlaces(text, near, part => { if (my === seq.current) setResults(part) })
        if (my === seq.current) { setResults(r); setBusy(false) }
      } catch {
        if (my === seq.current) { setResults([]); setBusy(false); setFailed(true) }
      }
    }, 160)
    return () => clearTimeout(t)
  }, [text, open, near.lat, near.lng, value?.name])

  return (
    <div style={{ position: 'relative' }}>
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10,
        background: 'rgba(255,255,255,.04)', border: '1px solid rgba(0,212,255,.16)',
        borderRadius: 11, padding: '0 12px',
      }}>
        <span style={{
          width: 9, height: 9, borderRadius: '50%', background: dot, flexShrink: 0,
          boxShadow: `0 0 8px ${dot}`,
        }} />
        <input
          value={text}
          autoFocus={autoFocus}
          placeholder={placeholder}
          onFocus={e => { setOpen(true); e.currentTarget.select() }}
          onBlur={() => setTimeout(() => setOpen(false), 160)}
          onChange={e => { setText(e.target.value); setOpen(true) }}
          style={{
            flex: 1, minWidth: 0, background: 'transparent', border: 'none', outline: 'none',
            color: 'var(--text)', fontSize: 14, padding: '12px 0', fontFamily: 'inherit',
          }}
        />
        {busy && <span style={{
          width: 14, height: 14, border: '2px solid rgba(0,212,255,.2)',
          borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'map-spin .8s linear infinite',
        }} />}
        {value && onClear && !busy && (
          <button onMouseDown={e => e.preventDefault()} onClick={onClear} title="Clear" style={{
            background: 'transparent', border: 'none', color: 'var(--text3)', fontSize: 16, padding: 2,
          }}>×</button>
        )}
      </div>

      {open && (results.length > 0 || failed || canOffer) && (
        <div style={{
          position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)', zIndex: 50,
          background: '#060e1c', border: '1px solid rgba(0,212,255,.22)', isolation: 'isolate',
          borderRadius: 11, overflow: 'hidden', boxShadow: '0 16px 40px rgba(0,0,0,.7)',
        }}>
          {failed && (
            <div style={{ padding: '11px 13px', fontSize: 12.5, color: '#ffaa00' }}>
              Search is unreachable right now. Try a trip below.
            </div>
          )}
          {results.map((p, i) => (
            <button
              key={i}
              onMouseDown={e => e.preventDefault()}
              onClick={() => { onPick(p); setOpen(false) }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'transparent',
                border: 'none', borderTop: i ? '1px solid rgba(0,212,255,.07)' : 'none',
                borderRadius: 0, padding: '9px 13px', color: 'var(--text)',
              }}
            >
              <div style={{ fontSize: 13.5, fontWeight: 600 }}>{p.name}</div>
              {p.sub && <div style={{ fontSize: 11.5, color: 'var(--text3)', marginTop: 1 }}>{p.sub}</div>}
            </button>
          ))}
          {canOffer && (
            <button
              onMouseDown={e => e.preventDefault()}
              onClick={async () => {
                if (!addAt) return
                const place = { name: typed, sub: 'Added by you', lat: addAt.lat, lng: addAt.lng }
                await addUserPlace(typed, addAt.lat, addAt.lng)
                setAdded(true); setTimeout(() => setAdded(false), 2500)
                setResults([place])
              }}
              style={{
                display: 'block', width: '100%', textAlign: 'left', background: 'rgba(0,212,255,.06)',
                border: 'none', borderTop: '1px solid rgba(0,212,255,.12)', borderRadius: 0,
                padding: '10px 13px', color: 'var(--accent)', fontSize: 13, fontWeight: 600,
              }}
            >
              {addAt ? `＋ Not listed? Save “${typed}” where you are standing` : 'Missing place? Turn on location to add it where you stand'}
            </button>
          )}
          {added && <div style={{ padding: '8px 13px', fontSize: 12, color: '#00ff88' }}>Saved. It will now show up in search.</div>}
        </div>
      )}
    </div>
  )
}

export function NavPanel({ nav, userPos, locStatus, onRequestLocation, onStartLive, manualName, accuracy, onSetLocation, onUseGps, onShowMap }: Props) {
  const [showSteps, setShowSteps] = useState(false)
  const [showFuel, setShowFuel] = useState(false)
  const [origin, setOrigin] = useState<Place | null>(null)
  const [nearCat, setNearCat] = useState<NearCat | null>(null)
  const [nearHits, setNearHits] = useState<NearHit[] | null>(null)
  const nearSeq = useRef(0)
  const showNear = (c: NearCat) => {
    if (nearCat?.id === c.id) { setNearCat(null); setNearHits(null); return }
    const seq = ++nearSeq.current
    setNearCat(c); setNearHits(null)
    findNearest(c, userPos, 6).then(h => { if (seq === nearSeq.current) setNearHits(h) }).catch(() => { if (seq === nearSeq.current) setNearHits([]) })
  }

  const here: Place = {
    name: manualName ?? 'My location',
    sub: '', lat: userPos.lat, lng: userPos.lng,
  }
  const from = origin ?? nav.from ?? here
  const cur = nav.current

  const go = (dest: Place, start: Place = from) => { nav.plan(start, dest); onShowMap() }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', padding: 16, gap: 14 }}>
      <div>
        <div style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 18, letterSpacing: '-.3px' }}>
          Navigate
        </div>
        <div style={{ fontSize: 12.5, color: 'var(--text3)', marginTop: 2 }}>
          Anywhere in the world · India fuel prices by state · routes ranked by road hazards, time and fuel cost
        </div>
      </div>

      {!userPos.real && (
        <button onClick={onRequestLocation} style={{
          textAlign: 'left', padding: '10px 12px', borderRadius: 12, background: 'rgba(66,133,244,.12)',
          border: '1px solid rgba(66,133,244,.4)', color: '#9cc2ff', fontSize: 13, fontWeight: 600,
        }}>
          📍 {locStatus === 'denied'
            ? 'Location is blocked. Allow it in your browser settings, then tap here.'
            : locStatus === 'locating' ? 'Finding your location…' : 'Turn on location so Gemini Maps can navigate from where you are'}
        </button>
      )}

      {userPos.real && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '9px 12px', borderRadius: 12,
          background: manualName ? 'rgba(255,170,0,.1)' : 'rgba(66,133,244,.1)',
          border: `1px solid ${manualName ? 'rgba(255,170,0,.4)' : 'rgba(66,133,244,.35)'}`, fontSize: 12.5,
        }}>
          <span style={{ flex: 1, minWidth: 160, color: manualName ? '#ffcc66' : '#9cc2ff', fontWeight: 600 }}>
            📍 {manualName ? `Your location: ${manualName}` : accuracy != null ? `Using your device GPS · accurate to ${accuracy < 1000 ? Math.round(accuracy) + ' m' : (accuracy / 1000).toFixed(1) + ' km'}` : 'Using your device GPS'}
          </span>
          <button onClick={() => window.dispatchEvent(new Event('gm:pick'))} style={{
            background: 'rgba(255,255,255,.07)', border: '1px solid rgba(255,255,255,.18)', borderRadius: 8, color: 'var(--text)', padding: '5px 10px', fontSize: 12, fontWeight: 700,
          }}>Pick on map</button>
          {manualName && <button onClick={onUseGps} style={{
            background: 'rgba(66,133,244,.2)', border: '1px solid rgba(66,133,244,.5)', borderRadius: 8, color: '#9cc2ff', padding: '5px 10px', fontSize: 12, fontWeight: 700,
          }}>Use GPS</button>}
          {!manualName && accuracy != null && accuracy > 1000 && (
            <div style={{ flexBasis: '100%', color: '#ffcc66', fontSize: 12 }}>
              This device only knows your area roughly (laptops guess from Wi-Fi). Open the app on your phone for exact GPS, or search or tap the map to set where you are.
            </div>
          )}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <PlaceInput
          value={origin ?? (nav.from && nav.from.name !== here.name ? nav.from : here)}
          placeholder="Where are you? Search to change your location"
          dot="#00ff88"
          near={userPos}
          addAt={userPos.real ? userPos : null}
          onPick={p => { onSetLocation(p); setOrigin(null); if (nav.to) nav.plan(p, nav.to) }}
          onClear={() => { onUseGps(); setOrigin(null) }}
        />
        <PlaceInput
          value={nav.to}
          placeholder="Where to? Try “Charminar” or “Marine Drive”"
          dot="#ff2266"
          near={userPos}
          addAt={userPos.real ? userPos : null}
          onPick={p => go(p)}
          onClear={nav.clear}
        />
      </div>

      {/* Nearby: the most asked searches, one tap */}
      <div>
        <div style={{ ...label, marginBottom: 7 }}>Nearby</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 3, scrollbarWidth: 'none' }}>
          {NEAR_CATS.map(c => {
            const on = nearCat?.id === c.id
            return (
              <button key={c.id} onClick={() => showNear(c)} style={{
                flexShrink: 0, padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: 600, whiteSpace: 'nowrap',
                background: on ? 'rgba(0,212,255,.14)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${on ? 'rgba(0,212,255,.5)' : 'rgba(255,255,255,.08)'}`, color: on ? 'var(--accent)' : 'var(--text2)',
              }}>{c.icon} {c.label}</button>
            )
          })}
        </div>
        {nearCat && (
          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {nearHits === null && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Finding the closest {nearCat.say}…</div>}
            {nearHits?.length === 0 && <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>No {nearCat.say} found within range. Try moving the map or picking another location.</div>}
            {nearHits?.map((h, i) => (
              <button key={i} onClick={() => go(h)} style={{
                display: 'flex', alignItems: 'center', gap: 10, textAlign: 'left', padding: '9px 11px', borderRadius: 10,
                background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'var(--text)',
              }}>
                <span style={{ fontSize: 18 }}>{nearCat.icon}</span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.name}</span>
                  <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text3)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.sub}</span>
                </span>
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{h.km < 1 ? `${Math.round(h.km * 10) * 100} m` : `${h.km.toFixed(1)} km`}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Vehicle */}
      <div>
        <div style={{ ...label, marginBottom: 7 }}>Vehicle</div>
        <div style={{ display: 'flex', gap: 6, overflowX: 'auto', paddingBottom: 3, scrollbarWidth: 'none' }}>
          {VEHICLES.map(v => {
            const on = v.id === nav.vehicleId
            return (
              <button key={v.id} onClick={() => nav.setVehicleId(v.id)} style={{
                flexShrink: 0, padding: '7px 11px', borderRadius: 9, fontSize: 12, fontWeight: 600,
                background: on ? 'rgba(0,212,255,.14)' : 'rgba(255,255,255,.03)',
                border: `1px solid ${on ? 'rgba(0,212,255,.5)' : 'rgba(255,255,255,.08)'}`,
                color: on ? 'var(--accent)' : 'var(--text2)', whiteSpace: 'nowrap',
              }}>{v.icon} {v.label}</button>
            )
          })}
        </div>
      </div>

      {nav.status === 'idle' && (
        <div>
          <div style={{ ...label, marginBottom: 7 }}>Try a road trip</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 7 }}>
            {DEMO_TRIPS.map(t => (
              <button key={t.label} onClick={() => go(t.to, t.from)} style={{
                padding: '8px 12px', borderRadius: 20, fontSize: 12.5, fontWeight: 600,
                background: 'rgba(0,100,255,.08)', border: '1px solid rgba(0,150,255,.25)',
                color: '#7ab8ff',
              }}>{t.label}</button>
            ))}
          </div>
          <div style={{
            marginTop: 16, padding: '12px 14px', borderRadius: 12, fontSize: 12.5, lineHeight: 1.55,
            background: 'rgba(0,212,255,.05)', border: '1px solid rgba(0,212,255,.12)', color: 'var(--text2)',
          }}>
            Every route is checked against crowd-reported hazards. If a slightly longer road
            avoids a critical pothole or a flooded stretch, <b style={{ color: 'var(--accent)' }}>Gemini picks it</b>.
          </div>
        </div>
      )}

      {nav.status === 'planning' && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '18px 4px', color: 'var(--text2)', fontSize: 13.5 }}>
          <span style={{
            width: 20, height: 20, border: '2px solid rgba(0,212,255,.2)',
            borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'map-spin .8s linear infinite',
          }} />
          Finding routes and checking hazards along each…
        </div>
      )}

      {nav.status === 'error' && (
        <div style={{
          padding: '12px 14px', borderRadius: 12, fontSize: 13, color: '#ff8aa8',
          background: 'rgba(255,34,102,.07)', border: '1px solid rgba(255,34,102,.3)',
        }}>{nav.error}</div>
      )}

      {(nav.status === 'ready' || nav.status === 'trip' || nav.status === 'arrived') && nav.options.length > 0 && (
        <>
          <div style={{ ...label }}>
            {nav.options.length} route{nav.options.length > 1 ? 's' : ''} · tap to compare
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
            {nav.options.map((o, i) => {
              const on = i === nav.selected
              const crit = o.hazards.filter(h => h.report.severity === 'critical' || h.report.severity === 'high').length
              return (
                <button
                  key={i}
                  disabled={nav.status === 'trip'}
                  onClick={() => nav.choose(i)}
                  style={{
                    textAlign: 'left', padding: '12px 14px', borderRadius: 13,
                    background: on ? 'rgba(0,212,255,.09)' : 'rgba(255,255,255,.025)',
                    border: `1px solid ${on ? 'rgba(0,212,255,.55)' : 'rgba(255,255,255,.08)'}`,
                    boxShadow: on ? '0 0 22px rgba(0,212,255,.12)' : 'none',
                    color: 'var(--text)', opacity: nav.status === 'trip' && !on ? 0.4 : 1,
                  }}
                >
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 7, minHeight: 4 }}>
                    {o.tags.slice(0, 2).map(t => (
                      <span key={t} style={{
                        fontSize: 10, fontWeight: 800, letterSpacing: '.06em', textTransform: 'uppercase',
                        padding: '2px 8px', borderRadius: 6,
                        background: t === 'Gemini pick' ? 'rgba(0,212,255,.16)' : 'rgba(255,255,255,.07)',
                        color: t === 'Gemini pick' ? 'var(--accent)' : 'var(--text2)',
                      }}>{t}</span>
                    ))}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
                    <span style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 22, letterSpacing: '-.5px' }}>
                      {fmtDur(o.route.duration)}
                    </span>
                    <span style={{ fontSize: 13, color: 'var(--text2)' }}>{fmtKm(o.route.distance)}</span>
                    <span style={{ fontSize: 12, color: 'var(--text3)', marginLeft: 'auto' }}>
                      arrive {clock(o.route.duration * 1000)}
                    </span>
                  </div>
                  {o.route.traffic && (
                    <div style={{ marginTop: 6, fontSize: 12, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <span style={{ width: 8, height: 8, borderRadius: '50%', background: LEVEL_COLOR[o.route.traffic.level], flexShrink: 0 }} />
                      <span style={{ color: LEVEL_COLOR[o.route.traffic.level], fontWeight: 700 }}>
                        {LEVEL_LABEL[o.route.traffic.level]}{o.route.traffic.delay >= 120 ? ` · +${Math.round(o.route.traffic.delay / 60)} min` : ''}
                      </span>
                      <span style={{ color: 'var(--text3)' }}>
                        {o.route.traffic.source === 'live' ? 'live now' : 'typical for this time'}
                      </span>
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 14, marginTop: 8, fontSize: 12.5, flexWrap: 'wrap' }}>
                    <span style={{ color: '#ffcc66', fontWeight: 700 }}>
                      ⛽ {nav.fuelLoading && i === nav.selected ? '…' : '~' + money(o.fuel.cost, o.fuel.currency)}
                    </span>
                    <span style={{ color: 'var(--text3)' }}>
                      {o.fuel.litres.toFixed(o.fuel.litres < 10 ? 1 : 0)} {o.fuel.unit}
                    </span>
                    <span style={{
                      marginLeft: 'auto', fontWeight: 700,
                      color: o.hazards.length === 0 ? '#00ff88' : crit ? '#ff6688' : '#ffaa00',
                    }} title="Road safety for your vehicle, from reported hazards on this road">
                      {o.hazards.length === 0
                        ? '✓ clear road'
                        : `⚠ ${o.hazards.length} hazard${o.hazards.length > 1 ? 's' : ''}`}
                      {' · '}{safetyScore(o.score)}/100
                    </span>
                  </div>
                </button>
              )
            })}
          </div>

          {cur && nav.status !== 'trip' && nav.status !== 'arrived' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { onStartLive(); onShowMap() }} title="Navigate using your real GPS location" style={{
                flex: 1.4, padding: '13px 0', borderRadius: 12, fontWeight: 800, fontSize: 14,
                background: 'linear-gradient(135deg,#0050ff,#00b4ff)', border: 'none', color: '#fff',
                boxShadow: '0 6px 24px rgba(0,120,255,.4)',
              }}>▶ Start navigation</button>
              <button onClick={() => { nav.startTrip('sim'); onShowMap() }} title="Replay this route as a simulated drive" style={{
                flex: 1, padding: '13px 0', borderRadius: 12, fontWeight: 700, fontSize: 13,
                background: 'rgba(255,255,255,.04)', border: '1px solid rgba(0,212,255,.25)', color: 'var(--accent)',
              }}>Simulate</button>
            </div>
          )}

          {cur && (
            <>
              {/* Fuel breakdown */}
              <div style={{
                borderRadius: 13, border: '1px solid rgba(255,204,102,.2)', background: 'rgba(255,204,102,.04)',
              }}>
                <button onClick={() => setShowFuel(s => !s)} style={{
                  width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  background: 'transparent', border: 'none', padding: '11px 14px', color: 'var(--text)',
                }}>
                  <span style={{ fontWeight: 700, fontSize: 13 }}>
                    ⛽ Fuel · ~{money(cur.fuel.cost, cur.fuel.currency)} for {nav.vehicle.label.split(' · ')[0].toLowerCase()}
                  </span>
                  <span style={{ color: 'var(--text3)', fontSize: 12 }}>{showFuel ? '▲' : '▼'}</span>
                </button>
                {showFuel && (
                  <div style={{ padding: '0 14px 13px', fontSize: 12.5, color: 'var(--text2)' }}>
                    {cur.fuel.perState.map(s => (
                      <div key={s.state} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                        <span>{s.state} · {Math.round(s.km)} km</span>
                        <span>
                          {nav.vehicle.fuel === 'ev' ? `${sym(cur.fuel.currency)}${s.price.toFixed(2)}/kWh` : `${sym(cur.fuel.currency)}${s.price.toFixed(2)}/L`} → <b style={{ color: '#ffcc66' }}>{money(s.cost, cur.fuel.currency)}</b>
                        </span>
                      </div>
                    ))}
                    <div style={{ marginTop: 8, fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
                      Average speed {Math.round(cur.fuel.avgKmh)} km/h adjusts efficiency for traffic.
                      {cur.fuel.currency === 'USD' ? 'Outside India: world-average pump price (about US$1.30/L)' : `Pump prices as of ${PRICE_DATE}`}; real mileage varies with load, driving style and AC.
                      {cur.fuel.partial && ' Some states could not be resolved; the national average is used there.'}
                    </div>
                  </div>
                )}
              </div>

              {/* Hazards on this route */}
              <div>
                <div style={{ ...label, marginBottom: 7 }}>Hazards on this route</div>
                {cur.hazards.length === 0 ? (
                  <div style={{ fontSize: 13, color: '#00ff88' }}>Clear. Nothing reported within 140 m of this road.</div>
                ) : cur.hazards.map(h => (
                  <div key={h.report.id} style={{
                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', marginBottom: 6,
                    borderRadius: 10, background: 'rgba(255,255,255,.03)',
                    borderLeft: `3px solid ${SEV[h.report.severity] ?? '#888'}`,
                  }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, textTransform: 'capitalize' }}>
                        {h.report.hazard_type.replace(/_/g, ' ')} · {h.report.severity}
                      </div>
                      <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>
                        {h.report.address ?? 'On route'}
                      </div>
                    </div>
                    <span style={{ fontSize: 12, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                      {fmtKm(h.at)} in
                    </span>
                  </div>
                ))}
              </div>

              {/* Turn list */}
              <div>
                <button onClick={() => setShowSteps(s => !s)} style={{
                  background: 'transparent', border: 'none', padding: 0, color: 'var(--accent)',
                  fontSize: 12.5, fontWeight: 700,
                }}>{showSteps ? '▲ Hide' : '▼ Show'} turn-by-turn ({cur.route.steps.length})</button>
                {showSteps && (
                  <ol style={{ margin: '10px 0 0', padding: 0, listStyle: 'none' }}>
                    {cur.route.steps.map((s, i) => (
                      <li key={i} style={{
                        display: 'flex', justifyContent: 'space-between', gap: 10, padding: '6px 0',
                        fontSize: 12.5, color: 'var(--text2)', borderTop: i ? '1px solid rgba(255,255,255,.05)' : 'none',
                      }}>
                        <span>{s.text}</span>
                        <span style={{ color: 'var(--text3)', whiteSpace: 'nowrap' }}>{fmtKm(s.length)}</span>
                      </li>
                    ))}
                  </ol>
                )}
              </div>
            </>
          )}
        </>
      )}
    </div>
  )
}

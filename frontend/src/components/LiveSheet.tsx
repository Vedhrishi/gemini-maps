import { useState } from 'react'
import { LiveMember, lastName, liveLink } from '../lib/live'
import { shareText } from '../lib/share'
import { fmtKm } from '../lib/routing'

type Live = ReturnType<typeof import('../hooks/useLive').useLive>

const km = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const dx = (b.lng - a.lng) * Math.cos(((a.lat + b.lat) / 2) * Math.PI / 180)
  return Math.hypot(dx, b.lat - a.lat) * 111.2
}

const agoText = (s: number) => (s < 12 ? 'live' : s < 90 ? `${s} s ago` : `${Math.round(s / 60)} min ago`)

export function LiveSheet({ live, me, prefillCode, onClose, onShow, isDesktop }: {
  live: Live
  me: { lat: number; lng: number } | null
  prefillCode?: string | null
  onClose: () => void
  onShow: (m: LiveMember) => void
  isDesktop: boolean
}) {
  const [name, setName] = useState(lastName())
  const [code, setCode] = useState(prefillCode ?? '')
  const [tab, setTab] = useState<'start' | 'join'>(prefillCode ? 'join' : 'start')
  const [note, setNote] = useState('')
  const s = live.session

  const invite = async () => {
    if (!s) return
    const r = await shareText('Meta Maps live location', `Follow me live on Meta Maps. Group code ${s.room}.`, liveLink(s.room))
    setNote(r === 'copied' ? 'Invite copied. Paste it in WhatsApp or SMS.' : r === 'failed' ? 'Could not open sharing. Give them the code instead.' : '')
  }

  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '12px 13px', borderRadius: 11, fontSize: 15,
    background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.14)', color: 'var(--text)',
  }
  const primary: React.CSSProperties = {
    padding: '13px 14px', borderRadius: 12, border: 'none', fontWeight: 800, fontSize: 14, color: '#fff',
    background: 'linear-gradient(135deg,#0050ff,#00b4ff)',
  }

  return (
    <div role="dialog" aria-modal="true" aria-labelledby="live-title" onClick={onClose} style={{
      position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,4,14,.72)', backdropFilter: 'blur(5px)',
      display: 'grid', placeItems: isDesktop ? 'center' : 'end stretch', animation: 'fadeIn 0.2s ease',
    }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: '#0b0f1c', border: '1px solid rgba(0,212,255,.35)', maxHeight: '86vh', overflowY: 'auto',
        borderRadius: isDesktop ? 16 : '18px 18px 0 0', width: isDesktop ? 440 : '100%', boxSizing: 'border-box',
        padding: isDesktop ? '22px 24px' : '20px 18px calc(20px + env(safe-area-inset-bottom))',
        boxShadow: '0 24px 64px rgba(0,0,0,.7)', display: 'flex', flexDirection: 'column', gap: 12,
        animation: 'slideUp 0.25s cubic-bezier(0.4,0,0.2,1)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <h2 id="live-title" style={{ margin: 0, flex: 1, fontFamily: 'var(--font2)', fontSize: 19, color: 'var(--accent)' }}>
            {s ? 'Live group' : 'Live location'}
          </h2>
          <button onClick={onClose} aria-label="Close" style={{
            background: 'rgba(255,255,255,.05)', border: '1px solid rgba(255,255,255,.1)', color: 'var(--text2)',
            width: 32, height: 32, borderRadius: 8, fontSize: 18,
          }}>×</button>
        </div>

        {!s && (
          <>
            <p style={{ margin: 0, fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
              See friends and family on the map while they move, and let them see you. Everyone in a group shares one code.
            </p>
            <div style={{ display: 'flex', gap: 6 }}>
              {(['start', 'join'] as const).map(t => (
                <button key={t} onClick={() => setTab(t)} style={{
                  flex: 1, padding: '9px 10px', borderRadius: 10, fontSize: 13, fontWeight: 700,
                  background: tab === t ? 'rgba(0,212,255,.14)' : 'rgba(255,255,255,.03)',
                  border: `1px solid ${tab === t ? 'rgba(0,212,255,.5)' : 'rgba(255,255,255,.08)'}`,
                  color: tab === t ? 'var(--accent)' : 'var(--text2)',
                }}>{t === 'start' ? 'Start a group' : 'Join with a code'}</button>
              ))}
            </div>
            <input aria-label="Your name" value={name} onChange={e => setName(e.target.value)} maxLength={20} placeholder="Your name" style={field} />
            {tab === 'join' && (
              <input aria-label="Group code" value={code} onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                maxLength={8} placeholder="Group code, like K7M2QX" autoCapitalize="characters"
                style={{ ...field, letterSpacing: '.25em', fontWeight: 800, textAlign: 'center' }} />
            )}
            <button
              disabled={live.busy || !name.trim() || (tab === 'join' && code.length < 4)}
              onClick={() => (tab === 'start' ? live.start(name) : live.join(code, name))}
              style={{ ...primary, opacity: live.busy || !name.trim() || (tab === 'join' && code.length < 4) ? 0.55 : 1 }}
            >{live.busy ? 'Connecting…' : tab === 'start' ? 'Start sharing my location' : 'Join the group'}</button>
            {live.error && <div role="alert" style={{ fontSize: 12.5, color: '#ff8aa8' }}>{live.error}</div>}
            <p style={{ margin: 0, fontSize: 11.5, color: 'var(--text3)', lineHeight: 1.5 }}>
              Your position goes only to people with your code, and stops when you leave the group or close the app for 15 minutes.
            </p>
          </>
        )}

        {s && (
          <>
            <div style={{
              textAlign: 'center', padding: '12px 10px', borderRadius: 12,
              background: 'rgba(0,212,255,.07)', border: '1px solid rgba(0,212,255,.3)',
            }}>
              <div style={{ fontSize: 11.5, color: 'var(--text3)' }}>Group code</div>
              <div style={{ fontFamily: 'var(--font2)', fontWeight: 800, fontSize: 30, letterSpacing: '.22em', color: 'var(--accent)' }}>{s.room}</div>
              <button onClick={invite} style={{ ...primary, marginTop: 8, padding: '10px 18px' }}>📤 Invite people</button>
              {note && <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 6 }}>{note}</div>}
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13.5, fontWeight: 600 }}>
              <input type="checkbox" checked={live.sharing} onChange={e => live.setSharing(e.target.checked)}
                style={{ width: 20, height: 20, accentColor: '#00d4ff' }} />
              Share my location with this group
            </label>
            {live.sharing && !me && <div style={{ fontSize: 12, color: '#ffcc66' }}>Waiting for your location. Allow location access to appear on the map.</div>}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              {live.members.length === 0 && (
                <div style={{ fontSize: 12.5, color: 'var(--text3)' }}>Nobody is on the map yet. Send the invite.</div>
              )}
              {live.members.map(m => {
                const mine = m.id === s.me
                const d = me && !mine ? km(me, m) : null
                return (
                  <button key={m.id} onClick={() => onShow(m)} style={{
                    display: 'flex', alignItems: 'center', gap: 11, textAlign: 'left', padding: '10px 12px', borderRadius: 11,
                    background: 'rgba(255,255,255,.04)', border: '1px solid rgba(255,255,255,.09)', color: 'var(--text)',
                  }}>
                    <span style={{
                      width: 32, height: 32, borderRadius: '50%', background: m.color, color: '#06101c', fontWeight: 800,
                      display: 'grid', placeItems: 'center', flexShrink: 0,
                    }}>{(m.name[0] || '?').toUpperCase()}</span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontSize: 14, fontWeight: 700 }}>{m.name}{mine ? ' (you)' : ''}</span>
                      <span style={{ display: 'block', fontSize: 11.5, color: 'var(--text3)' }}>
                        {agoText(m.ago)}
                        {m.speed != null && m.speed > 3 ? ` · ${m.speed} km/h` : m.ago < 90 ? ' · stopped' : ''}
                        {m.dest ? ` · to ${m.dest}${m.eta != null ? `, ${m.eta} min` : ''}` : ''}
                      </span>
                    </span>
                    {d != null && <span style={{ fontSize: 12.5, fontWeight: 700, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{fmtKm(d * 1000)}</span>}
                  </button>
                )
              })}
            </div>
            <button onClick={() => { live.leave(); onClose() }} style={{
              padding: '11px 14px', borderRadius: 12, fontWeight: 700, fontSize: 13.5, color: '#ff8aa8',
              background: 'rgba(255,34,102,.07)', border: '1px solid rgba(255,34,102,.3)',
            }}>Leave group and stop sharing</button>
          </>
        )}
      </div>
    </div>
  )
}

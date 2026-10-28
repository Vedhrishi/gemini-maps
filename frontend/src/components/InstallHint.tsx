import { useEffect, useState } from 'react'

const KEY = 'gm-install-hint'

/** iPhone Safari can't prompt to install; show a one-time how-to. */
export function InstallHint() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    try {
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent)
      const standalone = (navigator as any).standalone === true || matchMedia('(display-mode: standalone)').matches
      if (ios && !standalone && !localStorage.getItem(KEY)) {
        const t = setTimeout(() => setShow(true), 3500)
        return () => clearTimeout(t)
      }
    } catch { /* storage blocked */ }
  }, [])
  if (!show) return null
  const close = () => { setShow(false); try { localStorage.setItem(KEY, '1') } catch { /* ignore */ } }
  return (
    <div style={{
      position: 'fixed', left: 12, right: 12, bottom: 'calc(12px + env(safe-area-inset-bottom, 0px))', zIndex: 9000,
      background: 'rgba(3,9,20,.97)', border: '1px solid rgba(0,212,255,.3)', borderRadius: 16,
      padding: '12px 14px', display: 'flex', gap: 12, alignItems: 'center', color: '#e8f4ff', fontSize: 13,
    }}>
      <img src={`${import.meta.env.BASE_URL}icon-192.png`} width={40} height={40} alt="" style={{ borderRadius: 10 }} />
      <div style={{ flex: 1, lineHeight: 1.35 }}>
        <b>Install Meta Maps as an app</b><br />
        Tap <span aria-label="Share" style={{ display: 'inline-block', padding: '0 4px', border: '1px solid rgba(0,212,255,.4)', borderRadius: 5, fontSize: 11 }}>Share ⬆</span>
        {' '}then <b>Add to Home Screen</b>. It opens full screen, without the browser bar.
      </div>
      <button onClick={close} style={{ background: 'none', border: 0, color: '#00d4ff', fontWeight: 700, fontSize: 14 }}>Got it</button>
    </div>
  )
}

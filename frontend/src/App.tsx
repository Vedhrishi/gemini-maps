import { useState, useEffect, useCallback, useRef } from 'react'
import { HazardMap } from './components/HazardMap'
import { ReportPanel } from './components/ReportPanel'
import { HazardList } from './components/HazardList'
import { useWebSocket } from './hooks/useWebSocket'
import { useVoice, speak } from './hooks/useVoice'
import { fetchReports, upvoteReport, HazardReport } from './lib/api'

type Tab = 'map' | 'report' | 'list'

export default function App() {
  const [reports, setReports] = useState<HazardReport[]>([])
  const [activeTab, setActiveTab] = useState<Tab>('map')
  const [focusId, setFocusId] = useState<string | null>(null)
  const [voiceEnabled, setVoiceEnabled] = useState(true)
  const [voiceTrigger, setVoiceTrigger] = useState(false)
  const [toasts, setToasts] = useState<{ id: string; text: string; type: 'info' | 'success' | 'warn' }[]>([])
  const [userLat, setUserLat] = useState(20.5937)
  const [userLng, setUserLng] = useState(78.9629)
  const toastId = useRef(0)

  // Get user location
  useEffect(() => {
    navigator.geolocation?.getCurrentPosition(
      pos => { setUserLat(pos.coords.latitude); setUserLng(pos.coords.longitude) },
      () => {},
      { timeout: 5000 }
    )
  }, [])

  // Load initial reports
  useEffect(() => {
    fetchReports().then(setReports).catch(() => {})
  }, [])

  const toast = useCallback((text: string, type: 'info' | 'success' | 'warn' = 'info') => {
    const id = String(toastId.current++)
    setToasts(prev => [...prev, { id, text, type }])
    setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 4000)
  }, [])

  // WebSocket — real-time updates
  useWebSocket({
    onNewHazard: useCallback((r: HazardReport) => {
      setReports(prev => [r, ...prev.filter(x => x.id !== r.id)])
      toast(`🚨 New ${r.severity} ${r.hazard_type} reported nearby`, 'warn')
    }, [toast]),
    onUpvote: useCallback((reportId: string, upvotes: number) => {
      setReports(prev => prev.map(r => r.id === reportId ? { ...r, upvotes } : r))
    }, []),
  })

  // Voice commands
  const handleVoiceCommand = useCallback((cmd: string, raw: string) => {
    switch (cmd) {
      case 'REPORT_HAZARD':
        setVoiceTrigger(true)
        setActiveTab('report')
        break
      case 'ZOOM_IN':
        speak('Zooming in')
        toast('🎙️ Zoom in', 'info')
        break
      case 'ZOOM_OUT':
        speak('Zooming out')
        toast('🎙️ Zoom out', 'info')
        break
      case 'LIST_HAZARDS':
        setActiveTab('list')
        speak(`${reports.length} hazards reported`)
        break
    }
  }, [reports.length, toast])

  const { listening } = useVoice({
    onCommand: handleVoiceCommand,
    enabled: voiceEnabled,
  })

  const handleUpvote = useCallback(async (id: string) => {
    try {
      const upvotes = await upvoteReport(id)
      setReports(prev => prev.map(r => r.id === id ? { ...r, upvotes } : r))
    } catch {}
  }, [])

  const handleNewReport = useCallback((r: HazardReport) => {
    setReports(prev => [r, ...prev])
    setFocusId(r.id)
    setTimeout(() => setActiveTab('map'), 1200)
    toast(`✅ ${r.hazard_type} pinned on map!`, 'success')
  }, [toast])

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: 'map', label: 'Map', icon: '🗺️' },
    { key: 'report', label: 'Report', icon: '📸' },
    { key: 'list', label: `Feed (${reports.length})`, icon: '📋' },
  ]

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden' }}>
      {/* Header */}
      <header style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '0 20px', height: 52,
        background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0, gap: 16,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 22 }}>🚧</span>
          <div>
            <span style={{ fontWeight: 700, fontSize: 16 }}>Gemini Maps</span>
            <span style={{ fontSize: 11, color: 'var(--text2)', marginLeft: 8 }}>
              AI Road Hazard Reporter
            </span>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Voice indicator */}
          <button
            onClick={() => {
              setVoiceEnabled(v => !v)
              toast(voiceEnabled ? '🔇 Voice off' : '🎙️ Voice on', 'info')
            }}
            title={voiceEnabled ? 'Click to disable voice' : 'Click to enable voice'}
            style={{
              background: voiceEnabled ? (listening ? 'rgba(46,160,67,0.2)' : 'var(--surface2)') : 'var(--surface2)',
              color: voiceEnabled ? 'var(--accent2)' : 'var(--text2)',
              border: `1px solid ${voiceEnabled ? 'var(--accent)' : 'var(--border)'}`,
              padding: '5px 12px', fontSize: 12, display: 'flex', alignItems: 'center', gap: 6,
            }}
          >
            <span style={{
              width: 7, height: 7, borderRadius: '50%',
              background: listening ? '#2ea043' : (voiceEnabled ? '#d29922' : '#555'),
              display: 'inline-block',
              animation: listening ? 'pulse 1s ease infinite' : 'none',
            }} />
            {listening ? 'Listening…' : voiceEnabled ? 'Voice on' : 'Voice off'}
          </button>

          <span style={{ fontSize: 11, color: 'var(--text2)' }}>
            {reports.length} reports
          </span>
        </div>
      </header>

      {/* Tab bar (mobile) */}
      <div style={{
        display: 'flex', background: 'var(--surface)', borderBottom: '1px solid var(--border)',
        flexShrink: 0,
      }}>
        {TABS.map(t => (
          <button
            key={t.key}
            onClick={() => setActiveTab(t.key)}
            style={{
              flex: 1, padding: '10px 0',
              background: activeTab === t.key ? 'var(--surface2)' : 'transparent',
              color: activeTab === t.key ? 'var(--text)' : 'var(--text2)',
              borderBottom: activeTab === t.key ? '2px solid var(--accent2)' : '2px solid transparent',
              borderRadius: 0, fontSize: 13, fontWeight: activeTab === t.key ? 600 : 400,
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* Main content */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {/* Desktop: map always visible */}
        <div style={{
          flex: 1, display: activeTab === 'map' || window.innerWidth > 768 ? 'block' : 'none',
        }}>
          <HazardMap
            reports={reports}
            focusId={focusId}
            onUpvote={handleUpvote}
          />
        </div>

        {/* Side panel (desktop) / Full panel (mobile) */}
        <div style={{
          width: activeTab === 'map' && window.innerWidth > 768 ? 360 : '100%',
          display: activeTab === 'report' || activeTab === 'list' || window.innerWidth > 768 ? 'flex' : 'none',
          flexDirection: 'column',
          borderLeft: '1px solid var(--border)',
          overflow: 'hidden',
        }}>
          {(activeTab === 'report' || (activeTab === 'map' && window.innerWidth > 768)) ? (
            <ReportPanel
              userLat={userLat}
              userLng={userLng}
              triggerCapture={voiceTrigger}
              onCaptureHandled={() => setVoiceTrigger(false)}
              onNewReport={handleNewReport}
            />
          ) : (
            <HazardList
              reports={reports}
              onFocus={id => { setFocusId(id); setActiveTab('map') }}
              onUpvote={handleUpvote}
            />
          )}
        </div>
      </div>

      {/* Toast notifications */}
      <div style={{
        position: 'fixed', bottom: 20, right: 20, display: 'flex',
        flexDirection: 'column', gap: 8, zIndex: 9999,
        maxWidth: 320,
      }}>
        {toasts.map(t => (
          <div key={t.id} style={{
            background: t.type === 'success' ? 'rgba(46,160,67,0.15)' :
                        t.type === 'warn' ? 'rgba(210,153,34,0.15)' : 'var(--surface)',
            border: `1px solid ${t.type === 'success' ? 'var(--accent)' : t.type === 'warn' ? 'var(--warn)' : 'var(--border)'}`,
            borderRadius: 8, padding: '10px 16px', fontSize: 13, lineHeight: 1.4,
            animation: 'slideIn 0.2s ease',
            boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
            {t.text}
          </div>
        ))}
      </div>

      <style>{`
        @keyframes pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }
        @keyframes slideIn {
          from { opacity: 0; transform: translateY(8px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  )
}

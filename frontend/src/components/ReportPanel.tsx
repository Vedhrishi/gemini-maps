/**
 * ReportPanel — voice-first camera + upload panel
 * Touchless: "report hazard" → camera → 3s countdown → auto-capture → auto-analyze → pin on map
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { analyzeImage, HazardReport, fetchProvider, providerLabel } from '../lib/api'
import { HAZARD_LABELS, SEVERITY_COLORS } from '../lib/mapUtils'
import { speak } from '../hooks/useVoice'

interface Props {
  userLat: number
  userLng: number
  triggerCapture?: boolean
  onCaptureHandled?: () => void
  onNewReport: (r: HazardReport, merged?: boolean) => void
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff2266', high: '#ff6600', medium: '#ffaa00', low: '#00cc66',
}
const SEV_BG: Record<string, string> = {
  critical: 'rgba(255,34,102,0.12)', high: 'rgba(255,102,0,0.12)',
  medium: 'rgba(255,170,0,0.12)', low: 'rgba(0,204,102,0.12)',
}

export function ReportPanel({ userLat, userLng, triggerCapture, onCaptureHandled, onNewReport }: Props) {
  const [provider, setProvider] = useState('')
  useEffect(() => { fetchProvider().then(setProvider) }, [])
  const [mode, setMode] = useState<'idle' | 'camera' | 'preview' | 'analyzing' | 'result'>('idle')
  const [imgBlob, setImgBlob] = useState<Blob | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [result, setResult] = useState<HazardReport | null>(null)
  const [notHazard, setNotHazard] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [countdown, setCountdown] = useState<number | null>(null)
  const [voiceTriggered, setVoiceTriggered] = useState(false)
  const [analyzeProgress, setAnalyzeProgress] = useState(0)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const inflight = useRef(false) // one analysis at a time (button + auto-analyze both fire)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const progressRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const startCamera = useCallback(async () => {
    setMode('camera')
    setResult(null)
    setNotHazard(false)
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 } }
      })
      streamRef.current = stream
      if (videoRef.current) {
        videoRef.current.srcObject = stream
        await videoRef.current.play()
      }
    } catch {
      setError('Camera unavailable — drop an image below instead.')
      setMode('idle')
    }
  }, [])

  const captureFrame = useCallback(() => {
    if (!videoRef.current) return
    const canvas = document.createElement('canvas')
    canvas.width = videoRef.current.videoWidth
    canvas.height = videoRef.current.videoHeight
    canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
    canvas.toBlob(blob => {
      if (blob) {
        stopCamera()
        setImgBlob(blob)
        setImgUrl(URL.createObjectURL(blob))
        setMode('preview')
      }
    }, 'image/jpeg', 0.9)
  }, [])

  const startCountdown = useCallback(() => {
    setCountdown(3)
    let n = 3
    countdownRef.current = setInterval(() => {
      n--
      if (n > 0) {
        setCountdown(n)
        speak(String(n))
      } else {
        clearInterval(countdownRef.current!)
        countdownRef.current = null
        setCountdown(null)
        if (!videoRef.current) return
        const canvas = document.createElement('canvas')
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        canvas.getContext('2d')!.drawImage(videoRef.current, 0, 0)
        canvas.toBlob(blob => {
          if (blob) {
            stopCamera()
            setImgBlob(blob)
            setImgUrl(URL.createObjectURL(blob))
            setMode('analyzing')
          }
        }, 'image/jpeg', 0.9)
      }
    }, 1000)
  }, [])

  // Voice trigger
  useEffect(() => {
    if (triggerCapture && mode === 'idle') {
      speak('Capturing in 3')
      setVoiceTriggered(true)
      startCamera()
      onCaptureHandled?.()
    }
  }, [triggerCapture, mode, startCamera, onCaptureHandled])

  useEffect(() => {
    if (mode === 'camera' && voiceTriggered) {
      setVoiceTriggered(false)
      setTimeout(() => startCountdown(), 800)
    }
  }, [mode, voiceTriggered, startCountdown])

  const analyzeAndReport = useCallback(async (blob?: Blob) => {
    const b = blob ?? imgBlob
    if (!b || inflight.current) return
    inflight.current = true
    setMode('analyzing')
    setAnalyzeProgress(0)
    setError(null)

    // Fake progress bar
    progressRef.current = setInterval(() => {
      setAnalyzeProgress(p => Math.min(p + Math.random() * 18, 88))
    }, 280)

    try {
      const res = await analyzeImage(b, userLat, userLng)
      clearInterval(progressRef.current!)
      setAnalyzeProgress(100)
      await new Promise(r => setTimeout(r, 300))

      if (res.is_road_hazard && res.report) {
        setResult(res.report)
        setMode('result')
        onNewReport(res.report, res.merged)
        speak(res.report.voice_summary || `${res.report.severity} ${HAZARD_LABELS[res.report.hazard_type]} detected. ${res.report.suggested_action}`)
      } else {
        setNotHazard(true)
        setMode('result')
        speak(res.voice_summary || 'No road hazard detected.')
      }
    } catch (e: any) {
      clearInterval(progressRef.current!)
      setError(e?.response?.data?.detail || 'Analysis failed. Please try again.')
      setMode('preview')
    } finally {
      inflight.current = false
    }
  }, [imgBlob, userLat, userLng, onNewReport])

  // Auto-analyze after voice capture
  useEffect(() => {
    if (mode === 'analyzing' && imgBlob) {
      analyzeAndReport()
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  const handleFile = (file: File) => {
    const blob = file as Blob
    setImgBlob(blob)
    setImgUrl(URL.createObjectURL(file))
    setMode('preview')
    setResult(null)
    setNotHazard(false)
    setError(null)
  }

  const reset = () => {
    stopCamera()
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (progressRef.current) clearInterval(progressRef.current)
    setCountdown(null)
    setMode('idle')
    setImgBlob(null)
    if (imgUrl) URL.revokeObjectURL(imgUrl)
    setImgUrl(null)
    setResult(null)
    setNotHazard(false)
    setError(null)
    setAnalyzeProgress(0)
  }

  useEffect(() => () => { stopCamera(); clearInterval(countdownRef.current!); clearInterval(progressRef.current!) }, [])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>

      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid rgba(0,212,255,0.08)',
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(0,20,48,0.4)',
      }}>
        <div style={{
          width: 38, height: 38, borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(0,64,255,0.3), rgba(0,212,255,0.2))',
          border: '1px solid rgba(0,212,255,0.2)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18,
        }}>📸</div>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--font2)' }}>Report a Hazard</div>
          <div style={{ fontSize: 11, color: 'var(--text3)' }}>
            Say <span style={{ color: 'var(--accent)', fontStyle: 'italic' }}>"report hazard"</span> — fully hands-free
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* ── IDLE ──────────────────────────────────────────── */}
        {mode === 'idle' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'fadeIn 0.3s ease' }}>

            {/* Voice hint banner */}
            <div style={{
              background: 'rgba(0,212,255,0.04)', border: '1px solid rgba(0,212,255,0.12)',
              borderRadius: 12, padding: '12px 16px',
              display: 'flex', alignItems: 'center', gap: 12,
            }}>
              <div style={{
                width: 32, height: 32, borderRadius: '50%', flexShrink: 0,
                background: 'rgba(0,212,255,0.1)', border: '1px solid rgba(0,212,255,0.2)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                position: 'relative',
              }}>
                <span style={{ fontSize: 14 }}>🎙</span>
                <span style={{
                  position: 'absolute', inset: -3, borderRadius: '50%',
                  border: '1px solid rgba(0,212,255,0.3)',
                  animation: 'ping 2s ease-out infinite',
                }} />
              </div>
              <div>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--accent)' }}>Voice-first & touchless</div>
                <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 1 }}>
                  3-second countdown → auto-capture → AI analysis
                </div>
              </div>
            </div>

            {/* Camera button */}
            <button
              onClick={startCamera}
              style={{
                background: 'linear-gradient(135deg, #0040ff, #00aaff)',
                color: '#fff', padding: '14px 0', fontSize: 14,
                fontWeight: 600, width: '100%', borderRadius: 12,
                boxShadow: '0 4px 24px rgba(0,100,255,0.3)',
                letterSpacing: '0.02em',
              }}
            >
              ⊕ &nbsp; Open Camera
            </button>

            {/* Drop zone */}
            <div
              onDragOver={e => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={e => {
                e.preventDefault(); setDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file) handleFile(file)
              }}
              onClick={() => fileRef.current?.click()}
              style={{
                border: `1.5px dashed ${dragOver ? 'rgba(0,212,255,0.6)' : 'rgba(0,212,255,0.18)'}`,
                borderRadius: 12, padding: '28px 16px', textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'rgba(0,212,255,0.06)' : 'rgba(0,212,255,0.02)',
                transition: 'all 0.2s ease',
              }}
            >
              <div style={{ fontSize: 26, marginBottom: 8, opacity: 0.7 }}>📁</div>
              <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text2)' }}>
                Drop image or click to upload
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 4 }}>
                JPG · PNG · WEBP · max 10 MB
              </div>
            </div>
            <input
              ref={fileRef} type="file" accept="image/*"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {error && (
              <div style={{
                background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.25)',
                borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#ff6688',
              }}>⚠ {error}</div>
            )}
          </div>
        )}

        {/* ── CAMERA ────────────────────────────────────────── */}
        {mode === 'camera' && (
          <div style={{ position: 'relative', borderRadius: 14, overflow: 'hidden', animation: 'fadeIn 0.2s ease' }}>
            <video
              ref={videoRef}
              style={{ width: '100%', display: 'block', background: '#000', minHeight: 200 }}
              playsInline muted
            />
            {/* Corner brackets */}
            {(['tl','tr','bl','br'] as const).map(c => (
              <div key={c} style={{
                position: 'absolute',
                top: c.startsWith('t') ? 10 : undefined,
                bottom: c.startsWith('b') ? 10 : undefined,
                left: c.endsWith('l') ? 10 : undefined,
                right: c.endsWith('r') ? 10 : undefined,
                width: 20, height: 20,
                borderTop: c.startsWith('t') ? '2px solid rgba(0,212,255,0.7)' : 'none',
                borderBottom: c.startsWith('b') ? '2px solid rgba(0,212,255,0.7)' : 'none',
                borderLeft: c.endsWith('l') ? '2px solid rgba(0,212,255,0.7)' : 'none',
                borderRight: c.endsWith('r') ? '2px solid rgba(0,212,255,0.7)' : 'none',
              }} />
            ))}

            {/* Countdown overlay */}
            {countdown !== null && (
              <div style={{
                position: 'absolute', inset: 0,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: 'rgba(0,4,16,0.5)',
                backdropFilter: 'blur(2px)',
              }}>
                <div style={{
                  fontSize: 112, fontWeight: 900, color: '#fff',
                  fontFamily: 'var(--font2)',
                  textShadow: '0 0 40px rgba(0,212,255,0.8), 0 0 80px rgba(0,212,255,0.4)',
                  lineHeight: 1,
                  animation: 'countdown-pop 0.9s cubic-bezier(0.34,1.56,0.64,1)',
                }}>{countdown}</div>
              </div>
            )}

            {/* Buttons */}
            {countdown === null && (
              <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0,
                padding: '24px 16px 14px',
                background: 'linear-gradient(to top, rgba(0,4,16,0.85), transparent)',
                display: 'flex', justifyContent: 'center', gap: 10,
              }}>
                <button
                  onClick={captureFrame}
                  style={{
                    background: 'rgba(255,255,255,0.95)', color: '#000',
                    padding: '10px 28px', fontWeight: 700, fontSize: 13, borderRadius: 24,
                  }}
                >📸 Capture</button>
                <button
                  onClick={() => { if (countdownRef.current) clearInterval(countdownRef.current); setCountdown(null); stopCamera(); setMode('idle') }}
                  style={{
                    background: 'rgba(255,255,255,0.1)', color: '#fff',
                    padding: '10px 18px', fontSize: 13, borderRadius: 24,
                    border: '1px solid rgba(255,255,255,0.2)',
                  }}
                >Cancel</button>
              </div>
            )}
          </div>
        )}

        {/* ── PREVIEW ───────────────────────────────────────── */}
        {(mode === 'preview') && imgUrl && (
          <div style={{ animation: 'fadeIn 0.25s ease' }}>
            <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden' }}>
              <img src={imgUrl} style={{ width: '100%', display: 'block', borderRadius: 12 }} alt="Preview" />
              <div style={{
                position: 'absolute', top: 10, right: 10,
                background: 'rgba(0,4,16,0.75)', backdropFilter: 'blur(8px)',
                borderRadius: 8, padding: '4px 10px', fontSize: 11, color: 'var(--text2)',
                border: '1px solid rgba(255,255,255,0.1)',
              }}>Ready to analyze</div>
            </div>
            {error && (
              <div style={{
                background: 'rgba(255,68,68,0.08)', border: '1px solid rgba(255,68,68,0.25)',
                borderRadius: 10, padding: '10px 14px', fontSize: 12, color: '#ff6688', marginTop: 8,
              }}>⚠ {error}</div>
            )}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={() => analyzeAndReport()}
                style={{
                  flex: 1, background: 'linear-gradient(135deg, #0040ff, #00aaff)',
                  color: '#fff', padding: '11px 0', fontWeight: 600, fontSize: 13,
                  borderRadius: 10, boxShadow: '0 4px 16px rgba(0,100,255,0.25)',
                }}
              >🔍 Analyze with AI</button>
              <button
                onClick={reset}
                style={{
                  background: 'rgba(255,255,255,0.06)', color: 'var(--text2)',
                  padding: '11px 16px', borderRadius: 10,
                  border: '1px solid rgba(255,255,255,0.08)',
                }}
              >✕</button>
            </div>
          </div>
        )}

        {/* ── ANALYZING ─────────────────────────────────────── */}
        {mode === 'analyzing' && (
          <div style={{ animation: 'fadeIn 0.2s ease' }}>
            {imgUrl && (
              <div style={{ position: 'relative', borderRadius: 12, overflow: 'hidden', marginBottom: 14 }}>
                <img src={imgUrl} style={{ width: '100%', display: 'block', filter: 'brightness(0.4)' }} alt="" />
                {/* Scan line */}
                <div style={{
                  position: 'absolute', left: 0, right: 0, height: 2,
                  background: 'linear-gradient(90deg, transparent, var(--accent), transparent)',
                  animation: 'scan-line 1.4s ease-in-out infinite',
                  boxShadow: '0 0 12px rgba(0,212,255,0.6)',
                }} />
                <div style={{
                  position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column',
                  alignItems: 'center', justifyContent: 'center', gap: 8,
                }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent)' }}>
                    Analyzing with {providerLabel(provider)}…
                  </div>
                </div>
              </div>
            )}
            {/* Progress bar */}
            <div style={{
              background: 'rgba(0,212,255,0.08)', border: '1px solid rgba(0,212,255,0.12)',
              borderRadius: 8, padding: '12px 16px',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, fontSize: 12 }}>
                <span style={{ color: 'var(--accent)' }}>AI Processing</span>
                <span style={{ color: 'var(--text3)' }}>{Math.round(analyzeProgress)}%</span>
              </div>
              <div style={{ height: 4, background: 'rgba(0,212,255,0.1)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{
                  height: '100%', background: 'linear-gradient(90deg, #0040ff, #00d4ff)',
                  borderRadius: 2, width: `${analyzeProgress}%`,
                  transition: 'width 0.3s ease',
                  boxShadow: '0 0 8px rgba(0,212,255,0.5)',
                }} />
              </div>
              <div style={{ fontSize: 11, color: 'var(--text3)', marginTop: 8 }}>
                Classifying hazard type, severity, and location…
              </div>
            </div>
          </div>
        )}

        {/* ── RESULT ────────────────────────────────────────── */}
        {mode === 'result' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, animation: 'slideUp 0.3s ease' }}>
            {notHazard && (
              <div style={{
                background: 'rgba(0,204,102,0.06)', border: '1px solid rgba(0,204,102,0.2)',
                borderRadius: 14, padding: 20, textAlign: 'center',
              }}>
                <div style={{ fontSize: 32, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 600, color: '#00cc66' }}>Road Clear</div>
                <div style={{ fontSize: 12, color: 'var(--text3)', marginTop: 4 }}>
                  No hazard detected in this image
                </div>
              </div>
            )}

            {result && (() => {
              const c = SEV_COLOR[result.severity] ?? '#888'
              const bg = SEV_BG[result.severity] ?? 'rgba(100,100,100,0.1)'
              return (
                <div style={{
                  background: bg, border: `1px solid ${c}30`,
                  borderRadius: 14, overflow: 'hidden',
                }}>
                  {/* Severity bar */}
                  <div style={{
                    background: `linear-gradient(90deg, ${c}20, transparent)`,
                    borderBottom: `1px solid ${c}25`,
                    padding: '12px 16px',
                    display: 'flex', alignItems: 'center', gap: 10,
                  }}>
                    <span style={{
                      background: c, color: '#000',
                      borderRadius: 6, padding: '3px 10px',
                      fontWeight: 800, fontSize: 11, letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      boxShadow: `0 0 12px ${c}60`,
                    }}>{result.severity}</span>
                    <span style={{ fontWeight: 600, fontSize: 14, fontFamily: 'var(--font2)' }}>
                      {HAZARD_LABELS[result.hazard_type] ?? result.hazard_type}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: 'var(--text3)' }}>
                      {Math.round(result.confidence * 100)}% confidence
                    </span>
                  </div>

                  <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {imgUrl && (
                      <img src={imgUrl} style={{ width: '100%', borderRadius: 8 }} alt="Captured" />
                    )}
                    <p style={{ fontSize: 13, color: 'var(--text2)', lineHeight: 1.5 }}>
                      {result.description}
                    </p>
                    <div style={{
                      background: 'rgba(255,170,0,0.08)', border: '1px solid rgba(255,170,0,0.2)',
                      borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#ffaa00',
                    }}>
                      💡 {result.suggested_action}
                    </div>
                    <div style={{
                      display: 'flex', alignItems: 'center', gap: 8, fontSize: 12,
                      color: 'var(--accent)', fontWeight: 500,
                    }}>
                      <span style={{
                        width: 7, height: 7, borderRadius: '50%', background: 'var(--accent)',
                        display: 'inline-block', animation: 'pulse 1.5s ease infinite',
                      }} />
                      Live pin added to map for all users
                    </div>
                  </div>
                </div>
              )
            })()}

            <button
              onClick={reset}
              style={{
                width: '100%', marginTop: 2,
                background: 'rgba(0,212,255,0.06)',
                color: 'var(--text2)', padding: '11px 0',
                border: '1px solid rgba(0,212,255,0.12)', borderRadius: 10,
                fontSize: 13, fontWeight: 500,
              }}
            >+ Report another hazard</button>
          </div>
        )}
      </div>

      <style>{`
        @keyframes fadeIn { from { opacity:0 } to { opacity:1 } }
        @keyframes slideUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
        @keyframes ping {
          0% { transform:scale(1); opacity:0.7; }
          100% { transform:scale(2.2); opacity:0; }
        }
        @keyframes scan-line {
          0% { top:0%; }
          50% { top:98%; }
          100% { top:0%; }
        }
        @keyframes countdown-pop {
          0% { transform:scale(1.8); opacity:0; }
          30% { transform:scale(1); opacity:1; }
          80% { opacity:1; }
          100% { transform:scale(0.7); opacity:0; }
        }
        @keyframes pulse {
          0%,100% { opacity:1 }
          50% { opacity:0.3 }
        }
      `}</style>
    </div>
  )
}

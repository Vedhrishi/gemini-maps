/**
 * ReportPanel — voice-first camera + upload panel
 *
 * Voice flow: say "report hazard" → auto-opens camera → captures → AI analyzes → pin on map
 * Manual flow: click capture button or drag-drop image
 */

import { useState, useRef, useEffect, useCallback } from 'react'
import { analyzeImage, HazardReport } from '../lib/api'
import { HAZARD_LABELS, SEVERITY_COLORS } from '../lib/mapUtils'
import { speak } from '../hooks/useVoice'

interface Props {
  userLat: number
  userLng: number
  triggerCapture?: boolean          // set true by voice command
  onCaptureHandled?: () => void     // reset trigger after use
  onNewReport: (r: HazardReport) => void
}

export function ReportPanel({ userLat, userLng, triggerCapture, onCaptureHandled, onNewReport }: Props) {
  const [mode, setMode] = useState<'idle' | 'camera' | 'preview' | 'analyzing' | 'result'>('idle')
  const [imgBlob, setImgBlob] = useState<Blob | null>(null)
  const [imgUrl, setImgUrl] = useState<string | null>(null)
  const [result, setResult] = useState<HazardReport | null>(null)
  const [notHazard, setNotHazard] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dragOver, setDragOver] = useState(false)

  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // Start camera
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
      setError('Camera unavailable — please upload an image instead.')
      setMode('idle')
    }
  }, [])

  // Voice trigger: auto-open camera
  useEffect(() => {
    if (triggerCapture && mode === 'idle') {
      speak('Opening camera. Say report hazard or tap the button to capture.')
      startCamera()
      onCaptureHandled?.()
    }
  }, [triggerCapture, mode, startCamera, onCaptureHandled])

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach(t => t.stop())
    streamRef.current = null
  }

  const capture = () => {
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
  }

  const handleFile = (file: File) => {
    setImgBlob(file)
    setImgUrl(URL.createObjectURL(file))
    setMode('preview')
    setResult(null)
    setNotHazard(false)
    setError(null)
  }

  const analyze = async () => {
    if (!imgBlob) return
    setMode('analyzing')
    setError(null)
    try {
      const res = await analyzeImage(imgBlob, userLat, userLng)
      if (res.is_road_hazard && res.report) {
        setResult(res.report)
        setMode('result')
        onNewReport(res.report)
        speak(res.report.voice_summary || `${res.report.severity} ${HAZARD_LABELS[res.report.hazard_type]} detected. ${res.report.suggested_action}`)
      } else {
        setNotHazard(true)
        setMode('result')
        speak(res.voice_summary || 'No road hazard detected in this image.')
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || 'Analysis failed. Please try again.')
      setMode('preview')
    }
  }

  const reset = () => {
    stopCamera()
    setMode('idle')
    setImgBlob(null)
    if (imgUrl) URL.revokeObjectURL(imgUrl)
    setImgUrl(null)
    setResult(null)
    setNotHazard(false)
    setError(null)
  }

  useEffect(() => () => stopCamera(), [])

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      background: 'var(--surface)',
      borderLeft: '1px solid var(--border)',
    }}>
      {/* Header */}
      <div style={{
        padding: '16px 20px',
        borderBottom: '1px solid var(--border)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
      }}>
        <span style={{ fontSize: 20 }}>📸</span>
        <div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Report a Hazard</div>
          <div style={{ fontSize: 11, color: 'var(--text2)' }}>
            Say <em>"report hazard"</em> or click below
          </div>
        </div>
      </div>

      <div style={{ flex: 1, overflow: 'auto', padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>

        {/* Camera view */}
        {mode === 'camera' && (
          <div style={{ position: 'relative', borderRadius: 8, overflow: 'hidden' }}>
            <video
              ref={videoRef}
              style={{ width: '100%', display: 'block', borderRadius: 8, background: '#000' }}
              playsInline muted
            />
            <div style={{
              position: 'absolute', bottom: 12, left: 0, right: 0,
              display: 'flex', justifyContent: 'center', gap: 12,
            }}>
              <button
                onClick={capture}
                style={{
                  background: '#fff', color: '#000', padding: '10px 24px',
                  fontWeight: 700, fontSize: 14,
                }}
              >📸 Capture</button>
              <button
                onClick={() => { stopCamera(); setMode('idle') }}
                style={{ background: 'var(--surface2)', color: 'var(--text)', padding: '10px 16px' }}
              >Cancel</button>
            </div>
          </div>
        )}

        {/* Image preview */}
        {(mode === 'preview' || mode === 'analyzing') && imgUrl && (
          <div>
            <img src={imgUrl} style={{ width: '100%', borderRadius: 8, display: 'block' }} alt="Preview" />
            {error && <p style={{ color: 'var(--danger)', fontSize: 12, marginTop: 8 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
              <button
                onClick={analyze}
                disabled={mode === 'analyzing'}
                style={{
                  flex: 1,
                  background: 'var(--accent2)', color: '#fff',
                  padding: '10px 0', fontWeight: 600,
                }}
              >
                {mode === 'analyzing' ? '🔄 Analyzing…' : '🔍 Analyze'}
              </button>
              <button
                onClick={reset}
                style={{ background: 'var(--surface2)', color: 'var(--text)', padding: '10px 16px' }}
              >✕</button>
            </div>
          </div>
        )}

        {/* Result */}
        {mode === 'result' && (
          <div>
            {notHazard && (
              <div style={{
                background: 'rgba(56,139,253,0.1)', border: '1px solid var(--info)',
                borderRadius: 8, padding: 16, textAlign: 'center',
              }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>✅</div>
                <div style={{ fontWeight: 600 }}>No hazard detected</div>
                <div style={{ fontSize: 12, color: 'var(--text2)', marginTop: 4 }}>
                  Road looks clear!
                </div>
              </div>
            )}
            {result && (
              <div style={{
                background: 'var(--surface2)', border: '1px solid var(--border)',
                borderRadius: 8, padding: 16,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                  <span style={{
                    background: SEVERITY_COLORS[result.severity],
                    color: '#fff', borderRadius: 4,
                    padding: '3px 10px', fontWeight: 700, fontSize: 12,
                    textTransform: 'uppercase',
                  }}>{result.severity}</span>
                  <span style={{ fontWeight: 600 }}>{HAZARD_LABELS[result.hazard_type]}</span>
                </div>
                {imgUrl && (
                  <img src={imgUrl} style={{ width: '100%', borderRadius: 6, marginBottom: 10 }} alt="Captured" />
                )}
                <p style={{ fontSize: 13, color: 'var(--text2)', marginBottom: 8 }}>{result.description}</p>
                <p style={{ fontSize: 12, color: '#d29922', marginBottom: 4 }}>💡 {result.suggested_action}</p>
                <p style={{ fontSize: 11, color: 'var(--accent2)' }}>
                  ✅ Pinned on map for all users
                </p>
              </div>
            )}
            <button
              onClick={reset}
              style={{
                width: '100%', marginTop: 10,
                background: 'var(--surface2)', color: 'var(--text)',
                padding: '10px 0', border: '1px solid var(--border)',
              }}
            >Report another</button>
          </div>
        )}

        {/* Idle state */}
        {mode === 'idle' && (
          <>
            <button
              onClick={startCamera}
              style={{
                background: 'var(--accent2)', color: '#fff',
                padding: '14px 0', fontSize: 15, fontWeight: 600,
                width: '100%',
              }}
            >
              📷 Open Camera
            </button>

            {/* Drag-drop upload */}
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
                border: `2px dashed ${dragOver ? 'var(--info)' : 'var(--border)'}`,
                borderRadius: 8, padding: '24px 16px', textAlign: 'center',
                cursor: 'pointer',
                background: dragOver ? 'rgba(56,139,253,0.05)' : 'transparent',
                transition: 'all 0.15s',
              }}
            >
              <div style={{ fontSize: 28, marginBottom: 8 }}>📁</div>
              <div style={{ fontSize: 13, fontWeight: 500 }}>Drop image here or click to upload</div>
              <div style={{ fontSize: 11, color: 'var(--text2)', marginTop: 4 }}>JPG, PNG, WEBP — max 10MB</div>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])}
            />

            {error && <p style={{ color: 'var(--danger)', fontSize: 12 }}>{error}</p>}
          </>
        )}
      </div>
    </div>
  )
}

/**
 * TelemetryBar — live mission-control strip under the header.
 * Shows session uptime, GPS fix, report rate, severity mix, and a rolling sparkline.
 */

import { useEffect, useRef, useState } from 'react'
import { HazardReport } from '../lib/api'
import { AnimatedCounter } from './AnimatedCounter'

interface Props {
  reports: HazardReport[]
  reportRate: number
  userLat: number
  userLng: number
  /** Drop the lower-priority stats on narrow screens. */
  compact?: boolean
}

const SEV_COLOR: Record<string, string> = {
  critical: '#ff2266',
  high: '#ff6600',
  medium: '#ffaa00',
  low: '#00cc66',
}

function Sparkline({ data, color }: { data: number[]; color: string }) {
  const max = Math.max(1, ...data)
  const pts = data.map((v, i) => {
    const x = (i / Math.max(1, data.length - 1)) * 100
    const y = 100 - (v / max) * 88 - 6
    return `${x},${y}`
  })
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" style={{ width: 72, height: 22, display: 'block' }}>
      <defs>
        <linearGradient id="spark-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      {pts.length > 1 && (
        <>
          <polygon points={`0,100 ${pts.join(' ')} 100,100`} fill="url(#spark-fill)" />
          <polyline
            points={pts.join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </>
      )}
    </svg>
  )
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span style={{
      fontSize: 9, letterSpacing: '0.14em', textTransform: 'uppercase',
      color: 'var(--text3)', fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

const valueStyle = (color?: string): React.CSSProperties => ({
  fontSize: 13, fontWeight: 700, lineHeight: 1.1,
  color: color ?? 'var(--text)',
  fontFamily: 'var(--font2)',
  fontVariantNumeric: 'tabular-nums',
  whiteSpace: 'nowrap',
})

/** Stats must never shrink — squeezed flex items overlap their neighbours. */
const statBox: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0,
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={statBox}>
      <Label>{label}</Label>
      <span style={valueStyle(color)}>{value}</span>
    </div>
  )
}

/** Stat whose number counts up/down when it changes. */
function CountStat({
  label, value, color, suffix = '',
}: { label: string; value: number; color?: string; suffix?: string }) {
  return (
    <div style={statBox}>
      <Label>{label}</Label>
      <span style={valueStyle(color)}>
        <AnimatedCounter value={value} format={n => `${Math.round(n)}${suffix}`} />
      </span>
    </div>
  )
}

function Divider() {
  return <div style={{ width: 1, height: 26, background: 'rgba(0,212,255,0.1)', flexShrink: 0 }} />
}

export function TelemetryBar({ reports, reportRate, userLat, userLng, compact }: Props) {
  const [uptime, setUptime] = useState(0)
  const [history, setHistory] = useState<number[]>(Array(24).fill(0))
  const startRef = useRef(Date.now())

  useEffect(() => {
    const t = setInterval(() => {
      setUptime(Math.floor((Date.now() - startRef.current) / 1000))
    }, 1000)
    return () => clearInterval(t)
  }, [])

  // Roll the sparkline every 5s with current report count delta
  const lastCount = useRef(reports.length)
  useEffect(() => {
    const t = setInterval(() => {
      const delta = reports.length - lastCount.current
      lastCount.current = reports.length
      setHistory(h => [...h.slice(1), Math.max(0, delta)])
    }, 5000)
    return () => clearInterval(t)
  }, [reports.length])

  // Bump sparkline immediately on a new report
  useEffect(() => {
    if (reports.length > 0) {
      setHistory(h => {
        const next = [...h]
        next[next.length - 1] = next[next.length - 1] + 1
        return next
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports.length])

  const hh = String(Math.floor(uptime / 3600)).padStart(2, '0')
  const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, '0')
  const ss = String(uptime % 60).padStart(2, '0')

  const counts = {
    critical: reports.filter(r => r.severity === 'critical').length,
    high: reports.filter(r => r.severity === 'high').length,
    medium: reports.filter(r => r.severity === 'medium').length,
    low: reports.filter(r => r.severity === 'low').length,
  }
  const total = Math.max(1, reports.length)

  const avgConfidence = reports.length
    ? Math.round((reports.reduce((s, r) => s + (r.confidence ?? 0), 0) / reports.length) * 100)
    : 0

  const totalUpvotes = reports.reduce((s, r) => s + (r.upvotes ?? 0), 0)

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 18,
      padding: '8px 20px',
      background: 'rgba(2,6,16,0.75)',
      backdropFilter: 'blur(24px)',
      borderBottom: '1px solid rgba(0,212,255,0.07)',
      flexShrink: 0, zIndex: 160,
      overflowX: 'auto',
      scrollbarWidth: 'none',
    }}>
      <Stat label="Uptime" value={`${hh}:${mm}:${ss}`} color="var(--accent)" />
      <Divider />

      {!compact && (
        <>
          <Stat
            label="GPS Fix"
            value={`${userLat.toFixed(3)}° ${userLng.toFixed(3)}°`}
            color="#7ab8ff"
          />
          <Divider />
        </>
      )}

      <CountStat
        label="Rate" value={reportRate} suffix="/min"
        color={reportRate > 0 ? '#00ff88' : 'var(--text2)'}
      />
      <Divider />

      <CountStat
        label="Avg Conf." value={avgConfidence} suffix="%"
        color={avgConfidence > 70 ? '#00ff88' : 'var(--text2)'}
      />
      <Divider />

      <CountStat label="Upvotes" value={totalUpvotes} color="#7ab8ff" />
      <Divider />

      {/* Severity distribution bar */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3, flexShrink: 0 }}>
        <Label>Severity Mix</Label>
        <div style={{
          display: 'flex', height: 6, borderRadius: 3, overflow: 'hidden',
          background: 'rgba(255,255,255,0.05)', width: 140,
        }}>
          {(['critical', 'high', 'medium', 'low'] as const).map(sev => (
            counts[sev] > 0 && (
              <div
                key={sev}
                title={`${sev}: ${counts[sev]}`}
                style={{
                  width: `${(counts[sev] / total) * 100}%`,
                  background: SEV_COLOR[sev],
                  boxShadow: `0 0 8px ${SEV_COLOR[sev]}88`,
                  transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
                }}
              />
            )
          ))}
        </div>
      </div>

      {!compact && (
        <>
          <Divider />
          {/* Sparkline */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 1, flexShrink: 0 }}>
            <Label>Activity</Label>
            <Sparkline data={history} color="#00d4ff" />
          </div>
        </>
      )}

      {/* Right-aligned provider badge */}
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0, paddingLeft: 8 }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 7,
          background: 'rgba(0,212,255,0.05)',
          border: '1px solid rgba(0,212,255,0.14)',
          borderRadius: 20, padding: '5px 13px',
        }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', background: '#00d4ff',
            boxShadow: '0 0 8px #00d4ff', animation: 'pulse 2s ease infinite',
          }} />
          <span style={{
            fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
            color: 'var(--accent)', fontFamily: 'var(--font2)',
          }}>GEMINI VISION</span>
        </div>
      </div>
    </div>
  )
}

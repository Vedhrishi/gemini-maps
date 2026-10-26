import { useEffect, useRef, useCallback } from 'react'
import { WS_URL, HazardReport } from '../lib/api'

interface WSCallbacks {
  onNewHazard?: (report: HazardReport) => void
  onUpvote?: (reportId: string, upvotes: number) => void
}

export function useWebSocket({ onNewHazard, onUpvote }: WSCallbacks) {
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)

  const connect = useCallback(() => {
    if (!mountedRef.current) return
    try {
      const ws = new WebSocket(`${WS_URL}/ws`)
      wsRef.current = ws

      ws.onopen = () => {
        console.log('[WS] Connected')
        // Keepalive ping every 25s
        const ping = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) ws.send('ping')
        }, 25000)
        ws.addEventListener('close', () => clearInterval(ping))
      }

      ws.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data)
          if (msg.event === 'new_hazard' && onNewHazard) onNewHazard(msg.report)
          if (msg.event === 'upvote' && onUpvote) onUpvote(msg.report_id, msg.upvotes)
        } catch {}
      }

      ws.onclose = () => {
        if (mountedRef.current) {
          reconnectRef.current = setTimeout(connect, 3000)
        }
      }

      ws.onerror = () => ws.close()
    } catch (e) {
      reconnectRef.current = setTimeout(connect, 5000)
    }
  }, [onNewHazard, onUpvote])

  useEffect(() => {
    mountedRef.current = true
    connect()
    return () => {
      mountedRef.current = false
      if (reconnectRef.current) clearTimeout(reconnectRef.current)
      wsRef.current?.close()
    }
  }, [connect])
}

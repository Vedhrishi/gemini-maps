/**
 * useVoice — hands-free voice control hook
 *
 * TODAY: Web Speech API (browser built-in) for recognition + SpeechSynthesis for TTS
 * TOMORROW: swap recognition to call /api/transcribe (Muse Voice Transcribe 1.0)
 *           swap TTS to call Muse TTS endpoint
 *
 * Activation phrase: "report hazard" → triggers camera capture + AI analysis
 * User can also say: "zoom in", "zoom out", "list hazards"
 */

import { useRef, useCallback, useEffect, useState } from 'react'

type VoiceCommand =
  | 'REPORT_HAZARD'
  | 'ZOOM_IN'
  | 'ZOOM_OUT'
  | 'LIST_HAZARDS'
  | 'UNKNOWN'

interface UseVoiceOptions {
  onCommand: (cmd: VoiceCommand, raw: string) => void
  enabled?: boolean
}

function parseCommand(text: string): VoiceCommand {
  const t = text.toLowerCase().trim()
  if (t.includes('report') || t.includes('hazard') || t.includes('danger') || t.includes('capture'))
    return 'REPORT_HAZARD'
  if (t.includes('zoom in') || t.includes('closer')) return 'ZOOM_IN'
  if (t.includes('zoom out') || t.includes('farther')) return 'ZOOM_OUT'
  if (t.includes('list') || t.includes('show') || t.includes('what')) return 'LIST_HAZARDS'
  return 'UNKNOWN'
}

export function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utt = new SpeechSynthesisUtterance(text)
  utt.rate = 1.1
  utt.pitch = 1.0
  utt.volume = 0.9
  window.speechSynthesis.speak(utt)
}

export function useVoice({ onCommand, enabled = true }: UseVoiceOptions) {
  const recognitionRef = useRef<any>(null)
  const [listening, setListening] = useState<boolean>(false)
  const [supported, setSupported] = useState<boolean>(false)

  const start = useCallback(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = window as any
    const SR: { new(): any } | undefined = w.SpeechRecognition || w.webkitSpeechRecognition
    if (!SR || !enabled) return
    setSupported(true)

    const rec = new SR()
    rec.continuous = true
    rec.interimResults = false
    rec.lang = 'en-US'

    rec.onresult = (e: any) => {
      const text = e.results[e.results.length - 1][0].transcript
      const cmd = parseCommand(text)
      onCommand(cmd, text)
    }

    rec.onstart = () => setListening(true)
    rec.onend = () => {
      setListening(false)
      // Auto-restart if still enabled
      if (enabled) setTimeout(() => start(), 500)
    }
    rec.onerror = (ev: any) => {
      if (ev.error !== 'no-speech') console.warn('[Voice]', ev.error)
    }

    recognitionRef.current = rec
    try { rec.start() } catch {}
  }, [onCommand, enabled])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    recognitionRef.current = null
    setListening(false)
  }, [])

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
    setSupported(!!SR)
    if (enabled && SR) start()
    return () => stop()
  }, [enabled, start, stop])

  return { listening, supported }
}

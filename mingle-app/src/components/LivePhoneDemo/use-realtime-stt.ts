'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Utterance } from './ChatBubble'
import { setNativeAudioMode } from '@/lib/native-audio-session'
import {
  addNativeSttListener,
  shouldUseNativeSttSession,
  startNativeSttSession,
  stopNativeSttSession,
} from '@/lib/native-stt-session'

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT || '3001'
const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const protocol = isSecure ? 'wss' : 'ws'
  return `${protocol}://${host}:${WS_PORT}`
}
const DEFAULT_USAGE_LIMIT_SEC = 60

const LS_KEY_UTTERANCES = 'mingle_demo_utterances'
const LS_KEY_USAGE = 'mingle_demo_usage_sec'
const LS_KEY_TTS_DEBUG = 'mingle_tts_debug'
const LS_KEY_STT_DEBUG = 'mingle_stt_debug'

type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'error'

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return output
}

function toBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

interface UseRealtimeSTTOptions {
  languages: string[]
  onLimitReached?: () => void
  onTtsAudio?: (utteranceId: string, audioBlob: Blob, language: string) => void
  enableTts?: boolean
  usageLimitSec?: number | null
}

interface LocalFinalizeResult {
  utteranceId: string
  text: string
  lang: string
}

interface TranslateApiResult {
  translations: Record<string, string>
  ttsLanguage?: string
  ttsAudioBase64?: string
  ttsAudioMime?: string
}

type NativeListenerHandle = {
  remove: () => Promise<void>
}

function decodeBase64AudioToBlob(base64: string, mime = 'audio/mpeg'): Blob | null {
  try {
    const binary = atob(base64)
    const len = binary.length
    const bytes = new Uint8Array(len)
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return new Blob([bytes], { type: mime })
  } catch {
    return null
  }
}

function isTtsDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const forced = window.localStorage.getItem(LS_KEY_TTS_DEBUG)
    if (forced === '1') return true
    if (forced === '0') return false
  } catch {
    // no-op
  }
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (cap?.isNativePlatform?.()) return true
  } catch {
    // no-op
  }
  return /(?:\?|&)ttsDebug=1(?:&|$)/.test(window.location.search || '')
}

function logTtsDebug(event: string, payload?: Record<string, unknown>) {
  if (!isTtsDebugEnabled()) return
  if (payload) {
    console.log('[MingleTTS]', event, payload)
    return
  }
  console.log('[MingleTTS]', event)
}

function isSttDebugEnabled(): boolean {
  if (typeof window === 'undefined') return false
  try {
    const forced = window.localStorage.getItem(LS_KEY_STT_DEBUG)
    if (forced === '1') return true
    if (forced === '0') return false
  } catch {
    // no-op
  }
  try {
    const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor
    if (cap?.isNativePlatform?.()) return true
  } catch {
    // no-op
  }
  return /(?:\?|&)sttDebug=1(?:&|$)/.test(window.location.search || '')
}

function logSttDebug(event: string, payload?: Record<string, unknown>) {
  if (!isSttDebugEnabled()) return
  if (payload) {
    console.log('[MingleSTT]', event, payload)
    return
  }
  console.log('[MingleSTT]', event)
}

export default function useRealtimeSTT({
  languages,
  onLimitReached,
  onTtsAudio,
  enableTts,
  usageLimitSec = DEFAULT_USAGE_LIMIT_SEC,
}: UseRealtimeSTTOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')

  const [utterances, setUtterances] = useState<Utterance[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem(LS_KEY_UTTERANCES)
      if (!stored) return []
      const parsed: Utterance[] = JSON.parse(stored)
      // Deduplicate by id (fix corrupted data from previous bug)
      const seen = new Set<string>()
      return parsed.filter(u => {
        if (seen.has(u.id)) return false
        seen.add(u.id)
        return true
      })
    } catch { return [] }
  })
  const [partialTranscript, setPartialTranscript] = useState('')
  const [partialTranslations, setPartialTranslations] = useState<Record<string, string>>({})
  const [partialLang, setPartialLang] = useState<string | null>(null)
  const [volume, setVolume] = useState(0)
  const [usageSec, setUsageSec] = useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      return parseInt(localStorage.getItem(LS_KEY_USAGE) || '0', 10)
    } catch { return 0 }
  })

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const utteranceIdRef = useRef(0)
  const usageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const lastAudioChunkAtRef = useRef(0)
  const isBackgroundRecoveringRef = useRef(false)
  const wasBackgroundedRef = useRef(false)
  const nativeListenerHandlesRef = useRef<NativeListenerHandle[]>([])
  const isUsingNativeSttRef = useRef(false)
  const onLimitReachedRef = useRef(onLimitReached)
  onLimitReachedRef.current = onLimitReached

  // Ref mirror of partialTranslations for synchronous read
  // (avoids nesting setUtterances inside setPartialTranslations updater,
  //  which causes duplicates in React Strict Mode)
  const partialTranslationsRef = useRef<Record<string, string>>({})
  const partialTranscriptRef = useRef('')
  const partialLangRef = useRef<string | null>(null)
  const isStoppingRef = useRef(false)
  const onTtsAudioRef = useRef(onTtsAudio)
  onTtsAudioRef.current = onTtsAudio
  const enableTtsRef = useRef(enableTts)
  enableTtsRef.current = enableTts
  const stopFinalizeDedupRef = useRef<{ sig: string, expiresAt: number }>({ sig: '', expiresAt: 0 })
  const pendingLocalFinalizeRef = useRef<{ utteranceId: string, text: string, lang: string, expiresAt: number } | null>(null)
  const finalizedTtsSignatureRef = useRef<Map<string, string>>(new Map())
  // Monotonically increasing sequence number for translation requests.
  // Responses with a seq lower than the latest applied seq are discarded,
  // preventing old (slow) translations from overwriting newer ones.
  const translateSeqRef = useRef(0)
  const lastAppliedSeqRef = useRef<Map<string, number>>(new Map()) // utteranceId -> last applied seq
  // Track the partial transcript length at which we last fired a partial translation.
  // We fire a new partial translation every time the length crosses the next 5-char threshold.
  const lastPartialTranslateLenRef = useRef(0)
  const partialTranslateControllerRef = useRef<AbortController | null>(null)

  const removeNativeSttListeners = useCallback(() => {
    const handles = nativeListenerHandlesRef.current
    nativeListenerHandlesRef.current = []
    for (const handle of handles) {
      void handle.remove().catch(() => {})
    }
  }, [])

  // Persist utterances to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_UTTERANCES, JSON.stringify(utterances))
    } catch { /* ignore */ }
  }, [utterances])

  // Persist usage to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_USAGE, String(usageSec))
    } catch { /* ignore */ }
  }, [usageSec])

  useEffect(() => {
    partialTranscriptRef.current = partialTranscript
  }, [partialTranscript])

  useEffect(() => {
    partialLangRef.current = partialLang
  }, [partialLang])

  const appendUtterances = useCallback((items: Utterance[]) => {
    if (items.length === 0) return
    setUtterances((prev) => {
      const seen = new Set(prev.map((utterance) => utterance.id))
      const merged = [...prev]
      for (const item of items) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        merged.push(item)
      }
      return merged
    })
  }, [])

  const normalizedUsageLimitSec = (
    typeof usageLimitSec === 'number'
    && Number.isFinite(usageLimitSec)
    && usageLimitSec > 0
  ) ? usageLimitSec : null
  const isLimitReached = normalizedUsageLimitSec !== null && usageSec >= normalizedUsageLimitSec

  const stopAudioPipeline = useCallback((options?: { closeContext?: boolean }) => {
    const shouldCloseContext = options?.closeContext === true
    if (usageIntervalRef.current) {
      clearInterval(usageIntervalRef.current)
      usageIntervalRef.current = null
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (sourceRef.current) {
      sourceRef.current.disconnect()
      sourceRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    const context = audioContextRef.current
    if (context && context.state !== 'closed') {
      if (shouldCloseContext) {
        audioContextRef.current = null
        void context.close().catch(() => {})
      } else if (context.state === 'running') {
        // Keep context for next STT start; closing can disrupt playback route on iOS.
        void context.suspend().catch(() => {})
      }
    }
    analyserRef.current = null
    setVolume(0)
  }, [])

  const cleanup = useCallback(() => {
    stopAudioPipeline({ closeContext: true })
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    removeNativeSttListeners()
    if (isUsingNativeSttRef.current) {
      isUsingNativeSttRef.current = false
      void stopNativeSttSession()
    }
  }, [removeNativeSttListeners, stopAudioPipeline])

  const resetToIdle = useCallback(() => {
    isStoppingRef.current = false
    cleanup()
    setConnectionStatus('idle')
  }, [cleanup])

  const clearPartialBuffers = useCallback(() => {
    setPartialTranslations({})
    partialTranslationsRef.current = {}
    setPartialTranscript('')
    partialTranscriptRef.current = ''
    setPartialLang(null)
    partialLangRef.current = null
    lastPartialTranslateLenRef.current = 0
    if (partialTranslateControllerRef.current) {
      partialTranslateControllerRef.current.abort()
      partialTranslateControllerRef.current = null
    }
  }, [])

  // ===== HTTP Translation via /api/translate/finalize =====
  const translateViaApi = useCallback(async (
    text: string,
    sourceLanguage: string,
    targetLanguages: string[],
    options?: {
      signal?: AbortSignal
      ttsLanguage?: string
    },
  ): Promise<TranslateApiResult> => {
    const langs = targetLanguages.filter(l => l !== sourceLanguage)
    if (!text.trim() || langs.length === 0) return { translations: {} }
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    logTtsDebug('translate.request', {
      requestId,
      sourceLanguage,
      targetLanguages: langs,
      ttsLanguage: options?.ttsLanguage || null,
      textLen: text.trim().length,
    })
    try {
      const body: Record<string, unknown> = { text, sourceLanguage, targetLanguages: langs }
      const normalizedTtsLang = (options?.ttsLanguage || '').trim()
      if (normalizedTtsLang) {
        body.tts = { language: normalizedTtsLang }
      }
      const res = await fetch('/api/translate/finalize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
      })
      if (!res.ok) {
        logTtsDebug('translate.non_ok', { requestId, status: res.status })
        return { translations: {} }
      }
      const data = await res.json()
      const ttsAudioBase64 = typeof data.ttsAudioBase64 === 'string' ? data.ttsAudioBase64 : undefined
      logTtsDebug('translate.response', {
        requestId,
        translationKeys: Object.keys((data.translations || {}) as Record<string, string>),
        ttsLanguage: typeof data.ttsLanguage === 'string' ? data.ttsLanguage : null,
        hasInlineTts: Boolean(ttsAudioBase64),
        ttsAudioLen: ttsAudioBase64?.length || 0,
      })
      return {
        translations: (data.translations || {}) as Record<string, string>,
        ttsLanguage: typeof data.ttsLanguage === 'string' ? data.ttsLanguage : undefined,
        ttsAudioBase64,
        ttsAudioMime: typeof data.ttsAudioMime === 'string' ? data.ttsAudioMime : undefined,
      }
    } catch {
      logTtsDebug('translate.error', { requestId })
      return { translations: {} }
    }
  }, [])

  const synthesizeTtsViaApi = useCallback(async (text: string, language: string): Promise<Blob | null> => {
    const normalizedText = text.trim()
    const normalizedLang = language.trim()
    if (!normalizedText || !normalizedLang) return null
    const requestId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
    logTtsDebug('tts_fallback.request', {
      requestId,
      language: normalizedLang,
      textLen: normalizedText.length,
    })
    try {
      const res = await fetch('/api/tts/inworld', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: normalizedText, language: normalizedLang }),
      })
      if (!res.ok) {
        logTtsDebug('tts_fallback.non_ok', { requestId, status: res.status })
        return null
      }
      const arrayBuffer = await res.arrayBuffer()
      if (!arrayBuffer || arrayBuffer.byteLength === 0) {
        logTtsDebug('tts_fallback.empty_audio', { requestId })
        return null
      }
      const mime = res.headers.get('content-type') || 'audio/mpeg'
      logTtsDebug('tts_fallback.response', {
        requestId,
        mime,
        audioBytes: arrayBuffer.byteLength,
      })
      return new Blob([arrayBuffer], { type: mime })
    } catch {
      logTtsDebug('tts_fallback.error', { requestId })
      return null
    }
  }, [])

  const handleInlineTtsFromTranslate = useCallback((
    utteranceId: string,
    sourceLanguage: string,
    result: TranslateApiResult,
  ) => {
    if (!enableTtsRef.current) return
    const ttsTargetLang = (result.ttsLanguage || languages.filter(l => l !== sourceLanguage)[0] || '').trim()
    if (!ttsTargetLang) return
    const ttsText = (result.translations[ttsTargetLang] || '').trim()
    if (!ttsText) return

    const signature = `${ttsTargetLang}::${ttsText}`
    if (finalizedTtsSignatureRef.current.get(utteranceId) === signature) return
    logTtsDebug('tts.inline.received', {
      utteranceId,
      sourceLanguage,
      ttsTargetLang,
      textLen: ttsText.length,
      hasInlineAudio: Boolean(result.ttsAudioBase64),
      inlineAudioLen: result.ttsAudioBase64?.length || 0,
    })

    const queueAudioIfValid = (audioBlob: Blob | null): boolean => {
      if (!audioBlob || audioBlob.size === 0) {
        logTtsDebug('tts.queue.skip_invalid_audio', { utteranceId, ttsTargetLang })
        return false
      }
      if (finalizedTtsSignatureRef.current.get(utteranceId) === signature) return true
      finalizedTtsSignatureRef.current.set(utteranceId, signature)
      logTtsDebug('tts.queue.enqueue', {
        utteranceId,
        ttsTargetLang,
        audioBytes: audioBlob.size,
      })
      onTtsAudioRef.current?.(utteranceId, audioBlob, ttsTargetLang)
      return true
    }

    if (result.ttsAudioBase64) {
      const audioBlob = decodeBase64AudioToBlob(result.ttsAudioBase64, result.ttsAudioMime || 'audio/mpeg')
      if (queueAudioIfValid(audioBlob)) return
    }

    // Inline TTS is missing/invalid: recover by calling server-side Inworld proxy.
    logTtsDebug('tts.inline.missing_or_invalid_fallback', { utteranceId, ttsTargetLang })
    void synthesizeTtsViaApi(ttsText, ttsTargetLang).then((fallbackBlob) => {
      queueAudioIfValid(fallbackBlob)
    })
  }, [languages, synthesizeTtsViaApi])

  const applyTranslationToUtterance = useCallback((
    utteranceId: string,
    translations: Record<string, string>,
    seq: number,
    markFinalized: boolean,
  ) => {
    // Discard if a newer translation has already been applied.
    const lastApplied = lastAppliedSeqRef.current.get(utteranceId) ?? -1
    if (seq <= lastApplied) return
    lastAppliedSeqRef.current.set(utteranceId, seq)

    setUtterances(prev => {
      const idx = prev.findIndex(u => u.id === utteranceId)
      if (idx < 0) return prev
      const target = prev[idx]
      const newTranslations = { ...target.translations }
      const newFinalized = { ...(target.translationFinalized || {}) }
      for (const [lang, text] of Object.entries(translations)) {
        if (text.trim()) {
          newTranslations[lang] = text.trim()
          if (markFinalized) newFinalized[lang] = true
        }
      }
      return [
        ...prev.slice(0, idx),
        { ...target, translations: newTranslations, translationFinalized: newFinalized },
        ...prev.slice(idx + 1),
      ]
    })
  }, [])

  const finalizePendingLocally = useCallback((rawText: string, rawLang: string): LocalFinalizeResult | null => {
    const text = rawText.replace(/<\/?end>/gi, '').trim()
    const lang = (rawLang || 'unknown').trim() || 'unknown'
    if (!text) return null

    const sig = `${lang}::${text}`
    const now = Date.now()
    if (
      sig
      && stopFinalizeDedupRef.current.sig === sig
      && now < stopFinalizeDedupRef.current.expiresAt
    ) {
      setPartialTranslations({})
      partialTranslationsRef.current = {}
      setPartialTranscript('')
      partialTranscriptRef.current = ''
      setPartialLang(null)
      partialLangRef.current = null
      return null
    }
    stopFinalizeDedupRef.current = { sig, expiresAt: now + 5000 }

    utteranceIdRef.current += 1
    const seedTranslations = { ...partialTranslationsRef.current }
    const seedFinalized: Record<string, boolean> = {}
    for (const key of Object.keys(seedTranslations)) {
      seedFinalized[key] = false
    }

    const utteranceId = `u-${Date.now()}-${utteranceIdRef.current}`
    setUtterances(prev => [...prev, {
      id: utteranceId,
      originalText: text,
      originalLang: lang,
      translations: seedTranslations,
      translationFinalized: seedFinalized,
    }])
    setPartialTranslations({})
    partialTranslationsRef.current = {}
    setPartialTranscript('')
    partialTranscriptRef.current = ''
    setPartialLang(null)
    partialLangRef.current = null
    pendingLocalFinalizeRef.current = { utteranceId, text, lang, expiresAt: now + 15000 }
    return { utteranceId, text, lang }
  }, [])

  const stopRecordingGracefully = useCallback(async (notifyLimitReached = false) => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true

    void setNativeAudioMode('playback')
    stopAudioPipeline({ closeContext: false })

    const socket = socketRef.current
    const usingNativeStt = isUsingNativeSttRef.current
    const pendingText = partialTranscriptRef.current.trim()
    const pendingLang = partialLangRef.current || 'unknown'
    let localFinalizeResult: LocalFinalizeResult | null = null

    // Finalize immediately in UI.
    if (pendingText) {
      localFinalizeResult = finalizePendingLocally(pendingText, pendingLang)
    }

    if (usingNativeStt) {
      isUsingNativeSttRef.current = false
      removeNativeSttListeners()
      await stopNativeSttSession({
        pendingText,
        pendingLanguage: pendingLang,
      })
    } else {
      // Fire-and-forget stop_recording to server (so it can clean up STT provider)
      try {
        if (socket && socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({
            type: 'stop_recording',
            data: {
              pending_text: pendingText,
              pending_language: pendingLang,
            },
          }))
        }
      } catch { /* ignore */ }

      // Close socket immediately — no need to wait for ACK since translation is HTTP.
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
    }
    setConnectionStatus('idle')
    isStoppingRef.current = false

    if (notifyLimitReached) {
      onLimitReachedRef.current?.()
    }

    // Translate the finalized text via HTTP (fire-and-forget, results update utterance).
    if (localFinalizeResult && languages.length > 0) {
      const { utteranceId, text, lang } = localFinalizeResult
      const ttsTargetLang = enableTtsRef.current ? (languages.filter(l => l !== lang)[0] || '') : ''
      const seq = ++translateSeqRef.current
      translateViaApi(text, lang, languages, { ttsLanguage: ttsTargetLang }).then(result => {
        if (Object.keys(result.translations).length > 0) {
          applyTranslationToUtterance(utteranceId, result.translations, seq, true)
          handleInlineTtsFromTranslate(utteranceId, lang, result)
        }
      })
    }
  }, [applyTranslationToUtterance, finalizePendingLocally, handleInlineTtsFromTranslate, languages, removeNativeSttListeners, stopAudioPipeline, translateViaApi])

  const visualize = useCallback(() => {
    if (analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += Math.pow((dataArray[i] - 128) / 128, 2)
      }
      const rms = Math.sqrt(sum / dataArray.length)
      setVolume(rms)
      animationFrameRef.current = requestAnimationFrame(visualize)
    } else {
      setVolume(0)
    }
  }, [])

  const startAudioProcessing = useCallback(() => {
    if (!audioContextRef.current || !streamRef.current || !socketRef.current) return

    const context = audioContextRef.current
    const stream = streamRef.current
    const socket = socketRef.current

    const source = context.createMediaStreamSource(stream)
    sourceRef.current = source
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    visualize()

    const processor = context.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor
    source.connect(processor)
    processor.connect(context.destination)
    processor.onaudioprocess = (e) => {
      if (socket.readyState === WebSocket.OPEN) {
        lastAudioChunkAtRef.current = Date.now()
        const inputData = e.inputBuffer.getChannelData(0)
        const pcmData = floatTo16BitPCM(inputData)
        const base64Data = toBase64(pcmData)
        socket.send(JSON.stringify({
          type: 'audio_chunk',
          data: { chunk: base64Data }
        }))
      }
    }
  }, [visualize])

  const handleSttTransportError = useCallback((details?: Record<string, unknown>) => {
    logSttDebug('transport.error', details)
    const remainingPartial = partialTranscriptRef.current.trim()
    if (remainingPartial) {
      const result = finalizePendingLocally(remainingPartial, partialLangRef.current || 'unknown')
      if (result && languages.length > 0) {
        const seq = ++translateSeqRef.current
        const ttsTargetLang = enableTtsRef.current ? (languages.filter(l => l !== result.lang)[0] || '') : ''
        translateViaApi(result.text, result.lang, languages, { ttsLanguage: ttsTargetLang }).then(res => {
          if (Object.keys(res.translations).length > 0) {
            applyTranslationToUtterance(result.utteranceId, res.translations, seq, true)
            handleInlineTtsFromTranslate(result.utteranceId, result.lang, res)
          }
        })
      }
    }
    cleanup()
    setConnectionStatus('error')
    setTimeout(() => setConnectionStatus('idle'), 3000)
  }, [applyTranslationToUtterance, cleanup, finalizePendingLocally, handleInlineTtsFromTranslate, languages, translateViaApi])

  const handleSttTransportClose = useCallback((details?: Record<string, unknown>) => {
    logSttDebug('transport.close', details)
    if (!isStoppingRef.current) {
      const remainingPartial = partialTranscriptRef.current.trim()
      if (remainingPartial) {
        const result = finalizePendingLocally(remainingPartial, partialLangRef.current || 'unknown')
        if (result && languages.length > 0) {
          const seq = ++translateSeqRef.current
          const ttsTargetLang = enableTtsRef.current ? (languages.filter(l => l !== result.lang)[0] || '') : ''
          translateViaApi(result.text, result.lang, languages, { ttsLanguage: ttsTargetLang }).then(res => {
            if (Object.keys(res.translations).length > 0) {
              applyTranslationToUtterance(result.utteranceId, res.translations, seq, true)
              handleInlineTtsFromTranslate(result.utteranceId, result.lang, res)
            }
          })
        }
      }
    }
    resetToIdle()
  }, [applyTranslationToUtterance, finalizePendingLocally, handleInlineTtsFromTranslate, languages, resetToIdle, translateViaApi])

  const handleSttServerMessage = useCallback((message: Record<string, unknown>) => {
    if (message.status === 'ready') {
      logSttDebug('transport.ready', { native: isUsingNativeSttRef.current })
      setConnectionStatus('ready')
      lastAudioChunkAtRef.current = Date.now()
      if (!isUsingNativeSttRef.current) {
        startAudioProcessing()
      }

      if (usageIntervalRef.current) {
        clearInterval(usageIntervalRef.current)
      }
      usageIntervalRef.current = setInterval(() => {
        setUsageSec(prev => {
          const next = prev + 1
          if (normalizedUsageLimitSec !== null && next >= normalizedUsageLimitSec) {
            setTimeout(() => {
              void stopRecordingGracefully(true)
            }, 0)
          }
          return next
        })
      }, 1000)
      return
    }

    if (message.type === 'stop_recording_ack') {
      return
    }

    if (message.type === 'transcript' && typeof message.data === 'object' && message.data !== null) {
      const data = message.data as Record<string, unknown>
      const utterance = (typeof data.utterance === 'object' && data.utterance !== null)
        ? data.utterance as Record<string, unknown>
        : null
      if (!utterance) return

      const rawText = typeof utterance.text === 'string' ? utterance.text : ''
      const text = rawText.replace(/<\/?end>/gi, '').trim()
      const lang = typeof utterance.language === 'string' ? utterance.language : 'unknown'
      const isFinal = data.is_final === true

      if (isStoppingRef.current && !isFinal) {
        return
      }

      if (isFinal) {
        const sig = `${lang}::${text}`
        const now = Date.now()
        if (
          sig
          && stopFinalizeDedupRef.current.sig === sig
          && now < stopFinalizeDedupRef.current.expiresAt
        ) {
          stopFinalizeDedupRef.current = { sig: '', expiresAt: 0 }
          return
        }
        stopFinalizeDedupRef.current = { sig: '', expiresAt: 0 }

        const pendingLocal = pendingLocalFinalizeRef.current
        if (
          pendingLocal
          && now < pendingLocal.expiresAt
          && pendingLocal.lang === lang
          && (
            text.startsWith(pendingLocal.text)
            || pendingLocal.text.startsWith(text)
          )
        ) {
          const mergedText = isStoppingRef.current
            ? pendingLocal.text
            : (text.length >= pendingLocal.text.length ? text : pendingLocal.text)
          setUtterances(prev => prev.map((utteranceItem) => {
            if (utteranceItem.id !== pendingLocal.utteranceId) return utteranceItem
            return {
              ...utteranceItem,
              originalText: mergedText,
            }
          }))
          pendingLocalFinalizeRef.current = null
          clearPartialBuffers()
          return
        }

        utteranceIdRef.current += 1
        const seedTranslations = { ...partialTranslationsRef.current }
        const seedFinalized: Record<string, boolean> = {}
        for (const key of Object.keys(seedTranslations)) {
          seedFinalized[key] = false
        }
        const newUtteranceId = `u-${Date.now()}-${utteranceIdRef.current}`
        const newUtterance: Utterance = {
          id: newUtteranceId,
          originalText: text,
          originalLang: lang,
          translations: seedTranslations,
          translationFinalized: seedFinalized,
        }
        setUtterances(u => [...u, newUtterance])
        clearPartialBuffers()
        pendingLocalFinalizeRef.current = null

        if (languages.length > 0) {
          const seq = ++translateSeqRef.current
          const ttsTargetLang = enableTtsRef.current ? (languages.filter(l => l !== lang)[0] || '') : ''
          translateViaApi(text, lang, languages, { ttsLanguage: ttsTargetLang }).then(result => {
            if (Object.keys(result.translations).length > 0) {
              applyTranslationToUtterance(newUtteranceId, result.translations, seq, true)
              handleInlineTtsFromTranslate(newUtteranceId, lang, result)
            }
          })
        }
      } else {
        setPartialTranscript(text)
        partialTranscriptRef.current = text
        setPartialLang(lang)
        partialLangRef.current = lang
      }
    }
  }, [applyTranslationToUtterance, clearPartialBuffers, handleInlineTtsFromTranslate, languages, normalizedUsageLimitSec, startAudioProcessing, stopRecordingGracefully, translateViaApi])

  const startRecording = useCallback(async () => {
    if (isStoppingRef.current) return
    const useNativeStt = shouldUseNativeSttSession()
    logSttDebug('recording.start.request', {
      useNativeStt,
      wsUrl: getWsUrl(),
      languagesCount: languages.length,
    })
    if (
      !useNativeStt
      && socketRef.current
      && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)
    ) {
      return
    }

    // Check limit before starting
    if (normalizedUsageLimitSec !== null && usageSec >= normalizedUsageLimitSec) {
      onLimitReachedRef.current?.()
      return
    }

    try {
      setConnectionStatus('connecting')
      stopFinalizeDedupRef.current = { sig: '', expiresAt: 0 }
      pendingLocalFinalizeRef.current = null
      setPartialTranscript('')
      setPartialTranslations({})
      partialTranslationsRef.current = {}
      setPartialLang(null)
      removeNativeSttListeners()

      if (useNativeStt) {
        logSttDebug('native.start.begin')
        isUsingNativeSttRef.current = true
        await setNativeAudioMode('recording')
        logSttDebug('native.step.audio_mode.ok')
        const statusHandle = await addNativeSttListener('status', (event) => {
          logSttDebug('native.status', event)
          handleSttServerMessage(event)
        })
        const messageHandle = await addNativeSttListener('message', (event) => {
          const raw = typeof event.raw === 'string' ? event.raw : ''
          if (!raw) return
          try {
            const message = JSON.parse(raw) as Record<string, unknown>
            handleSttServerMessage(message)
          } catch {
            // ignore malformed event payload
          }
        })
        const errorHandle = await addNativeSttListener('error', (event) => {
          handleSttTransportError({
            native: true,
            message: typeof event.message === 'string' ? event.message : '',
          })
        })
        const closeHandle = await addNativeSttListener('close', (event) => {
          handleSttTransportClose({
            native: true,
            reason: typeof event.reason === 'string' ? event.reason : '',
          })
        })
        nativeListenerHandlesRef.current = [statusHandle, messageHandle, errorHandle, closeHandle]
        logSttDebug('native.step.listeners.ok')
        await startNativeSttSession({
          wsUrl: getWsUrl(),
          languages,
          sttModel: 'soniox',
          langHintsStrict: true,
        })
        logSttDebug('native.start.success')
        return
      }

      logSttDebug('web.start.begin')
      isUsingNativeSttRef.current = false
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        }
      })
      streamRef.current = stream

      let context = audioContextRef.current
      if (!context || context.state === 'closed') {
        context = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
        audioContextRef.current = context
      }
      if (context.state === 'suspended') {
        try {
          await context.resume()
        } catch { /* no-op */ }
      }

      await setNativeAudioMode('recording')

      const socket = new WebSocket(getWsUrl())
      socketRef.current = socket

      socket.onopen = () => {
        const config = {
          sample_rate: context.sampleRate,
          languages,
          stt_model: 'soniox',
          lang_hints_strict: true,
        }
        socket.send(JSON.stringify(config))
      }

      socket.onmessage = (event) => {
        if (socket !== socketRef.current) return
        try {
          const message = JSON.parse(event.data) as Record<string, unknown>
          handleSttServerMessage(message)
        } catch {
          // ignore malformed payload
        }
      }

      socket.onerror = () => {
        if (socket !== socketRef.current) return
        handleSttTransportError({ native: false })
      }

      socket.onclose = () => {
        if (socket !== socketRef.current) return
        handleSttTransportClose({ native: false })
      }
    } catch (error) {
      logSttDebug('recording.start.failed', {
        native: useNativeStt,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'unknown',
      })
      void setNativeAudioMode('playback')
      cleanup()
      setConnectionStatus('error')
      setTimeout(() => setConnectionStatus('idle'), 3000)
    }
  }, [cleanup, handleSttServerMessage, handleSttTransportClose, handleSttTransportError, languages, normalizedUsageLimitSec, removeNativeSttListeners, usageSec])

  const recoverFromBackgroundIfNeeded = useCallback(async () => {
    if (isUsingNativeSttRef.current) return
    if (connectionStatus !== 'ready') return
    if (isBackgroundRecoveringRef.current) return
    isBackgroundRecoveringRef.current = true

    try {
      const context = audioContextRef.current
      if (context?.state === 'suspended') {
        try {
          await context.resume()
        } catch { /* no-op */ }
      }

      const track = streamRef.current?.getAudioTracks()?.[0] ?? null
      const trackDead = !track || track.readyState !== 'live'
      const contextNotRunning = !audioContextRef.current || audioContextRef.current.state !== 'running'
      const noChunksTooLong = (Date.now() - lastAudioChunkAtRef.current) > 3000

      if (trackDead || contextNotRunning || noChunksTooLong) {
        await stopRecordingGracefully()
        await new Promise<void>((resolve) => {
          window.setTimeout(() => resolve(), 120)
        })
        await startRecording()
      }
    } finally {
      isBackgroundRecoveringRef.current = false
    }
  }, [connectionStatus, startRecording, stopRecordingGracefully])

  // ===== Partial translation: fire every 5-char threshold =====
  const PARTIAL_TRANSLATE_STEP = 5
  useEffect(() => {
    const len = partialTranscript.trim().length
    if (len === 0 || languages.length === 0 || connectionStatus !== 'ready') return
    // Determine the next threshold the length must reach to fire a translation.
    const nextThreshold = lastPartialTranslateLenRef.current + PARTIAL_TRANSLATE_STEP
    if (len < nextThreshold) return

    // We crossed a threshold — fire partial translation.
    lastPartialTranslateLenRef.current = Math.floor(len / PARTIAL_TRANSLATE_STEP) * PARTIAL_TRANSLATE_STEP

    // Capture the utterance counter at request time so we can discard stale responses
    // that arrive after a new utterance has started (prevents cross-utterance contamination).
    const requestUtteranceId = utteranceIdRef.current
    const currentLang = partialLangRef.current || 'unknown'
    translateViaApi(partialTranscript.trim(), currentLang, languages)
      .then(result => {
        // Discard if a new utterance has started since this request was fired.
        if (utteranceIdRef.current !== requestUtteranceId) return
        for (const [lang, text] of Object.entries(result.translations)) {
          partialTranslationsRef.current = { ...partialTranslationsRef.current, [lang]: text }
          setPartialTranslations(prev => ({ ...prev, [lang]: text }))
        }
      })
  }, [partialTranscript, languages, connectionStatus, translateViaApi])

  const toggleRecording = useCallback(() => {
    if (connectionStatus === 'error') return
    if (connectionStatus !== 'idle') {
      void stopRecordingGracefully()
    } else {
      startRecording()
    }
  }, [connectionStatus, startRecording, stopRecordingGracefully])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  useEffect(() => {
    const shouldStop = () => connectionStatus === 'ready' || connectionStatus === 'connecting'

    const handleOffline = () => {
      if (!shouldStop()) return
      void stopRecordingGracefully()
    }

    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('offline', handleOffline)
    }
  }, [connectionStatus, stopRecordingGracefully])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) {
        wasBackgroundedRef.current = true
        return
      }
      if (!wasBackgroundedRef.current) return
      wasBackgroundedRef.current = false
      void recoverFromBackgroundIfNeeded()
    }

    const handlePageShow = () => {
      if (document.hidden) return
      wasBackgroundedRef.current = false
      void recoverFromBackgroundIfNeeded()
    }

    const handleFocus = () => {
      if (document.hidden) return
      void recoverFromBackgroundIfNeeded()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('focus', handleFocus)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('focus', handleFocus)
    }
  }, [recoverFromBackgroundIfNeeded])

  return {
    connectionStatus,
    utterances,
    partialTranscript,
    volume,
    toggleRecording,
    isActive: connectionStatus !== 'idle' && connectionStatus !== 'error',
    isReady: connectionStatus === 'ready',
    isConnecting: connectionStatus === 'connecting',
    isError: connectionStatus === 'error',
    partialTranslations,
    partialLang,
    usageSec,
    isLimitReached,
    usageLimitSec: normalizedUsageLimitSec,
    appendUtterances,
  }
}

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Utterance } from './ChatBubble'

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
const LS_KEY_SESSION = 'mingle_demo_session_key'
const LS_KEY_TTS_DEBUG = 'mingle_tts_debug'
const LS_KEY_STT_DEBUG = 'mingle_stt_debug'
const NATIVE_STT_QUERY_KEY = 'nativeStt'
const NATIVE_STT_EVENT = 'mingle:native-stt'
const RECENT_TURN_CONTEXT_WINDOW_MS = 10_000

type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'error'

type NativeSttStartCommand = {
  type: 'native_stt_start'
  payload: {
    wsUrl: string
    languages: string[]
    sttModel: string
    langHintsStrict: boolean
    aecEnabled: boolean
  }
}

type NativeSttStopCommand = {
  type: 'native_stt_stop'
  payload: {
    pendingText: string
    pendingLanguage: string
  }
}

type NativeSttSetAecCommand = {
  type: 'native_stt_set_aec'
  payload: { enabled: boolean }
}

type NativeSttBridgeCommand = NativeSttStartCommand | NativeSttStopCommand | NativeSttSetAecCommand

type NativeSttBridgeEvent =
  | { type: 'status', status: string }
  | { type: 'message', raw: string }
  | { type: 'error', message: string }
  | { type: 'close', reason: string }

declare global {
  interface Window {
    ReactNativeWebView?: {
      postMessage: (message: string) => void
    }
  }
}

function shouldUseNativeSttBridge(): boolean {
  if (typeof window === 'undefined') return false
  if (typeof window.ReactNativeWebView?.postMessage !== 'function') return false
  try {
    const params = new URLSearchParams(window.location.search || '')
    const value = (params.get(NATIVE_STT_QUERY_KEY) || '').trim().toLowerCase()
    return value === '1' || value === 'true'
  } catch {
    return false
  }
}

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

function inferUtteranceCreatedAtMs(utterance: Pick<Utterance, 'id' | 'createdAtMs'>): number | null {
  if (typeof utterance.createdAtMs === 'number' && Number.isFinite(utterance.createdAtMs) && utterance.createdAtMs > 0) {
    return Math.floor(utterance.createdAtMs)
  }
  const match = /^u-(\d+)-/.exec(utterance.id)
  if (!match) return null
  const parsed = Number(match[1])
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return Math.floor(parsed)
}

function normalizeStoredUtterance(utterance: Utterance): Utterance {
  const createdAtMs = inferUtteranceCreatedAtMs(utterance)
  if (createdAtMs === null) return utterance
  if (utterance.createdAtMs === createdAtMs) return utterance
  return { ...utterance, createdAtMs }
}

function normalizeSttTurnText(rawText: string): string {
  // Drop Soniox end markers, then strip leading punctuation/whitespace noise.
  // If the turn is only these characters, this returns an empty string.
  return rawText
    .replace(/<\/?end>/gi, '')
    .replace(/^[\s.,!?;:，。、…—–-]+/u, '')
    .trim()
}

function normalizeLangForCompare(rawLanguage: string): string {
  return (rawLanguage || '').trim().replace('_', '-').toLowerCase().split('-')[0] || ''
}

function stripSourceLanguageFromTranslations(
  translationsRaw: Record<string, string>,
  sourceLanguageRaw: string,
): Record<string, string> {
  const sourceLanguage = normalizeLangForCompare(sourceLanguageRaw)
  const translations: Record<string, string> = {}
  for (const [language, translatedText] of Object.entries(translationsRaw)) {
    const normalizedLanguage = (language || '').trim()
    const normalizedLanguageForCompare = normalizeLangForCompare(normalizedLanguage)
    const cleaned = translatedText.trim()
    if (!normalizedLanguage || !cleaned) continue
    if (sourceLanguage && normalizedLanguageForCompare === sourceLanguage) continue
    translations[normalizedLanguage] = cleaned
  }
  return translations
}

function buildTurnTargetLanguagesSnapshot(
  languagesRaw: string[],
  sourceLanguageRaw: string,
): string[] {
  const sourceLanguage = normalizeLangForCompare(sourceLanguageRaw)
  const targetLanguages: string[] = []
  const seen = new Set<string>()
  for (const languageRaw of languagesRaw) {
    const language = (languageRaw || '').trim()
    if (!language) continue
    const normalizedLanguage = normalizeLangForCompare(language)
    if (sourceLanguage && normalizedLanguage === sourceLanguage) continue
    const key = normalizedLanguage || language.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    targetLanguages.push(language)
  }
  return targetLanguages
}

function buildCurrentTurnPreviousStatePayload(
  sourceLanguageRaw: string,
  sourceTextRaw: string,
  translationsRaw: Record<string, string>,
): CurrentTurnPreviousStatePayload | null {
  const sourceLanguage = (sourceLanguageRaw || 'unknown').trim() || 'unknown'
  const sourceText = normalizeSttTurnText(sourceTextRaw)
  if (!sourceText) return null

  const translations = stripSourceLanguageFromTranslations(translationsRaw, sourceLanguage)

  return {
    sourceLanguage,
    sourceText,
    translations,
  }
}

interface UseRealtimeSTTOptions {
  languages: string[]
  onLimitReached?: () => void
  onTtsRequested?: (utteranceId: string, language: string) => void
  onTtsAudio?: (utteranceId: string, audioBlob: Blob, language: string) => void
  enableTts?: boolean
  enableAec?: boolean
  usageLimitSec?: number | null
}

interface LocalFinalizeResult {
  utteranceId: string
  text: string
  lang: string
  currentTurnPreviousState: CurrentTurnPreviousStatePayload | null
}

interface TranslateApiResult {
  translations: Record<string, string>
  ttsLanguage?: string
  ttsAudioBase64?: string
  ttsAudioMime?: string
  provider?: string
  model?: string
}

interface RecentTurnContextPayload {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
  occurredAtMs: number
  ageMs: number
}

interface CurrentTurnPreviousStatePayload {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
}

interface ClientEventLogPayload {
  eventType: 'stt_session_started' | 'stt_session_stopped' | 'stt_turn_started' | 'stt_turn_finalized'
  clientMessageId?: string
  sourceLanguage?: string
  sourceText?: string
  translations?: Record<string, string>
  sttDurationMs?: number
  totalDurationMs?: number
  provider?: string
  model?: string
  metadata?: Record<string, unknown>
  keepalive?: boolean
}

function createSessionKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `sess_${crypto.randomUUID().replace(/-/g, '')}`
  }
  return `sess_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`
}

function getOrCreateSessionKey(): string {
  if (typeof window === 'undefined') return createSessionKey()
  try {
    const existing = window.localStorage.getItem(LS_KEY_SESSION)?.trim()
    if (existing) return existing
    const generated = createSessionKey()
    window.localStorage.setItem(LS_KEY_SESSION, generated)
    return generated
  } catch {
    return createSessionKey()
  }
}

function buildClientContextPayload(usageSec: number): Record<string, unknown> {
  if (typeof window === 'undefined') {
    return { usageSec }
  }

  let timezone: string | null = null
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || null
  } catch {
    timezone = null
  }

  return {
    language: navigator.language || null,
    pageLanguage: document.documentElement?.lang || null,
    referrer: document.referrer || null,
    fullUrl: window.location.href || null,
    queryParams: window.location.search || null,
    pathname: window.location.pathname || null,
    screenWidth: window.screen?.width ?? null,
    screenHeight: window.screen?.height ?? null,
    timezone,
    platform: navigator.platform || null,
    appVersion: process.env.NEXT_PUBLIC_APP_VERSION || null,
    usageSec,
  }
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

const LOAD_BATCH_SIZE = 100

export default function useRealtimeSTT({
  languages,
  onLimitReached,
  onTtsRequested,
  onTtsAudio,
  enableTts,
  enableAec = false,
  usageLimitSec = DEFAULT_USAGE_LIMIT_SEC,
}: UseRealtimeSTTOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')

  // All utterances from localStorage (used as pagination source + merge base for persist)
  const storedUtterancesRef = useRef<Utterance[]>([])
  const storageLoadedCountRef = useRef(0)
  const [hasOlderUtterances, setHasOlderUtterances] = useState(false)

  const [utterances, setUtterances] = useState<Utterance[]>(() => {
    if (typeof window === 'undefined') return []
    try {
      const stored = localStorage.getItem(LS_KEY_UTTERANCES)
      if (!stored) return []
      const parsed: Utterance[] = JSON.parse(stored)
      // Deduplicate by id (fix corrupted data from previous bug)
      const seen = new Set<string>()
      const all = parsed.filter(u => {
        if (seen.has(u.id)) return false
        seen.add(u.id)
        return true
      }).map(normalizeStoredUtterance)
      storedUtterancesRef.current = all
      const initial = all.slice(-LOAD_BATCH_SIZE)
      storageLoadedCountRef.current = initial.length
      return initial
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
  const utterancesRef = useRef<Utterance[]>(utterances)
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
  const onLimitReachedRef = useRef(onLimitReached)
  onLimitReachedRef.current = onLimitReached

  // Ref mirror of partialTranslations for synchronous read
  // (avoids nesting setUtterances inside setPartialTranslations updater,
  //  which causes duplicates in React Strict Mode)
  const partialTranslationsRef = useRef<Record<string, string>>({})
  const partialTranscriptRef = useRef('')
  const partialLangRef = useRef<string | null>(null)
  const isStoppingRef = useRef(false)
  const onTtsRequestedRef = useRef(onTtsRequested)
  onTtsRequestedRef.current = onTtsRequested
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
  // Track the partial transcript 10-char threshold last used for partial translation.
  // A first partial translation fires immediately when the first transcript arrives,
  // then subsequent calls fire when 10/20/30... thresholds are crossed.
  const hasFiredInitialPartialTranslateRef = useRef(false)
  const lastPartialTranslateLenRef = useRef(0)
  const partialTranslateControllerRef = useRef<AbortController | null>(null)
  const sessionKeyRef = useRef('')
  const turnStartedAtRef = useRef<number | null>(null)
  const hasActiveSessionRef = useRef(false)
  const useNativeSttRef = useRef(false)
  const nativeStopRequestedRef = useRef(false)

  const sendNativeSttCommand = useCallback((command: NativeSttBridgeCommand): boolean => {
    if (typeof window === 'undefined') return false
    const bridge = window.ReactNativeWebView
    if (!bridge || typeof bridge.postMessage !== 'function') return false
    try {
      bridge.postMessage(JSON.stringify(command))
      return true
    } catch {
      return false
    }
  }, [])

  useEffect(() => {
    useNativeSttRef.current = shouldUseNativeSttBridge()
  }, [])

  // Initialize hasOlderUtterances after mount
  useEffect(() => {
    setHasOlderUtterances(storedUtterancesRef.current.length > storageLoadedCountRef.current)
  }, [])

  const loadOlderUtterances = useCallback(() => {
    const stored = storedUtterancesRef.current
    const alreadyLoaded = storageLoadedCountRef.current
    if (alreadyLoaded >= stored.length) return

    const nextCount = Math.min(alreadyLoaded + LOAD_BATCH_SIZE, stored.length)
    const startIdx = stored.length - nextCount
    const endIdx = stored.length - alreadyLoaded
    const olderBatch = stored.slice(startIdx, endIdx)

    storageLoadedCountRef.current = nextCount
    setHasOlderUtterances(nextCount < stored.length)
    setUtterances(prev => [...olderBatch, ...prev])
  }, [])

  // Forward AEC toggle to native module in real-time (hot-swap mid-session).
  const prevEnableAecRef = useRef(enableAec)
  useEffect(() => {
    if (prevEnableAecRef.current === enableAec) return
    prevEnableAecRef.current = enableAec
    if (!useNativeSttRef.current) return
    sendNativeSttCommand({ type: 'native_stt_set_aec', payload: { enabled: enableAec } })
  }, [enableAec, sendNativeSttCommand])

  // Merge current state with stored utterances for persistence.
  // Keeps older items not yet loaded via pagination + current state (loaded historical + new session).
  const buildMergedUtterances = useCallback((current: Utterance[]) => {
    const stored = storedUtterancesRef.current
    if (stored.length === 0) return current
    const visibleIds = new Set(current.map(u => u.id))
    const olderNotLoaded = stored.filter(u => !visibleIds.has(u.id))
    return [...olderNotLoaded, ...current]
  }, [])

  // Persist utterances to localStorage (debounced to avoid stringify on every update)
  const utterancePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => {
    if (utterancePersistTimerRef.current) clearTimeout(utterancePersistTimerRef.current)
    utterancePersistTimerRef.current = setTimeout(() => {
      try {
        localStorage.setItem(LS_KEY_UTTERANCES, JSON.stringify(buildMergedUtterances(utterances)))
      } catch { /* ignore */ }
    }, 1000)
    return () => {
      if (utterancePersistTimerRef.current) clearTimeout(utterancePersistTimerRef.current)
    }
  }, [utterances, buildMergedUtterances])

  // Flush pending localStorage write when app goes to background
  useEffect(() => {
    const flushUtterances = () => {
      if (!utterancePersistTimerRef.current) return
      clearTimeout(utterancePersistTimerRef.current)
      utterancePersistTimerRef.current = null
      try {
        localStorage.setItem(LS_KEY_UTTERANCES, JSON.stringify(buildMergedUtterances(utterancesRef.current)))
      } catch { /* ignore */ }
    }
    document.addEventListener('visibilitychange', flushUtterances)
    return () => document.removeEventListener('visibilitychange', flushUtterances)
  }, [buildMergedUtterances])

  // Persist usage to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_USAGE, String(usageSec))
    } catch { /* ignore */ }
  }, [usageSec])

  useEffect(() => {
    utterancesRef.current = utterances
  }, [utterances])

  useEffect(() => {
    partialTranscriptRef.current = partialTranscript
  }, [partialTranscript])

  useEffect(() => {
    partialLangRef.current = partialLang
  }, [partialLang])

  const ensureSessionKey = useCallback(() => {
    if (sessionKeyRef.current) return sessionKeyRef.current
    const resolved = getOrCreateSessionKey()
    sessionKeyRef.current = resolved
    return resolved
  }, [])

  useEffect(() => {
    ensureSessionKey()
  }, [ensureSessionKey])

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
  }, [stopAudioPipeline])

  const resetToIdle = useCallback(() => {
    isStoppingRef.current = false
    hasActiveSessionRef.current = false
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
    hasFiredInitialPartialTranslateRef.current = false
    lastPartialTranslateLenRef.current = 0
    if (partialTranslateControllerRef.current) {
      partialTranslateControllerRef.current.abort()
      partialTranslateControllerRef.current = null
    }
    turnStartedAtRef.current = null
  }, [])

  const buildRecentTurnContextPayload = useCallback((excludeUtteranceId?: string): RecentTurnContextPayload[] => {
    const now = Date.now()
    const windowStart = now - RECENT_TURN_CONTEXT_WINDOW_MS
    const recentTurns: RecentTurnContextPayload[] = []

    for (const utterance of utterancesRef.current) {
      if (excludeUtteranceId && utterance.id === excludeUtteranceId) continue
      const occurredAtMs = inferUtteranceCreatedAtMs(utterance)
      if (occurredAtMs === null || occurredAtMs < windowStart || occurredAtMs > now) continue

      const sourceText = utterance.originalText.trim()
      if (!sourceText) continue

      const sourceLanguage = (utterance.originalLang || 'unknown').trim() || 'unknown'
      const translations = stripSourceLanguageFromTranslations(utterance.translations || {}, sourceLanguage)

      recentTurns.push({
        sourceLanguage,
        sourceText,
        translations,
        occurredAtMs,
        ageMs: Math.max(0, now - occurredAtMs),
      })
    }

    recentTurns.sort((a, b) => a.occurredAtMs - b.occurredAtMs)
    return recentTurns
  }, [])

  // ===== HTTP Translation via /api/translate/finalize =====
  const translateViaApi = useCallback(async (
    text: string,
    sourceLanguage: string,
    targetLanguages: string[],
    options?: {
      signal?: AbortSignal
      ttsLanguage?: string
      enableTts?: boolean
      isFinal?: boolean
      clientMessageId?: string
      currentTurnPreviousState?: CurrentTurnPreviousStatePayload | null
      excludeUtteranceId?: string
      sttDurationMs?: number
      totalDurationMs?: number
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
      hasCurrentTurnPreviousState: Boolean(options?.currentTurnPreviousState),
    })
    try {
      const body: Record<string, unknown> = { text, sourceLanguage, targetLanguages: langs }
      const recentTurns = buildRecentTurnContextPayload(options?.excludeUtteranceId)
      if (recentTurns.length > 0) {
        body.recentTurns = recentTurns
      }
      body.isFinal = options?.isFinal === true
      body.sessionKey = ensureSessionKey()
      body.clientContext = buildClientContextPayload(usageSec)
      if (options?.clientMessageId) {
        body.clientMessageId = options.clientMessageId
      }
      if (typeof options?.sttDurationMs === 'number' && Number.isFinite(options.sttDurationMs) && options.sttDurationMs >= 0) {
        body.sttDurationMs = Math.floor(options.sttDurationMs)
      }
      if (typeof options?.totalDurationMs === 'number' && Number.isFinite(options.totalDurationMs) && options.totalDurationMs >= 0) {
        body.totalDurationMs = Math.floor(options.totalDurationMs)
      }
      if (options?.currentTurnPreviousState) {
        body.currentTurnPreviousState = options.currentTurnPreviousState
      }
      const normalizedTtsLang = (options?.ttsLanguage || '').trim()
      if (normalizedTtsLang) {
        body.tts = { language: normalizedTtsLang, enabled: options?.enableTts === true }
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
        provider: typeof data.provider === 'string' ? data.provider : undefined,
        model: typeof data.model === 'string' ? data.model : undefined,
      }
    } catch {
      logTtsDebug('translate.error', { requestId })
      return { translations: {} }
    }
  }, [buildRecentTurnContextPayload, ensureSessionKey, usageSec])

  const logClientEvent = useCallback(async (payload: ClientEventLogPayload) => {
    try {
      const body: Record<string, unknown> = {
        eventType: payload.eventType,
        sessionKey: ensureSessionKey(),
        clientContext: buildClientContextPayload(usageSec),
      }

      if (payload.clientMessageId) body.clientMessageId = payload.clientMessageId
      if (payload.sourceLanguage) body.sourceLanguage = payload.sourceLanguage
      if (payload.sourceText) body.sourceText = payload.sourceText
      if (payload.translations && Object.keys(payload.translations).length > 0) {
        body.translations = payload.translations
      }
      if (typeof payload.sttDurationMs === 'number' && Number.isFinite(payload.sttDurationMs) && payload.sttDurationMs >= 0) {
        body.sttDurationMs = Math.floor(payload.sttDurationMs)
      }
      if (typeof payload.totalDurationMs === 'number' && Number.isFinite(payload.totalDurationMs) && payload.totalDurationMs >= 0) {
        body.totalDurationMs = Math.floor(payload.totalDurationMs)
      }
      if (payload.provider) body.provider = payload.provider
      if (payload.model) body.model = payload.model
      if (payload.metadata) body.metadata = payload.metadata

      await fetch('/api/log/client-event', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        keepalive: payload.keepalive === true,
      })
    } catch {
      // Logging must not affect UX.
    }
  }, [ensureSessionKey, usageSec])

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
        body: JSON.stringify({
          text: normalizedText,
          language: normalizedLang,
          sessionKey: ensureSessionKey(),
          clientContext: buildClientContextPayload(usageSec),
        }),
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
  }, [ensureSessionKey, usageSec])

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
    const text = normalizeSttTurnText(rawText)
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
    const seedTranslations = stripSourceLanguageFromTranslations(partialTranslationsRef.current, lang)
    const targetLanguages = buildTurnTargetLanguagesSnapshot(languages, lang)
    const seedFinalized: Record<string, boolean> = {}
    for (const key of Object.keys(seedTranslations)) {
      seedFinalized[key] = false
    }
    const currentTurnPreviousState = buildCurrentTurnPreviousStatePayload(
      rawLang,
      rawText,
      seedTranslations,
    )

    const utteranceId = `u-${Date.now()}-${utteranceIdRef.current}`
    setUtterances(prev => [...prev, {
      id: utteranceId,
      originalText: text,
      originalLang: lang,
      targetLanguages,
      translations: seedTranslations,
      translationFinalized: seedFinalized,
      createdAtMs: now,
    }])
    setPartialTranslations({})
    partialTranslationsRef.current = {}
    setPartialTranscript('')
    partialTranscriptRef.current = ''
    setPartialLang(null)
    partialLangRef.current = null
    pendingLocalFinalizeRef.current = { utteranceId, text, lang, expiresAt: now + 15000 }
    return { utteranceId, text, lang, currentTurnPreviousState }
  }, [languages])

  const finalizeTurnWithTranslation = useCallback((
    localFinalizeResult: LocalFinalizeResult,
    options?: {
      sttDurationMs?: number
      reason?: string
    },
  ) => {
    const { utteranceId, text, lang, currentTurnPreviousState } = localFinalizeResult
    const ttsTargetLang = languages.filter(l => l !== lang)[0] || ''
    const seq = ++translateSeqRef.current
    const requestStartedAt = Date.now()

    // Reserve a TTS queue slot before the API call so playback order matches utterance order
    if (enableTtsRef.current && ttsTargetLang) {
      onTtsRequestedRef.current?.(utteranceId, ttsTargetLang)
    }

    void translateViaApi(text, lang, languages, {
      ttsLanguage: ttsTargetLang,
      enableTts: enableTtsRef.current,
      isFinal: true,
      clientMessageId: utteranceId,
      currentTurnPreviousState,
      excludeUtteranceId: utteranceId,
      sttDurationMs: options?.sttDurationMs,
    }).then(result => {
      if (Object.keys(result.translations).length > 0) {
        applyTranslationToUtterance(utteranceId, result.translations, seq, true)
        handleInlineTtsFromTranslate(utteranceId, lang, result)
      }

      const translationLatencyMs = Math.max(0, Date.now() - requestStartedAt)
      const totalDurationMs = (options?.sttDurationMs ?? 0) + translationLatencyMs
      void logClientEvent({
        eventType: 'stt_turn_finalized',
        clientMessageId: utteranceId,
        sourceLanguage: lang,
        sourceText: text,
        translations: result.translations,
        sttDurationMs: options?.sttDurationMs,
        totalDurationMs,
        provider: result.provider,
        model: result.model,
        metadata: {
          reason: options?.reason || 'unknown',
          hasInlineTts: Boolean(result.ttsAudioBase64),
        },
        keepalive: true,
      })
    })
  }, [applyTranslationToUtterance, handleInlineTtsFromTranslate, languages, logClientEvent, translateViaApi])

  const stopRecordingGracefully = useCallback(async (notifyLimitReached = false) => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true
    const useNativeStt = useNativeSttRef.current

    stopAudioPipeline({ closeContext: false })

    const socket = socketRef.current
    const pendingText = partialTranscriptRef.current.trim()
    const pendingLang = partialLangRef.current || 'unknown'
    let localFinalizeResult: LocalFinalizeResult | null = null

    // Finalize immediately in UI.
    if (pendingText) {
      localFinalizeResult = finalizePendingLocally(pendingText, pendingLang)
    }

    if (useNativeStt) {
      nativeStopRequestedRef.current = true
      const posted = sendNativeSttCommand({
        type: 'native_stt_stop',
        payload: {
          pendingText,
          pendingLanguage: pendingLang,
        },
      })
      if (!posted) {
        nativeStopRequestedRef.current = false
      }
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
    const wasActiveSession = hasActiveSessionRef.current
    hasActiveSessionRef.current = false

    if (notifyLimitReached) {
      onLimitReachedRef.current?.()
    }

    if (wasActiveSession) {
      void logClientEvent({
        eventType: 'stt_session_stopped',
        metadata: {
          reason: notifyLimitReached ? 'usage_limit_reached' : 'manual_stop',
        },
        keepalive: true,
      })
    }

    if (localFinalizeResult) {
      const sttDurationMs = turnStartedAtRef.current ? Math.max(0, Date.now() - turnStartedAtRef.current) : undefined
      turnStartedAtRef.current = null
      finalizeTurnWithTranslation(localFinalizeResult, {
        sttDurationMs,
        reason: notifyLimitReached ? 'usage_limit_reached' : 'manual_stop',
      })
    }
  }, [finalizePendingLocally, finalizeTurnWithTranslation, logClientEvent, sendNativeSttCommand, stopAudioPipeline])

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
    const wasActiveSession = hasActiveSessionRef.current
    hasActiveSessionRef.current = false

    const remainingPartial = partialTranscriptRef.current.trim()
    if (remainingPartial) {
      const result = finalizePendingLocally(remainingPartial, partialLangRef.current || 'unknown')
      if (result) {
        const sttDurationMs = turnStartedAtRef.current ? Math.max(0, Date.now() - turnStartedAtRef.current) : undefined
        turnStartedAtRef.current = null
        finalizeTurnWithTranslation(result, {
          sttDurationMs,
          reason: 'transport_error',
        })
      }
    }

    if (wasActiveSession) {
      void logClientEvent({
        eventType: 'stt_session_stopped',
        metadata: {
          reason: 'transport_error',
          details: details || null,
        },
        keepalive: true,
      })
    }

    cleanup()
    setConnectionStatus('error')
    setTimeout(() => setConnectionStatus('idle'), 3000)
  }, [cleanup, finalizePendingLocally, finalizeTurnWithTranslation, logClientEvent])

  const handleSttTransportClose = useCallback((details?: Record<string, unknown>) => {
    logSttDebug('transport.close', details)
    const wasActiveSession = hasActiveSessionRef.current
    hasActiveSessionRef.current = false

    if (!isStoppingRef.current) {
      const remainingPartial = partialTranscriptRef.current.trim()
      if (remainingPartial) {
        const result = finalizePendingLocally(remainingPartial, partialLangRef.current || 'unknown')
        if (result) {
          const sttDurationMs = turnStartedAtRef.current ? Math.max(0, Date.now() - turnStartedAtRef.current) : undefined
          turnStartedAtRef.current = null
          finalizeTurnWithTranslation(result, {
            sttDurationMs,
            reason: 'transport_close',
          })
        }
      }
    }

    if (wasActiveSession) {
      void logClientEvent({
        eventType: 'stt_session_stopped',
        metadata: {
          reason: isStoppingRef.current ? 'stt_stop_close' : 'transport_close',
          details: details || null,
        },
        keepalive: true,
      })
    }

    resetToIdle()
  }, [finalizePendingLocally, finalizeTurnWithTranslation, logClientEvent, resetToIdle])

  const handleSttServerMessage = useCallback((message: Record<string, unknown>) => {
    if (message.status === 'ready') {
      logSttDebug('transport.ready')
      setConnectionStatus('ready')
      lastAudioChunkAtRef.current = Date.now()
      if (!hasActiveSessionRef.current) {
        hasActiveSessionRef.current = true
        void logClientEvent({
          eventType: 'stt_session_started',
        })
      }
      if (!useNativeSttRef.current) {
        startAudioProcessing()
      } else {
        setVolume(0)
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
      const text = normalizeSttTurnText(rawText)
      const lang = typeof utterance.language === 'string' ? utterance.language : 'unknown'
      const isFinal = data.is_final === true

      if (isStoppingRef.current && !isFinal) {
        return
      }

      if (isFinal) {
        // Ignore non-meaningful turns (only "." / spaces) entirely.
        // No bubble, translation, or TTS should be produced.
        if (!text) {
          clearPartialBuffers()
          return
        }
        const sig = `${lang}::${text}`
        const now = Date.now()
        const sttDurationMs = turnStartedAtRef.current ? Math.max(0, now - turnStartedAtRef.current) : undefined
        turnStartedAtRef.current = null
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
        const seedTranslations = stripSourceLanguageFromTranslations(partialTranslationsRef.current, lang)
        const targetLanguages = buildTurnTargetLanguagesSnapshot(languages, lang)
        const seedFinalized: Record<string, boolean> = {}
        for (const key of Object.keys(seedTranslations)) {
          seedFinalized[key] = false
        }
        const currentTurnPreviousState = buildCurrentTurnPreviousStatePayload(
          partialLangRef.current || lang,
          partialTranscriptRef.current || text,
          seedTranslations,
        )
        const newUtteranceId = `u-${Date.now()}-${utteranceIdRef.current}`
        const newUtterance: Utterance = {
          id: newUtteranceId,
          originalText: text,
          originalLang: lang,
          targetLanguages,
          translations: seedTranslations,
          translationFinalized: seedFinalized,
          createdAtMs: now,
        }
        setUtterances(u => [...u, newUtterance])
        clearPartialBuffers()
        pendingLocalFinalizeRef.current = null

        finalizeTurnWithTranslation(
          {
            utteranceId: newUtteranceId,
            text,
            lang,
            currentTurnPreviousState,
          },
          {
            sttDurationMs,
            reason: 'stt_server_final',
          },
        )
      } else {
        if (!turnStartedAtRef.current && text) {
          turnStartedAtRef.current = Date.now()
          void logClientEvent({
            eventType: 'stt_turn_started',
            sourceLanguage: lang,
            sourceText: text,
          })
        }
        setPartialTranscript(text)
        partialTranscriptRef.current = text
        setPartialLang(lang)
        partialLangRef.current = lang
      }
    }
  }, [clearPartialBuffers, finalizeTurnWithTranslation, languages, logClientEvent, normalizedUsageLimitSec, startAudioProcessing, stopRecordingGracefully])

  const startRecording = useCallback(async () => {
    if (isStoppingRef.current) return
    const useNativeStt = shouldUseNativeSttBridge()
    useNativeSttRef.current = useNativeStt
    logSttDebug('recording.start.request', {
      useNativeStt,
      wsUrl: getWsUrl(),
      languagesCount: languages.length,
    })
    if (!useNativeStt && (
      socketRef.current
      && (socketRef.current.readyState === WebSocket.OPEN || socketRef.current.readyState === WebSocket.CONNECTING)
    )) {
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
      turnStartedAtRef.current = null
      hasActiveSessionRef.current = false
      setPartialTranscript('')
      setPartialTranslations({})
      partialTranslationsRef.current = {}
      setPartialLang(null)
      nativeStopRequestedRef.current = false

      if (useNativeStt) {
        logSttDebug('native.start.begin')
        const posted = sendNativeSttCommand({
          type: 'native_stt_start',
          payload: {
            wsUrl: getWsUrl(),
            languages,
            sttModel: 'soniox',
            langHintsStrict: true,
            aecEnabled: enableAec,
          },
        })
        if (!posted) {
          throw new Error('native_stt_bridge_unavailable')
        }
        return
      }

      logSttDebug('web.start.begin')
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: enableAec,
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
      cleanup()
      setConnectionStatus('error')
      setTimeout(() => setConnectionStatus('idle'), 3000)
    }
  }, [cleanup, enableAec, handleSttServerMessage, handleSttTransportClose, handleSttTransportError, languages, normalizedUsageLimitSec, sendNativeSttCommand, usageSec])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (!shouldUseNativeSttBridge()) return
    useNativeSttRef.current = true

    const handleNativeEvent = (event: Event) => {
      const detail = (event as CustomEvent<NativeSttBridgeEvent>).detail
      if (!detail || typeof detail !== 'object') return

      if (detail.type === 'status') {
        logSttDebug('native.status', { status: detail.status })
        if (detail.status === 'connecting') {
          setConnectionStatus('connecting')
        } else if (detail.status === 'stopped') {
          setConnectionStatus('idle')
        }
        return
      }

      if (detail.type === 'message') {
        try {
          const message = JSON.parse(detail.raw) as Record<string, unknown>
          handleSttServerMessage(message)
        } catch {
          // ignore malformed payload
        }
        return
      }

      if (detail.type === 'error') {
        logSttDebug('native.error', { message: detail.message })
        if (nativeStopRequestedRef.current) return
        handleSttTransportError({ native: true, message: detail.message })
        return
      }

      if (detail.type === 'close') {
        logSttDebug('native.close', { reason: detail.reason })
        if (nativeStopRequestedRef.current) {
          nativeStopRequestedRef.current = false
          setConnectionStatus('idle')
          return
        }
        handleSttTransportClose({ native: true, reason: detail.reason })
      }
    }

    window.addEventListener(NATIVE_STT_EVENT, handleNativeEvent as EventListener)
    return () => {
      window.removeEventListener(NATIVE_STT_EVENT, handleNativeEvent as EventListener)
    }
  }, [handleSttServerMessage, handleSttTransportClose, handleSttTransportError])

  const recoverFromBackgroundIfNeeded = useCallback(async () => {
    if (useNativeSttRef.current) return
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

  // ===== Partial translation: fire once immediately, then every 10-char threshold =====
  const PARTIAL_TRANSLATE_STEP = 10
  useEffect(() => {
    const trimmed = partialTranscript.trim()
    const len = trimmed.length
    if (len === 0 || languages.length === 0 || connectionStatus !== 'ready') return
    if (!hasFiredInitialPartialTranslateRef.current) {
      hasFiredInitialPartialTranslateRef.current = true
      // Prime the threshold tracker based on the first partial length so
      // the next request is triggered at the next 10-char boundary.
      lastPartialTranslateLenRef.current = Math.floor(len / PARTIAL_TRANSLATE_STEP) * PARTIAL_TRANSLATE_STEP
    } else {
      const nextThreshold = lastPartialTranslateLenRef.current + PARTIAL_TRANSLATE_STEP
      if (len < nextThreshold) return
      lastPartialTranslateLenRef.current = Math.floor(len / PARTIAL_TRANSLATE_STEP) * PARTIAL_TRANSLATE_STEP
    }

    // Capture the utterance counter at request time so we can discard stale responses
    // that arrive after a new utterance has started (prevents cross-utterance contamination).
    const requestUtteranceId = utteranceIdRef.current
    const currentLang = partialLangRef.current || 'unknown'
    translateViaApi(trimmed, currentLang, languages)
      .then(result => {
        // Discard if a new utterance has started since this request was fired.
        if (utteranceIdRef.current !== requestUtteranceId) return
        const filteredExisting = stripSourceLanguageFromTranslations(partialTranslationsRef.current, currentLang)
        const filteredNew = stripSourceLanguageFromTranslations(result.translations, currentLang)
        const nextTranslations = { ...filteredExisting, ...filteredNew }
        partialTranslationsRef.current = nextTranslations
        setPartialTranslations(nextTranslations)
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
    loadOlderUtterances,
    hasOlderUtterances,
  }
}

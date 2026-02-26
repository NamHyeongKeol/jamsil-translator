'use client'

import { useState, useRef, useEffect, useCallback, useMemo } from 'react'
import type { Utterance } from './ChatBubble'
import { buildClientApiPath } from '@/lib/api-contract'

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT || '3001'
export const getWsUrl = (): string => {
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
    pendingTurns?: Array<{
      speaker: string
      text: string
      language: string
    }>
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
    if (!value) return true
    if (value === '0' || value === 'false' || value === 'off') return false
    if (value === '1' || value === 'true' || value === 'on') return true
    return true
  } catch {
    return true
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

export function normalizeSttTurnText(rawText: string): string {
  // Strip endpoint markers at the client boundary so downstream paths
  // (bubble/render/log/translate) all operate on marker-free text.
  return rawText
    .replace(/<\/?(?:end|fin)>/giu, '')
    .replace(/^[\s.,!?;:，。、…—–-]+/u, '')
    .trim()
}

export function normalizeLangForCompare(rawLanguage: string): string {
  return (rawLanguage || '').trim().replace('_', '-').toLowerCase().split('-')[0] || ''
}

function normalizeSpeakerId(rawSpeaker: unknown): string | null {
  if (typeof rawSpeaker !== 'string') return null
  const speaker = rawSpeaker.trim().toLowerCase()
  if (!speaker) return null

  const numeric = /^(\d+)$/.exec(speaker)
  if (numeric) return `speaker_${numeric[1]}`

  const speakerWithNumber = /^speaker(?:[_\s-]+)?(\d+)$/.exec(speaker)
  if (speakerWithNumber) return `speaker_${speakerWithNumber[1]}`

  const sanitized = speaker.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!sanitized) return null
  if (sanitized.startsWith('speaker_')) return sanitized
  if (sanitized === 'speaker') return null
  return `speaker_${sanitized}`
}

export function stripSourceLanguageFromTranslations(
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

export function buildTurnTargetLanguagesSnapshot(
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

export interface CurrentTurnPreviousStatePayload {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
}

export function buildCurrentTurnPreviousStatePayload(
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

export interface ParsedSttTranscriptMessage {
  rawText: string
  text: string
  language: string
  speaker?: string
  isFinal: boolean
}

export function parseSttTranscriptMessage(
  message: Record<string, unknown>,
): ParsedSttTranscriptMessage | null {
  if (message.type !== 'transcript') return null
  if (typeof message.data !== 'object' || message.data === null) return null

  const data = message.data as Record<string, unknown>
  if (typeof data.utterance !== 'object' || data.utterance === null) return null

  const utterance = data.utterance as Record<string, unknown>
  const rawText = typeof utterance.text === 'string' ? utterance.text : ''
  const text = normalizeSttTurnText(rawText)
  const language = typeof utterance.language === 'string' ? utterance.language : 'unknown'
  const speaker = normalizeSpeakerId(utterance.speaker ?? data.speaker)
  const isFinal = data.is_final === true

  const parsed: ParsedSttTranscriptMessage = {
    rawText,
    text,
    language,
    isFinal,
  }
  if (speaker) parsed.speaker = speaker
  return parsed
}

export interface BuildFinalizedUtterancePayloadInput {
  rawText: string
  rawLanguage: string
  rawSpeaker?: string
  languages: string[]
  partialTranslations: Record<string, string>
  utteranceSerial: number
  nowMs?: number
  previousStateSourceLanguage?: string
  previousStateSourceText?: string
}

export interface BuildFinalizedUtterancePayloadResult {
  utteranceId: string
  text: string
  language: string
  speaker?: string
  createdAtMs: number
  utterance: Utterance
  currentTurnPreviousState: CurrentTurnPreviousStatePayload | null
}

export function buildFinalizedUtterancePayload(
  input: BuildFinalizedUtterancePayloadInput,
): BuildFinalizedUtterancePayloadResult | null {
  const text = normalizeSttTurnText(input.rawText)
  const language = (input.rawLanguage || 'unknown').trim() || 'unknown'
  const speaker = normalizeSpeakerId(input.rawSpeaker)
  if (!text) return null

  const createdAtMs = typeof input.nowMs === 'number' && Number.isFinite(input.nowMs)
    ? Math.floor(input.nowMs)
    : Date.now()

  const seedTranslations = stripSourceLanguageFromTranslations(input.partialTranslations, language)
  const targetLanguages = buildTurnTargetLanguagesSnapshot(input.languages, language)
  const translationFinalized: Record<string, boolean> = {}
  for (const key of Object.keys(seedTranslations)) {
    translationFinalized[key] = false
  }

  const currentTurnPreviousState = buildCurrentTurnPreviousStatePayload(
    input.previousStateSourceLanguage ?? input.rawLanguage,
    input.previousStateSourceText ?? input.rawText,
    seedTranslations,
  )

  const utteranceId = `u-${createdAtMs}-${input.utteranceSerial}`
  const utterance: Utterance = {
    id: utteranceId,
    originalText: text,
    originalLang: language,
    targetLanguages,
    translations: seedTranslations,
    translationFinalized,
    createdAtMs,
  }
  if (speaker) {
    utterance.speaker = speaker
  }

  return {
    utteranceId,
    text,
    language,
    speaker: speaker || undefined,
    createdAtMs,
    utterance,
    currentTurnPreviousState,
  }
}

interface UseRealtimeSTTOptions {
  languages: string[]
  onLimitReached?: () => void
  onTtsRequested?: (utteranceId: string, language: string) => void
  onTtsAudio?: (utteranceId: string, audioBlob: Blob, language: string, ttsText?: string) => void
  enableTts?: boolean
  enableAec?: boolean
  usageLimitSec?: number | null
}

interface LocalFinalizeResult {
  utteranceId: string
  text: string
  lang: string
  speaker: string
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

interface PartialTurn {
  speaker: string
  text: string
  language: string
  translations: Record<string, string>
  updatedAtMs: number
}

interface PartialTurnMeta {
  hasFiredInitialPartialTranslate: boolean
  lastPartialTranslateLen: number
  controller: AbortController | null
  lastTranslationState: CurrentTurnPreviousStatePayload | null
  turnStartedAtMs: number | null
  turnVersion: number
}

interface RecentTurnContextPayload {
  sourceLanguage: string
  sourceText: string
  translations: Record<string, string>
  occurredAtMs: number
  ageMs: number
  isFinalized: boolean
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
  const [partialTurnsState, setPartialTurnsState] = useState<Record<string, PartialTurn>>({})
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

  const partialTurnsRef = useRef<Record<string, PartialTurn>>({})
  const partialTurnMetaRef = useRef<Record<string, PartialTurnMeta>>({})
  const isStoppingRef = useRef(false)
  const onTtsRequestedRef = useRef(onTtsRequested)
  onTtsRequestedRef.current = onTtsRequested
  const onTtsAudioRef = useRef(onTtsAudio)
  onTtsAudioRef.current = onTtsAudio
  const enableTtsRef = useRef(enableTts)
  enableTtsRef.current = enableTts
  const stopFinalizeDedupRef = useRef<Map<string, number>>(new Map())

  const finalizedTtsSignatureRef = useRef<Map<string, string>>(new Map())
  // Monotonically increasing sequence number for translation requests.
  // Responses with a seq lower than the latest applied seq are discarded,
  // preventing old (slow) translations from overwriting newer ones.
  const translateSeqRef = useRef(0)
  const lastAppliedSeqRef = useRef<Map<string, number>>(new Map()) // utteranceId -> last applied seq
  const sessionKeyRef = useRef('')

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
    partialTurnsRef.current = partialTurnsState
  }, [partialTurnsState])

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

  const getPartialTurnMeta = useCallback((speaker: string): PartialTurnMeta => {
    const existing = partialTurnMetaRef.current[speaker]
    if (existing) return existing
    const created: PartialTurnMeta = {
      hasFiredInitialPartialTranslate: false,
      lastPartialTranslateLen: 0,
      controller: null,
      lastTranslationState: null,
      turnStartedAtMs: null,
      turnVersion: 0,
    }
    partialTurnMetaRef.current[speaker] = created
    return created
  }, [])

  const clearPartialTurnMeta = useCallback((speaker: string, incrementTurnVersion = false) => {
    const existing = partialTurnMetaRef.current[speaker]
    const nextTurnVersion = ((existing?.turnVersion || 0) + 1)
    if (existing?.controller) {
      existing.controller.abort()
    }
    if (incrementTurnVersion || existing) {
      partialTurnMetaRef.current[speaker] = {
        hasFiredInitialPartialTranslate: false,
        lastPartialTranslateLen: 0,
        controller: null,
        lastTranslationState: null,
        turnStartedAtMs: null,
        turnVersion: incrementTurnVersion ? nextTurnVersion : (existing?.turnVersion || 0),
      }
      return
    }
    delete partialTurnMetaRef.current[speaker]
  }, [])

  const upsertPartialTurn = useCallback((speaker: string, patch: Omit<PartialTurn, 'speaker' | 'updatedAtMs'> & { updatedAtMs?: number }) => {
    const normalizedSpeaker = normalizeSpeakerId(speaker) || 'speaker_unknown'
    setPartialTurnsState((prev) => {
      const prevTurn = prev[normalizedSpeaker]
      const nextUpdatedAtMs = typeof patch.updatedAtMs === 'number'
        ? patch.updatedAtMs
        : (prevTurn && prevTurn.text === patch.text && prevTurn.language === patch.language
          ? prevTurn.updatedAtMs
          : Date.now())
      const next: PartialTurn = {
        speaker: normalizedSpeaker,
        text: patch.text,
        language: patch.language,
        translations: patch.translations,
        updatedAtMs: nextUpdatedAtMs,
      }
      if (
        prevTurn
        && prevTurn.text === next.text
        && prevTurn.language === next.language
        && prevTurn.updatedAtMs === next.updatedAtMs
      ) {
        let translationsChanged = false
        const prevKeys = Object.keys(prevTurn.translations)
        const nextKeys = Object.keys(next.translations)
        if (prevKeys.length !== nextKeys.length) {
          translationsChanged = true
        } else {
          for (const key of nextKeys) {
            if (prevTurn.translations[key] !== next.translations[key]) {
              translationsChanged = true
              break
            }
          }
        }
        if (!translationsChanged) return prev
      }
      return { ...prev, [normalizedSpeaker]: next }
    })
  }, [])

  const clearSinglePartialTurn = useCallback((speaker: string, incrementTurnVersion = true) => {
    const normalizedSpeaker = normalizeSpeakerId(speaker) || 'speaker_unknown'
    setPartialTurnsState((prev) => {
      if (!prev[normalizedSpeaker]) return prev
      const next = { ...prev }
      delete next[normalizedSpeaker]
      return next
    })
    clearPartialTurnMeta(normalizedSpeaker, incrementTurnVersion)
  }, [clearPartialTurnMeta])

  const clearPartialBuffers = useCallback(() => {
    const speakers = Object.keys(partialTurnsRef.current)
    for (const speaker of speakers) {
      clearPartialTurnMeta(speaker, true)
    }
    setPartialTurnsState({})
  }, [clearPartialTurnMeta])

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
      const translationLanguages = Object.keys(translations)
      const isFinalized = (
        translationLanguages.length > 0
        && translationLanguages.every((language) => utterance.translationFinalized?.[language] === true)
      )

      recentTurns.push({
        sourceLanguage,
        sourceText,
        translations,
        occurredAtMs,
        ageMs: Math.max(0, now - occurredAtMs),
        isFinalized,
      })
    }

    recentTurns.sort((a, b) => a.occurredAtMs - b.occurredAtMs)
    return recentTurns
  }, [])

  // ===== HTTP Translation via versioned API namespace =====
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
    const recentTurns = buildRecentTurnContextPayload(options?.excludeUtteranceId)
    try {
      const body: Record<string, unknown> = { text, sourceLanguage, targetLanguages: langs }
      if (recentTurns.length > 0) {
        body.recentTurns = recentTurns
        body.immediatePreviousTurn = recentTurns[recentTurns.length - 1]
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
      const res = await fetch(buildClientApiPath('/translate/finalize'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: options?.signal,
      })
      if (!res.ok) {
        return { translations: {} }
      }
      const data = await res.json()
      const ttsAudioBase64 = typeof data.ttsAudioBase64 === 'string' ? data.ttsAudioBase64 : undefined
      return {
        translations: (data.translations || {}) as Record<string, string>,
        ttsLanguage: typeof data.ttsLanguage === 'string' ? data.ttsLanguage : undefined,
        ttsAudioBase64,
        ttsAudioMime: typeof data.ttsAudioMime === 'string' ? data.ttsAudioMime : undefined,
        provider: typeof data.provider === 'string' ? data.provider : undefined,
        model: typeof data.model === 'string' ? data.model : undefined,
      }
    } catch {
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

      await fetch(buildClientApiPath('/log/client-event'), {
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
    try {
      const res = await fetch(buildClientApiPath('/tts/inworld'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: normalizedText,
          language: normalizedLang,
          sessionKey: ensureSessionKey(),
          clientContext: buildClientContextPayload(usageSec),
        }),
      })
      if (!res.ok) return null
      const arrayBuffer = await res.arrayBuffer()
      if (!arrayBuffer || arrayBuffer.byteLength === 0) return null
      const mime = res.headers.get('content-type') || 'audio/mpeg'
      return new Blob([arrayBuffer], { type: mime })
    } catch {
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

    const queueAudioIfValid = (audioBlob: Blob | null): boolean => {
      if (!audioBlob || audioBlob.size === 0) return false
      if (finalizedTtsSignatureRef.current.get(utteranceId) === signature) {
        // 이미 같은 시그니처로 큐잉됨 — 중복 차단
        return true
      }
      finalizedTtsSignatureRef.current.set(utteranceId, signature)
      onTtsAudioRef.current?.(utteranceId, audioBlob, ttsTargetLang, ttsText)
      return true
    }

    if (result.ttsAudioBase64) {
      const audioBlob = decodeBase64AudioToBlob(result.ttsAudioBase64, result.ttsAudioMime || 'audio/mpeg')
      if (queueAudioIfValid(audioBlob)) return
    }

    // Inline TTS가 없거나 유효하지 않음 → 별도 TTS API 호출로 폴백
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
  const finalizePendingLocally = useCallback((
    speakerRaw: string,
    rawText: string,
    rawLang: string,
  ): LocalFinalizeResult | null => {
    const speaker = normalizeSpeakerId(speakerRaw) || 'speaker_unknown'
    const partialTurn = partialTurnsRef.current[speaker]
    const text = normalizeSttTurnText(rawText)
    const lang = (rawLang || partialTurn?.language || 'unknown').trim() || 'unknown'
    if (!text) {
      clearSinglePartialTurn(speaker, true)
      return null
    }

    const now = Date.now()
    for (const [sigKey, expiresAt] of stopFinalizeDedupRef.current.entries()) {
      if (now >= expiresAt) {
        stopFinalizeDedupRef.current.delete(sigKey)
      }
    }

    const sig = `${lang}::${speaker}::${text}`
    const expiresAt = stopFinalizeDedupRef.current.get(sig)
    if (typeof expiresAt === 'number' && now < expiresAt) {
      clearSinglePartialTurn(speaker, true)
      return null
    }
    stopFinalizeDedupRef.current.set(sig, now + 5000)

    utteranceIdRef.current += 1
    const localPayload = buildFinalizedUtterancePayload({
      rawText,
      rawLanguage: lang,
      rawSpeaker: speaker,
      languages,
      partialTranslations: partialTurn?.translations || {},
      utteranceSerial: utteranceIdRef.current,
      nowMs: now,
      previousStateSourceLanguage: partialTurn?.language || lang,
      previousStateSourceText: partialTurn?.text || rawText,
    })
    if (!localPayload) {
      clearSinglePartialTurn(speaker, true)
      return null
    }

    const partialMeta = getPartialTurnMeta(speaker)
    const fallbackCurrentTurnPreviousState = (
      partialMeta.lastTranslationState
      && normalizeLangForCompare(partialMeta.lastTranslationState.sourceLanguage) === normalizeLangForCompare(lang)
    ) ? partialMeta.lastTranslationState : null
    const currentTurnPreviousState = (
      localPayload.currentTurnPreviousState
      && Object.keys(localPayload.currentTurnPreviousState.translations).length > 0
    ) ? localPayload.currentTurnPreviousState : (fallbackCurrentTurnPreviousState || localPayload.currentTurnPreviousState)

    setUtterances(prev => [...prev, localPayload.utterance])
    clearSinglePartialTurn(speaker, true)

    return {
      utteranceId: localPayload.utteranceId,
      text: localPayload.text,
      lang: localPayload.language,
      speaker,
      currentTurnPreviousState,
    }
  }, [clearSinglePartialTurn, getPartialTurnMeta, languages])

  const finalizeTurnWithTranslation = useCallback((
    localFinalizeResult: LocalFinalizeResult,
    options?: {
      sttDurationMs?: number
      reason?: string
    },
  ) => {
    const { utteranceId, text, lang, speaker, currentTurnPreviousState } = localFinalizeResult
    const seq = ++translateSeqRef.current
    const requestStartedAt = Date.now()

    // 단일 언어 모드: 선택 언어가 1개인 경우
    const isSingleLanguageMode = languages.length === 1
    const detectedLangNorm = normalizeLangForCompare(lang)
    const selectedLangNorm = normalizeLangForCompare(languages[0] || '')

    if (isSingleLanguageMode && detectedLangNorm === selectedLangNorm) {
      // 감지 언어 = 선택 언어 → 번역/TTS 없이 transcript만 (로깅만)
      void logClientEvent({
        eventType: 'stt_turn_finalized',
        clientMessageId: utteranceId,
        sourceLanguage: lang,
        sourceText: text,
        translations: {},
        sttDurationMs: options?.sttDurationMs,
        totalDurationMs: options?.sttDurationMs ?? 0,
        metadata: {
          reason: options?.reason || 'unknown',
          singleLanguageMode: true,
          skipTranslation: true,
          speaker,
        },
        keepalive: true,
      })
      return
    }

    // 단일 언어 모드이지만 다른 언어 감지: 선택 언어로 번역 + TTS
    // 다중 언어 모드: 기존 동작 유지
    const ttsTargetLang = isSingleLanguageMode
      ? (languages[0] || '')
      : (languages.filter(l => l !== lang)[0] || '')
    const effectiveTargetLanguages = isSingleLanguageMode
      ? languages                  // [selectedLang] — translateViaApi 내부에서 sourceLanguage(detected) 제거 후 번역
      : languages

    // Reserve a TTS queue slot before the API call so playback order matches utterance order
    if (enableTtsRef.current && ttsTargetLang) {
      onTtsRequestedRef.current?.(utteranceId, ttsTargetLang)
    }

    void translateViaApi(text, lang, effectiveTargetLanguages, {
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
          singleLanguageMode: isSingleLanguageMode,
          speaker,
        },
        keepalive: true,
      })
    })
  }, [applyTranslationToUtterance, handleInlineTtsFromTranslate, languages, logClientEvent, translateViaApi])

  const finalizeAllPendingLocally = useCallback(() => {
    const finalizedResults: Array<{ result: LocalFinalizeResult; sttDurationMs?: number }> = []
    const pendingTurnsPayload: Array<{ speaker: string; text: string; language: string }> = []
    for (const partialTurn of Object.values(partialTurnsRef.current)) {
      const normalizedText = normalizeSttTurnText(partialTurn.text)
      if (!normalizedText) continue
      pendingTurnsPayload.push({
        speaker: partialTurn.speaker,
        text: normalizedText,
        language: partialTurn.language || 'unknown',
      })

      const partialMeta = getPartialTurnMeta(partialTurn.speaker)
      const result = finalizePendingLocally(partialTurn.speaker, partialTurn.text, partialTurn.language || 'unknown')
      if (!result) continue
      const sttDurationMs = partialMeta.turnStartedAtMs
        ? Math.max(0, Date.now() - partialMeta.turnStartedAtMs)
        : undefined
      finalizedResults.push({ result, sttDurationMs })
    }
    return { finalizedResults, pendingTurnsPayload }
  }, [finalizePendingLocally, getPartialTurnMeta])

  const stopRecordingGracefully = useCallback(async (notifyLimitReached = false) => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true
    const useNativeStt = useNativeSttRef.current

    stopAudioPipeline({ closeContext: false })

    const socket = socketRef.current
    const {
      finalizedResults,
      pendingTurnsPayload,
    } = finalizeAllPendingLocally()
    const legacyPending = pendingTurnsPayload[0] || null

    if (useNativeStt) {
      nativeStopRequestedRef.current = true
      const posted = sendNativeSttCommand({
        type: 'native_stt_stop',
        payload: {
          pendingText: legacyPending?.text || '',
          pendingLanguage: legacyPending?.language || 'unknown',
          pendingTurns: pendingTurnsPayload,
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
              pending_text: legacyPending?.text || '',
              pending_language: legacyPending?.language || 'unknown',
              pending_turns: pendingTurnsPayload,
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

    for (const finalized of finalizedResults) {
      finalizeTurnWithTranslation(finalized.result, {
        sttDurationMs: finalized.sttDurationMs,
        reason: notifyLimitReached ? 'usage_limit_reached' : 'manual_stop',
      })
    }
  }, [finalizeAllPendingLocally, finalizeTurnWithTranslation, logClientEvent, sendNativeSttCommand, stopAudioPipeline])

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
    console.error('[MingleSTT] transport.error', details || {})
    const wasActiveSession = hasActiveSessionRef.current
    hasActiveSessionRef.current = false

    const { finalizedResults } = finalizeAllPendingLocally()
    for (const finalized of finalizedResults) {
      finalizeTurnWithTranslation(finalized.result, {
        sttDurationMs: finalized.sttDurationMs,
        reason: 'transport_error',
      })
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
  }, [cleanup, finalizeAllPendingLocally, finalizeTurnWithTranslation, logClientEvent])

  const handleSttTransportClose = useCallback((details?: Record<string, unknown>) => {
    logSttDebug('transport.close', details)
    console.warn('[MingleSTT] transport.close', details || {})
    const wasActiveSession = hasActiveSessionRef.current
    hasActiveSessionRef.current = false

    if (!isStoppingRef.current) {
      const { finalizedResults } = finalizeAllPendingLocally()
      for (const finalized of finalizedResults) {
        finalizeTurnWithTranslation(finalized.result, {
          sttDurationMs: finalized.sttDurationMs,
          reason: 'transport_close',
        })
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
  }, [finalizeAllPendingLocally, finalizeTurnWithTranslation, logClientEvent, resetToIdle])

  const resolveSpeakerForTranscript = useCallback((rawSpeaker?: string, rawText?: string): string => {
    const normalizedSpeaker = normalizeSpeakerId(rawSpeaker)
    if (normalizedSpeaker) return normalizedSpeaker

    const speakers = Object.keys(partialTurnsRef.current)
    if (speakers.length === 1) return speakers[0]

    const normalizedText = normalizeSttTurnText(rawText || '')
    if (normalizedText) {
      for (const speaker of speakers) {
        const partialTurn = partialTurnsRef.current[speaker]
        if (!partialTurn) continue
        const partialText = normalizeSttTurnText(partialTurn.text)
        if (!partialText) continue
        if (partialText === normalizedText) return speaker
        if (normalizedText.endsWith(partialText)) return speaker
        if (partialText.endsWith(normalizedText)) return speaker
      }
    }

    return 'speaker_unknown'
  }, [])

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

    const transcript = parseSttTranscriptMessage(message)
    if (transcript) {
      const { rawText, text, language: lang, speaker, isFinal } = transcript
      const speakerKey = resolveSpeakerForTranscript(speaker, text)

      if (isStoppingRef.current && !isFinal) {
        return
      }

      if (isFinal) {
        // Ignore non-meaningful turns (only "." / spaces) entirely.
        // No bubble, translation, or TTS should be produced.
        if (!text) {
          clearSinglePartialTurn(speakerKey, true)
          return
        }
        const sig = `${lang}::${speakerKey}::${text}`
        const now = Date.now()
        for (const [dedupSig, expiresAt] of stopFinalizeDedupRef.current.entries()) {
          if (now >= expiresAt) stopFinalizeDedupRef.current.delete(dedupSig)
        }
        const dedupExpiresAt = stopFinalizeDedupRef.current.get(sig)
        if (typeof dedupExpiresAt === 'number' && now < dedupExpiresAt) {
          stopFinalizeDedupRef.current.delete(sig)
          return
        }
        stopFinalizeDedupRef.current.delete(sig)

        const partialTurn = partialTurnsRef.current[speakerKey]
        const partialMeta = getPartialTurnMeta(speakerKey)
        const sttDurationMs = partialMeta.turnStartedAtMs
          ? Math.max(0, now - partialMeta.turnStartedAtMs)
          : undefined
        partialMeta.turnStartedAtMs = null

        utteranceIdRef.current += 1
        const finalizedPayload = buildFinalizedUtterancePayload({
          rawText,
          rawLanguage: lang,
          rawSpeaker: speakerKey,
          languages,
          partialTranslations: partialTurn?.translations || {},
          utteranceSerial: utteranceIdRef.current,
          nowMs: now,
          previousStateSourceLanguage: partialTurn?.language || lang,
          previousStateSourceText: partialTurn?.text || text,
        })
        if (!finalizedPayload) {
          clearSinglePartialTurn(speakerKey, true)
          return
        }
        const fallbackCurrentTurnPreviousState = (
          partialMeta.lastTranslationState
          && normalizeLangForCompare(partialMeta.lastTranslationState.sourceLanguage) === normalizeLangForCompare(finalizedPayload.language)
        ) ? partialMeta.lastTranslationState : null
        const currentTurnPreviousState = (
          finalizedPayload.currentTurnPreviousState
          && Object.keys(finalizedPayload.currentTurnPreviousState.translations).length > 0
        ) ? finalizedPayload.currentTurnPreviousState : (fallbackCurrentTurnPreviousState || finalizedPayload.currentTurnPreviousState)
        setUtterances(u => [...u, finalizedPayload.utterance])
        clearSinglePartialTurn(speakerKey, true)

        finalizeTurnWithTranslation(
          {
            utteranceId: finalizedPayload.utteranceId,
            text: finalizedPayload.text,
            lang: finalizedPayload.language,
            speaker: speakerKey,
            currentTurnPreviousState,
          },
          {
            sttDurationMs,
            reason: 'stt_server_final',
          },
        )
      } else {
        const partialMeta = getPartialTurnMeta(speakerKey)
        if (!partialMeta.turnStartedAtMs && text) {
          partialMeta.turnStartedAtMs = Date.now()
          void logClientEvent({
            eventType: 'stt_turn_started',
            sourceLanguage: lang,
            sourceText: text,
            metadata: {
              speaker: speakerKey,
            },
          })
        }
        const previousTurn = partialTurnsRef.current[speakerKey]
        upsertPartialTurn(speakerKey, {
          text,
          language: lang,
          translations: previousTurn?.translations || {},
        })
      }
    }
  }, [
    clearSinglePartialTurn,
    finalizeTurnWithTranslation,
    getPartialTurnMeta,
    languages,
    logClientEvent,
    normalizedUsageLimitSec,
    resolveSpeakerForTranscript,
    startAudioProcessing,
    stopRecordingGracefully,
    upsertPartialTurn,
  ])

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
      stopFinalizeDedupRef.current.clear()
      hasActiveSessionRef.current = false
      clearPartialBuffers()
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
      if (typeof window !== 'undefined' && !window.isSecureContext) {
        throw new Error('secure_context_required_for_microphone')
      }
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== 'function') {
        throw new Error('media_devices_api_unavailable')
      }
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
          const rawMessage = typeof event.data === 'string' ? event.data : String(event.data)
          const message = JSON.parse(rawMessage) as Record<string, unknown>
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
      console.error('[MingleSTT] recording.start.failed', {
        native: useNativeStt,
        message: error instanceof Error ? error.message : String(error),
        name: error instanceof Error ? error.name : 'unknown',
        wsUrl: getWsUrl(),
        origin: typeof window !== 'undefined' ? window.location.origin : null,
        isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : null,
      })
      cleanup()
      setConnectionStatus('error')
      setTimeout(() => setConnectionStatus('idle'), 3000)
    }
  }, [cleanup, clearPartialBuffers, enableAec, handleSttServerMessage, handleSttTransportClose, handleSttTransportError, languages, normalizedUsageLimitSec, sendNativeSttCommand, usageSec])

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
    if (languages.length === 0 || connectionStatus !== 'ready') return
    for (const partialTurn of Object.values(partialTurnsState)) {
      const trimmed = partialTurn.text.trim()
      const len = trimmed.length
      if (len === 0) continue
      const currentLang = partialTurn.language || 'unknown'

      // 단일 언어 모드: 감지 언어가 선택 언어와 동일하면 부분 번역 스킵
      if (
        languages.length === 1
        && normalizeLangForCompare(currentLang) === normalizeLangForCompare(languages[0] || '')
      ) continue

      const partialMeta = getPartialTurnMeta(partialTurn.speaker)
      if (!partialMeta.hasFiredInitialPartialTranslate) {
        partialMeta.hasFiredInitialPartialTranslate = true
        partialMeta.lastPartialTranslateLen = Math.floor(len / PARTIAL_TRANSLATE_STEP) * PARTIAL_TRANSLATE_STEP
      } else {
        const nextThreshold = partialMeta.lastPartialTranslateLen + PARTIAL_TRANSLATE_STEP
        if (len < nextThreshold) continue
        partialMeta.lastPartialTranslateLen = Math.floor(len / PARTIAL_TRANSLATE_STEP) * PARTIAL_TRANSLATE_STEP
      }

      if (partialMeta.controller) {
        partialMeta.controller.abort()
      }
      const controller = new AbortController()
      partialMeta.controller = controller
      const requestTurnVersion = partialMeta.turnVersion
      const speaker = partialTurn.speaker

      translateViaApi(trimmed, currentLang, languages, {
        signal: controller.signal,
        currentTurnPreviousState: partialMeta.lastTranslationState,
      })
        .then(result => {
          const latestPartial = partialTurnsRef.current[speaker]
          if (!latestPartial) return
          const latestMeta = getPartialTurnMeta(speaker)
          if (latestMeta.turnVersion !== requestTurnVersion) return
          if (latestMeta.controller === controller) {
            latestMeta.controller = null
          }
          const latestLang = latestPartial.language || currentLang
          const filteredExisting = stripSourceLanguageFromTranslations(latestPartial.translations || {}, latestLang)
          const filteredNew = stripSourceLanguageFromTranslations(result.translations, latestLang)
          const nextTranslations = { ...filteredExisting, ...filteredNew }
          latestMeta.lastTranslationState = buildCurrentTurnPreviousStatePayload(
            latestLang,
            latestPartial.text,
            nextTranslations,
          )
          upsertPartialTurn(speaker, {
            text: latestPartial.text,
            language: latestLang,
            translations: nextTranslations,
          })
        })
        .catch(() => {
          const latestMeta = partialTurnMetaRef.current[speaker]
          if (latestMeta && latestMeta.controller === controller) {
            latestMeta.controller = null
          }
        })
    }
  }, [connectionStatus, getPartialTurnMeta, languages, partialTurnsState, translateViaApi, upsertPartialTurn])

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
      clearPartialBuffers()
    }
  }, [cleanup, clearPartialBuffers])

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

  const partialTurns = useMemo<PartialTurn[]>(() => {
    return Object.values(partialTurnsState)
      .filter((turn) => turn.text.trim().length > 0)
      .sort((a, b) => a.updatedAtMs - b.updatedAtMs)
  }, [partialTurnsState])
  const legacyPartialTurn = partialTurns[partialTurns.length - 1] || null
  const partialTranscript = legacyPartialTurn?.text || ''
  const partialTranslations = legacyPartialTurn?.translations || {}
  const partialLang = legacyPartialTurn?.language || null

  return {
    connectionStatus,
    utterances,
    partialTranscript,
    partialTurns,
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

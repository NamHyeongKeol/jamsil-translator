'use client'

import { useState, useRef, useEffect, useLayoutEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Loader2, Volume2, VolumeX, Mic, ArrowRight, ChevronDown, Menu, LogOut, Trash2 } from 'lucide-react'
import PhoneFrame from './PhoneFrame'
import ChatBubble from './ChatBubble'
import type { Utterance } from './ChatBubble'
import LanguageSelector from './LanguageSelector'
import useRealtimeSTT from './useRealtimeSTT'
import { useTtsSettings } from '@/context/tts-settings'
import { buildClientApiPath } from '@/lib/api-contract'
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  deriveScrollAutoFollowState,
  deriveScrollUiVisibility,
  isLikelyIOSNavigator,
} from './live-phone-demo.scroll.logic'
import {
  NATIVE_UI_EVENT,
  isNativeUiBridgeEnabledFromSearch,
  parseNativeUiScrollToTopDetail,
  shouldEnableIosTopTapFallback,
} from './live-phone-demo.native-ui.logic'

const VOLUME_THRESHOLD = 0.05
const LS_KEY_LANGUAGES = 'mingle_demo_languages'
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
// Boost factor applied to TTS playback while STT is active.
// iOS .playAndRecord reduces speaker output; this compensates in software.
const TTS_STT_GAIN = 1.0
const NATIVE_TTS_EVENT = 'mingle:native-tts'
const SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX = 400
const SCROLL_UI_HIDE_DELAY_MS = 1000
const SCROLLBAR_MIN_THUMB_HEIGHT_PX = 28
const USER_SCROLL_INTENT_WINDOW_MS = 1400
const NATIVE_TTS_EVENT_TIMEOUT_MS = 15000

function isNativeApp(): boolean {
  return typeof window !== 'undefined'
    && typeof window.ReactNativeWebView?.postMessage === 'function'
}

function isLikelyIOSPlatform(): boolean {
  if (typeof window === 'undefined') return false
  return isLikelyIOSNavigator(window.navigator)
}

async function blobToBase64(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer()
  const bytes = new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}


function getUiLocale(): string {
  if (typeof window === 'undefined') return 'en'
  const docLocale = (document.documentElement.lang || '').trim()
  if (docLocale) return docLocale
  return (window.navigator.languages?.find(Boolean) || window.navigator.language || 'en').trim() || 'en'
}

function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

function formatScrollDateLabel(createdAtMs: number, locale: string): string {
  const targetDate = new Date(createdAtMs)
  if (Number.isNaN(targetDate.getTime())) return ''
  const now = new Date()
  const dayMs = 24 * 60 * 60 * 1000
  const todayStart = startOfLocalDay(now).getTime()
  const targetStart = startOfLocalDay(targetDate).getTime()
  const dayDelta = Math.round((targetStart - todayStart) / dayMs)

  if (dayDelta === 0 || dayDelta === -1) {
    try {
      return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(dayDelta, 'day')
    } catch {
      return dayDelta === 0 ? 'today' : 'yesterday'
    }
  }

  const sameYear = targetDate.getFullYear() === now.getFullYear()
  try {
    return new Intl.DateTimeFormat(locale, sameYear
      ? { month: 'numeric', day: 'numeric', weekday: 'short' }
      : { year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short' })
      .format(targetDate)
  } catch {
    return sameYear
      ? `${targetDate.getMonth() + 1}/${targetDate.getDate()}`
      : `${targetDate.getFullYear()}/${targetDate.getMonth() + 1}/${targetDate.getDate()}`
  }
}

function findTopVisibleUtteranceDateLabel(container: HTMLDivElement, locale: string): string {
  const containerRect = container.getBoundingClientRect()
  const nodes = container.querySelectorAll<HTMLElement>('[data-utterance-created-at]')
  for (const node of nodes) {
    const rect = node.getBoundingClientRect()
    if (rect.bottom <= containerRect.top + 1) continue
    const raw = node.dataset.utteranceCreatedAt || ''
    const createdAtMs = Number(raw)
    if (!Number.isFinite(createdAtMs) || createdAtMs <= 0) continue
    return formatScrollDateLabel(createdAtMs, locale)
  }
  return ''
}

const FLAG_MAP: Record<string, string> = {
  en: '🇺🇸', ko: '🇰🇷', ja: '🇯🇵', zh: '🇨🇳', es: '🇪🇸',
  fr: '🇫🇷', de: '🇩🇪', ru: '🇷🇺', pt: '🇧🇷', ar: '🇸🇦',
  hi: '🇮🇳', th: '🇹🇭', vi: '🇻🇳', it: '🇮🇹', id: '🇮🇩',
  tr: '🇹🇷', pl: '🇵🇱', nl: '🇳🇱', sv: '🇸🇪', ms: '🇲🇾',
}

export interface LivePhoneDemoRef {
  startRecording: () => void
}

interface LivePhoneDemoProps {
  onLimitReached?: () => void
  enableAutoTTS?: boolean
  uiLocale: string
  tapPlayToStartLabel: string
  usageLimitReachedLabel: string
  usageLimitRetryHintLabel: string
  connectingLabel: string
  connectionFailedLabel: string
  muteTtsLabel: string
  unmuteTtsLabel: string
  menuLabel: string
  logoutLabel: string
  deleteAccountLabel: string
  onLogout: () => void
  onDeleteAccount: () => void
  isAuthActionPending?: boolean
}

const TTS_AUDIO_WAIT_TIMEOUT_MS = 3000

type TtsQueueItem = {
  utteranceId: string
  audioBlob: Blob | null
  language: string
}

type NativeTtsStopReason = 'mute_or_sound_disabled' | 'component_unmount' | 'force_reset'

function EchoInputRouteIcon({ echoAllowed }: { echoAllowed: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={`relative inline-flex items-center ${
        echoAllowed ? 'text-amber-500' : 'text-gray-400'
      }`}
    >
      <Volume2 size={12} strokeWidth={2} />
      <ArrowRight size={12} strokeWidth={2} />
      <Mic size={12} strokeWidth={2} />
      {!echoAllowed && (
        <span className="absolute left-0 top-1/2 h-[2px] w-full -translate-y-1/2 rotate-[-24deg] rounded bg-current" />
      )}
    </span>
  )
}

async function saveConversation(utterances: Utterance[], selectedLanguages: string[], usageSec: number) {
  try {
    await fetch(buildClientApiPath('/log/client-event'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        eventType: 'stt_session_stopped',
        metadata: {
          utterances,
          selectedLanguages,
          usageSec,
        },
        clientContext: {
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          platform: navigator.platform,
          language: navigator.language,
          referrer: document.referrer || null,
          pathname: window.location.pathname,
          fullUrl: window.location.href,
          queryParams: window.location.search || null,
          usageSec,
        },
      }),
    })
  } catch { /* silently fail */ }
}

const LivePhoneDemo = forwardRef<LivePhoneDemoRef, LivePhoneDemoProps>(function LivePhoneDemo({
  onLimitReached,
  enableAutoTTS = false,
  uiLocale,
  tapPlayToStartLabel,
  usageLimitReachedLabel,
  usageLimitRetryHintLabel,
  connectingLabel,
  connectionFailedLabel,
  muteTtsLabel,
  unmuteTtsLabel,
  menuLabel,
  logoutLabel,
  deleteAccountLabel,
  onLogout,
  onDeleteAccount,
  isAuthActionPending = false,
}, ref) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['en', 'ko', 'ja']
    try {
      const stored = localStorage.getItem(LS_KEY_LANGUAGES)
      return stored ? JSON.parse(stored) : ['en', 'ko', 'ja']
    } catch { return ['en', 'ko', 'ja'] }
  })
  const [langSelectorOpen, setLangSelectorOpen] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const { ttsEnabled: isSoundEnabled, setTtsEnabled: setIsSoundEnabled, aecEnabled, setAecEnabled } = useTtsSettings()
  const [speakingItem, setSpeakingItem] = useState<{ utteranceId: string, language: string } | null>(null)
  const utterancesRef = useRef<Utterance[]>([])
  const playerAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentAudioUrlRef = useRef<string | null>(null)
  const ttsQueueRef = useRef<TtsQueueItem[]>([])
  const isTtsProcessingRef = useRef(false)
  const ttsWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const nativeTtsPlaybackSeqRef = useRef(0)
  const activeNativeTtsPlaybackIdRef = useRef<string | null>(null)
  const activeNativeTtsUtteranceIdRef = useRef<string | null>(null)
  const nativeTtsEventTimerRef = useRef<number | null>(null)
  const isAudioPrimedRef = useRef(false)
  const ttsAudioContextRef = useRef<AudioContext | null>(null)
  const ttsGainNodeRef = useRef<GainNode | null>(null)
  const ttsNeedsUnlockRef = useRef(false)
  const processTtsQueueRef = useRef<() => void>(() => {})
  const stopClickResumeTimerIdsRef = useRef<number[]>([])
  const langSelectorButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuButtonRef = useRef<HTMLButtonElement | null>(null)
  const menuPanelRef = useRef<HTMLDivElement | null>(null)
  const [isNativeUiBridgeEnabled] = useState(() => {
    if (typeof window === 'undefined') return false
    return isNativeUiBridgeEnabledFromSearch(window.location.search || '')
  })
  const [isIosTopTapEnabled] = useState(() => shouldEnableIosTopTapFallback({
    isLikelyIosPlatform: isLikelyIOSPlatform(),
    isNativeApp: isNativeApp(),
    isNativeUiBridgeEnabled,
  }))


  // Persist selected languages
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_LANGUAGES, JSON.stringify(selectedLanguages))
    } catch { /* ignore */ }
  }, [selectedLanguages])

  useEffect(() => {
    if (!menuOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (!target) return
      if (menuButtonRef.current?.contains(target)) return
      if (menuPanelRef.current?.contains(target)) return
      setMenuOpen(false)
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [menuOpen])

  const ensureAudioPlayer = useCallback(() => {
    if (playerAudioRef.current) return playerAudioRef.current
    const audio = new Audio()
    audio.preload = 'auto'
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    playerAudioRef.current = audio
    // In the native RN app, the native AVAudioSession handles AEC and volume.
    // Creating a WebView AudioContext here conflicts with the native session
    // causing silent TTS playback and STT stalls.  Only use the GainNode
    // path on the regular mobile-web surface where there is no native session.
    if (!isNativeApp()) {
      try {
        const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) {
          const ctx = new AudioCtx()
          const source = ctx.createMediaElementSource(audio)
          const gain = ctx.createGain()
          gain.gain.value = 1.0
          source.connect(gain)
          gain.connect(ctx.destination)
          ttsAudioContextRef.current = ctx
          ttsGainNodeRef.current = gain
        }
      } catch { /* fallback: audio plays without gain control */ }
    }
    return audio
  }, [])

  const cleanupCurrentAudio = useCallback(() => {
    const player = playerAudioRef.current
    if (player) {
      player.pause()
      player.onended = null
      player.onerror = null
      player.src = ''
      player.load()
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current)
      currentAudioUrlRef.current = null
    }
  }, [])

  const clearTtsWaitTimer = useCallback(() => {
    if (ttsWaitTimerRef.current) {
      clearTimeout(ttsWaitTimerRef.current)
      ttsWaitTimerRef.current = null
    }
  }, [])

  const clearNativeTtsEventTimer = useCallback(() => {
    if (nativeTtsEventTimerRef.current !== null) {
      window.clearTimeout(nativeTtsEventTimerRef.current)
      nativeTtsEventTimerRef.current = null
    }
  }, [])

  const sendNativeTtsStopCommand = useCallback((reason: NativeTtsStopReason) => {
    if (!isNativeApp()) return
    window.ReactNativeWebView!.postMessage(JSON.stringify({
      type: 'native_tts_stop',
      payload: { reason },
    }))
  }, [])

  const allocateNativeTtsPlaybackId = useCallback((utteranceId: string) => {
    nativeTtsPlaybackSeqRef.current += 1
    return `${utteranceId}::${nativeTtsPlaybackSeqRef.current}`
  }, [])

  const armNativeTtsEventTimeout = useCallback((playbackId: string, utteranceId: string) => {
    if (!isNativeApp()) return
    clearNativeTtsEventTimer()
    activeNativeTtsPlaybackIdRef.current = playbackId
    activeNativeTtsUtteranceIdRef.current = utteranceId
    nativeTtsEventTimerRef.current = window.setTimeout(() => {
      if (
        activeNativeTtsPlaybackIdRef.current !== playbackId
        && activeNativeTtsUtteranceIdRef.current !== utteranceId
      ) {
        return
      }
      activeNativeTtsPlaybackIdRef.current = null
      activeNativeTtsUtteranceIdRef.current = null
      nativeTtsEventTimerRef.current = null
      setSpeakingItem(prev => (prev?.utteranceId === utteranceId ? null : prev))
      isTtsProcessingRef.current = false
      processTtsQueueRef.current()
    }, NATIVE_TTS_EVENT_TIMEOUT_MS)
  }, [clearNativeTtsEventTimer])

  const processTtsQueue = useCallback(() => {
    if (isTtsProcessingRef.current) return
    if (!enableAutoTTS || !isSoundEnabled) {
      clearTtsWaitTimer()
      return
    }

    const queue = ttsQueueRef.current
    if (queue.length === 0) {
      clearTtsWaitTimer()
      clearNativeTtsEventTimer()
      activeNativeTtsPlaybackIdRef.current = null
      activeNativeTtsUtteranceIdRef.current = null
      setSpeakingItem(null)
      return
    }

    const front = queue[0]

    // Front item is waiting for audio — set a timeout to skip if it never arrives
    if (!front.audioBlob) {
      if (!ttsWaitTimerRef.current) {
        ttsWaitTimerRef.current = setTimeout(() => {
          ttsWaitTimerRef.current = null
          const q = ttsQueueRef.current
          if (q.length > 0 && !q[0].audioBlob) {
            q.shift()
          }
          processTtsQueueRef.current()
        }, TTS_AUDIO_WAIT_TIMEOUT_MS)
      }
      return
    }

    // Front item has audio — play it
    clearTtsWaitTimer()
    const next = queue.shift()!
    const audioBlob = next.audioBlob!
    isTtsProcessingRef.current = true
    cleanupCurrentAudio()
    setSpeakingItem({ utteranceId: next.utteranceId, language: next.language })

    const onPlaybackDone = () => {
      clearNativeTtsEventTimer()
      activeNativeTtsPlaybackIdRef.current = null
      activeNativeTtsUtteranceIdRef.current = null
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      isTtsProcessingRef.current = false
      processTtsQueueRef.current()
    }

    const playViaNativeBridge = async () => {
      try {
        const playbackId = allocateNativeTtsPlaybackId(next.utteranceId)
        const audioBase64 = await blobToBase64(audioBlob)
        window.ReactNativeWebView!.postMessage(JSON.stringify({
          type: 'native_tts_play',
          payload: {
            playbackId,
            utteranceId: next.utteranceId,
            audioBase64,
            contentType: audioBlob.type || 'audio/mpeg',
          },
        }))
        armNativeTtsEventTimeout(playbackId, next.utteranceId)
      } catch {
        onPlaybackDone()
      }
    }

    const playViaHtmlAudio = async () => {
      clearNativeTtsEventTimer()
      activeNativeTtsPlaybackIdRef.current = null
      activeNativeTtsUtteranceIdRef.current = null
      const audio = ensureAudioPlayer()

      const ctx = ttsAudioContextRef.current
      if (ctx && ctx.state === 'suspended') {
        try { await ctx.resume() } catch { /* best-effort */ }
      }

      const objectUrl = URL.createObjectURL(audioBlob)
      currentAudioUrlRef.current = objectUrl
      audio.src = objectUrl

      audio.onended = () => {
        if (currentAudioUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl)
          currentAudioUrlRef.current = null
        }
        onPlaybackDone()
      }

      audio.onerror = () => {
        if (currentAudioUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl)
          currentAudioUrlRef.current = null
        }
        onPlaybackDone()
      }

      audio.play().catch(() => {
        if (currentAudioUrlRef.current === objectUrl) {
          URL.revokeObjectURL(objectUrl)
          currentAudioUrlRef.current = null
        }
        setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
        ttsNeedsUnlockRef.current = true
        // Re-insert at front of queue so it can be retried after audio unlock
        ttsQueueRef.current.unshift(next)
        isTtsProcessingRef.current = false
      })
    }

    if (isNativeApp()) {
      void playViaNativeBridge()
    } else {
      void playViaHtmlAudio()
    }
  }, [allocateNativeTtsPlaybackId, armNativeTtsEventTimeout, cleanupCurrentAudio, clearNativeTtsEventTimer, clearTtsWaitTimer, enableAutoTTS, ensureAudioPlayer, isSoundEnabled])

  useEffect(() => {
    processTtsQueueRef.current = processTtsQueue
  }, [processTtsQueue])

  // Listen for native TTS playback events (only in native app).
  useEffect(() => {
    if (!isNativeApp()) return

    const handleNativeTtsEvent = (event: Event) => {
      const detail = (event as CustomEvent).detail as {
        type: string
        playbackId?: string
        utteranceId?: string
        message?: string
      } | null
      if (!detail || typeof detail !== 'object') return

      const playbackId = detail.playbackId || ''
      const utteranceId = detail.utteranceId || ''
      const isCurrentPlaybackEvent = () => {
        if (playbackId) {
          if (activeNativeTtsPlaybackIdRef.current) {
            return activeNativeTtsPlaybackIdRef.current === playbackId
          }
          if (utteranceId && activeNativeTtsUtteranceIdRef.current) {
            return activeNativeTtsUtteranceIdRef.current === utteranceId
          }
          return true
        }
        if (utteranceId && activeNativeTtsUtteranceIdRef.current) {
          return activeNativeTtsUtteranceIdRef.current === utteranceId
        }
        return true
      }

      if (detail.type === 'tts_ended' || detail.type === 'tts_error') {
        if (!isCurrentPlaybackEvent()) return
        activeNativeTtsPlaybackIdRef.current = null
        activeNativeTtsUtteranceIdRef.current = null
        clearNativeTtsEventTimer()
        setSpeakingItem(prev => {
          if (utteranceId && prev?.utteranceId === utteranceId) return null
          return prev
        })
        isTtsProcessingRef.current = false
        processTtsQueueRef.current()
        return
      }

      if (detail.type === 'tts_stopped') {
        if (!isCurrentPlaybackEvent()) return
        activeNativeTtsPlaybackIdRef.current = null
        activeNativeTtsUtteranceIdRef.current = null
        clearNativeTtsEventTimer()
        isTtsProcessingRef.current = false
        setSpeakingItem(prev => {
          if (!utteranceId) return null
          if (prev?.utteranceId === utteranceId) return null
          return prev
        })
        processTtsQueueRef.current()
      }
    }

    window.addEventListener(NATIVE_TTS_EVENT, handleNativeTtsEvent as EventListener)
    return () => {
      window.removeEventListener(NATIVE_TTS_EVENT, handleNativeTtsEvent as EventListener)
    }
  }, [clearNativeTtsEventTimer])

  // Reserve a slot in the TTS queue when a TTS request is about to be made.
  // This ensures playback order matches utterance order regardless of response arrival order.
  const handleTtsRequested = useCallback((utteranceId: string, language: string) => {
    if (!enableAutoTTS || !isSoundEnabled) return
    const queue = ttsQueueRef.current
    if (queue.some(item => item.utteranceId === utteranceId)) {
      return
    }
    queue.push({ utteranceId, audioBlob: null, language })
  }, [enableAutoTTS, isSoundEnabled])

  // Handle TTS audio received inline with translation response.
  const handleTtsAudio = useCallback((utteranceId: string, audioBlob: Blob, language: string) => {
    if (!enableAutoTTS || !isSoundEnabled) return
    const queue = ttsQueueRef.current
    // Fill in existing placeholder
    const existing = queue.find(item => item.utteranceId === utteranceId)
    if (existing) {
      existing.audioBlob = audioBlob
      existing.language = language
    } else {
      // No placeholder (edge case) — append to end
      queue.push({ utteranceId, audioBlob, language })
    }
    processTtsQueue()
  }, [enableAutoTTS, isSoundEnabled, processTtsQueue])

  const {
    utterances,
    partialTranscript,
    volume,
    toggleRecording,
    isActive,
    isReady,
    isConnecting,
    isError,
    partialTranslations,
    partialLang,
    usageSec,
    isLimitReached,
    usageLimitSec,
    loadOlderUtterances,
    hasOlderUtterances,
    // Demo animation states
    isDemoAnimating,
    demoTypingText,
    demoTypingLang,
    demoTypingTranslations,
  } = useRealtimeSTT({
    languages: selectedLanguages,
    onLimitReached,
    onTtsRequested: handleTtsRequested,
    onTtsAudio: handleTtsAudio,
    enableTts: enableAutoTTS && isSoundEnabled,
    enableAec: aecEnabled,
  })

  // Boost TTS volume while STT is active to compensate for iOS
  // .playAndRecord audio session reducing speaker output.
  useEffect(() => {
    const gain = ttsGainNodeRef.current
    if (!gain) return
    gain.gain.value = isActive ? TTS_STT_GAIN : 1.0
  }, [isActive])

  useEffect(() => {
    utterancesRef.current = utterances
  }, [utterances])

  // Re-evaluate queue after utterance state commit.
  // This closes the race where inline TTS arrives before translationFinalized state is rendered.
  useEffect(() => {
    if (!enableAutoTTS || !isSoundEnabled) return
    if (isTtsProcessingRef.current) return
    if (ttsQueueRef.current.length === 0) return
    const timerId = window.setTimeout(() => {
      processTtsQueue()
    }, 0)
    return () => {
      window.clearTimeout(timerId)
    }
  }, [enableAutoTTS, isSoundEnabled, processTtsQueue, utterances])



  const primeAudioPlayback = useCallback(async (force = false): Promise<boolean> => {
    if (!force && isAudioPrimedRef.current) return true
    try {
      const player = ensureAudioPlayer()
      // Resume TTS AudioContext if suspended (iOS requires user gesture).
      if (ttsAudioContextRef.current?.state === 'suspended') {
        await ttsAudioContextRef.current.resume()
      }
      // Don't interrupt active TTS playback.
      if (!player.paused && !player.ended) {
        isAudioPrimedRef.current = true
        ttsNeedsUnlockRef.current = false
        return true
      }
      player.src = SILENT_WAV_DATA_URI
      player.volume = 0
      await player.play()
      player.pause()
      player.currentTime = 0
      player.volume = 1
      player.src = ''
      player.load()
      isAudioPrimedRef.current = true
      ttsNeedsUnlockRef.current = false
      return true
    } catch {
      const player = playerAudioRef.current
      if (player) {
        // Ensure failed priming never leaves the shared player muted.
        player.volume = 1
        if (
          player.src === SILENT_WAV_DATA_URI
          || player.src.startsWith('data:audio/wav;base64,')
        ) {
          player.pause()
          player.currentTime = 0
          player.src = ''
          player.load()
        }
      }
      isAudioPrimedRef.current = false
      return false
    }
  }, [ensureAudioPlayer])

  const resumeTtsPlayback = useCallback((withPriming = false) => {
    if (!enableAutoTTS || !isSoundEnabled) return
    const current = playerAudioRef.current
    if (current && !current.ended && current.paused) {
      void current.play().then(() => {
        ttsNeedsUnlockRef.current = false
      }).catch(() => {
        ttsNeedsUnlockRef.current = true
      })
      return
    }

    if (withPriming && ttsNeedsUnlockRef.current) {
      void primeAudioPlayback(true).then((ok) => {
        if (!ok) {
          ttsNeedsUnlockRef.current = true
          return
        }
        ttsNeedsUnlockRef.current = false
        processTtsQueue()
      })
      return
    }

    if (!isTtsProcessingRef.current) {
      processTtsQueue()
    }
  }, [enableAutoTTS, isSoundEnabled, primeAudioPlayback, processTtsQueue])

  const clearStopClickResumeTimers = useCallback(() => {
    if (stopClickResumeTimerIdsRef.current.length === 0) return
    for (const id of stopClickResumeTimerIdsRef.current) {
      window.clearTimeout(id)
    }
    stopClickResumeTimerIdsRef.current = []
  }, [])

  const scheduleTtsResumeAfterStopClick = useCallback(() => {
    if (!enableAutoTTS || !isSoundEnabled) return
    resumeTtsPlayback(true)
    const delays = [140, 420]
    for (const delay of delays) {
      const timerId = window.setTimeout(() => {
        stopClickResumeTimerIdsRef.current = stopClickResumeTimerIdsRef.current.filter(id => id !== timerId)
        resumeTtsPlayback(true)
      }, delay)
      stopClickResumeTimerIdsRef.current.push(timerId)
    }
  }, [enableAutoTTS, isSoundEnabled, resumeTtsPlayback])

  // TTS stop policy:
  // - STT stop path must NOT stop TTS.
  // - native_tts_stop is allowed only for mute/off, force reset, and unmount.
  const forceStopTtsPlayback = useCallback((
    reason: NativeTtsStopReason,
    options?: { clearSpeakingItem?: boolean },
  ) => {
    clearStopClickResumeTimers()
    clearTtsWaitTimer()
    clearNativeTtsEventTimer()
    activeNativeTtsPlaybackIdRef.current = null
    activeNativeTtsUtteranceIdRef.current = null
    ttsQueueRef.current = []
    isTtsProcessingRef.current = false
    ttsNeedsUnlockRef.current = false
    cleanupCurrentAudio()
    if (options?.clearSpeakingItem) {
      setSpeakingItem(null)
    }
    sendNativeTtsStopCommand(reason)
  }, [cleanupCurrentAudio, clearNativeTtsEventTimer, clearStopClickResumeTimers, clearTtsWaitTimer, sendNativeTtsStopCommand])

  // Stop current playback when sound is disabled.
  useEffect(() => {
    if (isSoundEnabled) return
    const timerId = window.setTimeout(() => {
      forceStopTtsPlayback('mute_or_sound_disabled', { clearSpeakingItem: true })
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [forceStopTtsPlayback, isSoundEnabled])

  const prevEnableAutoTTSRef = useRef(enableAutoTTS)
  useEffect(() => {
    const wasEnabled = prevEnableAutoTTSRef.current
    prevEnableAutoTTSRef.current = enableAutoTTS
    if (enableAutoTTS || !wasEnabled) return
    const timerId = window.setTimeout(() => {
      forceStopTtsPlayback('force_reset', { clearSpeakingItem: true })
    }, 0)
    return () => window.clearTimeout(timerId)
  }, [enableAutoTTS, forceStopTtsPlayback])

  useEffect(() => {
    if (!enableAutoTTS) return
    const handleVisibilityChange = () => {
      if (document.hidden) return
      resumeTtsPlayback(false)
    }
    const handlePageShow = () => {
      resumeTtsPlayback(false)
    }
    const handleWindowFocus = () => {
      resumeTtsPlayback(false)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('pageshow', handlePageShow)
    window.addEventListener('focus', handleWindowFocus)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('pageshow', handlePageShow)
      window.removeEventListener('focus', handleWindowFocus)
    }
  }, [enableAutoTTS, resumeTtsPlayback])

  useEffect(() => {
    if (!enableAutoTTS) return
    const handleUserGesture = () => {
      if (!ttsNeedsUnlockRef.current) return
      resumeTtsPlayback(true)
    }

    window.addEventListener('pointerdown', handleUserGesture, { passive: true })
    window.addEventListener('touchstart', handleUserGesture, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', handleUserGesture)
      window.removeEventListener('touchstart', handleUserGesture)
    }
  }, [enableAutoTTS, resumeTtsPlayback])

  // Keep TTS moving even if a trigger was missed (e.g. race between state commit and inline audio arrival).
  useEffect(() => {
    if (!enableAutoTTS || !isSoundEnabled) return
    const intervalId = window.setInterval(() => {
      if (isTtsProcessingRef.current) return
      if (ttsQueueRef.current.length === 0) return
      processTtsQueue()
    }, 350)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [enableAutoTTS, isSoundEnabled, processTtsQueue])

  useEffect(() => {
    return () => {
      forceStopTtsPlayback('component_unmount')
      ttsAudioContextRef.current?.close()
      ttsAudioContextRef.current = null
      ttsGainNodeRef.current = null
    }
  }, [forceStopTtsPlayback])

  const handleToggleLanguage = useCallback((code: string) => {
    setSelectedLanguages(prev => {
      if (prev.includes(code)) {
        return prev.filter(c => c !== code)
      }
      return [...prev, code]
    })
  }, [])

  const handleMicPointerDown = useCallback(() => {
    if (!enableAutoTTS || isActive) return
    void primeAudioPlayback()
  }, [enableAutoTTS, isActive, primeAudioPlayback])

  const handleMicClick = useCallback(async () => {
    if (isLimitReached) {
      onLimitReached?.()
      return
    }
    const wasActive = isActive
    // Mic button controls STT only.
    // Prime audio player only when starting STT from idle, not when stopping.
    if (enableAutoTTS && !wasActive) {
      const ok = await primeAudioPlayback()
      if (!ok) {
        ttsNeedsUnlockRef.current = true
      }
    }
    toggleRecording()
    if (wasActive) {
      scheduleTtsResumeAfterStopClick()
    }
  }, [enableAutoTTS, isActive, isLimitReached, onLimitReached, primeAudioPlayback, scheduleTtsResumeAfterStopClick, toggleRecording])

  useImperativeHandle(ref, () => ({
    startRecording: handleMicClick,
  }), [handleMicClick])

  const chatRef = useRef<HTMLDivElement>(null)
  const shouldAutoScroll = useRef(true)
  const suppressAutoScrollRef = useRef(false)
  const userScrollIntentUntilRef = useRef(0)
  const hasInitialBottomAnchorRef = useRef(false)
  const allowAutoTopPaginationRef = useRef(false)
  const isPaginatingRef = useRef(false)
  const prevScrollHeightRef = useRef<number | null>(null)
  const isLoadingOlderRef = useRef(false)
  const scrollUiHideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [scrollUiVisible, setScrollUiVisible] = useState(false)
  const [scrollDateLabel, setScrollDateLabel] = useState('')
  const [scrollMetrics, setScrollMetrics] = useState({
    thumbTop: 0,
    thumbHeight: 0,
    clientHeight: 0,
    scrollable: false,
    distanceToBottom: 0,
  })

  const handleLoadOlder = useCallback(() => {
    if (isLoadingOlderRef.current || !hasOlderUtterances || !chatRef.current) return
    isLoadingOlderRef.current = true
    suppressAutoScrollRef.current = true
    shouldAutoScroll.current = false
    isPaginatingRef.current = true
    prevScrollHeightRef.current = chatRef.current.scrollHeight
    loadOlderUtterances()
  }, [hasOlderUtterances, loadOlderUtterances])

  const markUserScrollIntent = useCallback(() => {
    userScrollIntentUntilRef.current = Date.now() + USER_SCROLL_INTENT_WINDOW_MS
  }, [])

  const isUserScrollIntentActive = useCallback(() => {
    return Date.now() <= userScrollIntentUntilRef.current
  }, [])

  const clearScrollUiHideTimer = useCallback(() => {
    if (scrollUiHideTimerRef.current) {
      clearTimeout(scrollUiHideTimerRef.current)
      scrollUiHideTimerRef.current = null
    }
  }, [])

  const updateScrollDerivedState = useCallback((options?: { fromUserScroll?: boolean }) => {
    if (!chatRef.current) return
    const fromUserScroll = options?.fromUserScroll === true
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    const distanceToBottom = Math.max(0, scrollHeight - scrollTop - clientHeight)
    const nextScrollState = deriveScrollAutoFollowState({
      distanceToBottom,
      fromUserScroll,
      suppressAutoScroll: suppressAutoScrollRef.current,
      isPaginating: isPaginatingRef.current,
      isLoadingOlder: isLoadingOlderRef.current,
      nearBottomThresholdPx: AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
    })
    suppressAutoScrollRef.current = nextScrollState.suppressAutoScroll
    shouldAutoScroll.current = nextScrollState.shouldAutoScroll

    if (scrollHeight > clientHeight + 1) {
      const thumbHeight = Math.max(
        SCROLLBAR_MIN_THUMB_HEIGHT_PX,
        Math.round((clientHeight / scrollHeight) * clientHeight),
      )
      const maxThumbTop = Math.max(0, clientHeight - thumbHeight)
      const denominator = scrollHeight - clientHeight
      const ratio = denominator > 0 ? Math.min(1, Math.max(0, scrollTop / denominator)) : 0
      const thumbTop = ratio * maxThumbTop
      setScrollMetrics({
        thumbTop,
        thumbHeight,
        clientHeight,
        scrollable: true,
        distanceToBottom,
      })
    } else {
      setScrollMetrics({
        thumbTop: 0,
        thumbHeight: 0,
        clientHeight,
        scrollable: false,
        distanceToBottom,
      })
    }

    setScrollDateLabel(findTopVisibleUtteranceDateLabel(chatRef.current, getUiLocale()))

    if (
      allowAutoTopPaginationRef.current
      && scrollTop < 100
      && hasOlderUtterances
      && !isLoadingOlderRef.current
    ) {
      handleLoadOlder()
    }
  }, [hasOlderUtterances, handleLoadOlder])

  const handleScroll = useCallback(() => {
    const fromUserScroll = isUserScrollIntentActive()
    updateScrollDerivedState({ fromUserScroll })

    const scrollUi = deriveScrollUiVisibility({
      fromUserScroll,
      shouldAutoScroll: shouldAutoScroll.current,
    })

    if (!scrollUi.visible) {
      clearScrollUiHideTimer()
      setScrollUiVisible(false)
      return
    }

    setScrollUiVisible(true)
    clearScrollUiHideTimer()
    if (scrollUi.scheduleHideTimer) {
      scrollUiHideTimerRef.current = setTimeout(() => {
        setScrollUiVisible(false)
      }, SCROLL_UI_HIDE_DELAY_MS)
    }
  }, [clearScrollUiHideTimer, isUserScrollIntentActive, updateScrollDerivedState])

  const handleScrollToBottom = useCallback(() => {
    if (!chatRef.current) return
    markUserScrollIntent()
    suppressAutoScrollRef.current = false
    shouldAutoScroll.current = true
    chatRef.current.scrollTo({ top: chatRef.current.scrollHeight, behavior: 'smooth' })
    updateScrollDerivedState({ fromUserScroll: true })
  }, [markUserScrollIntent, updateScrollDerivedState])

  const handleTopSafeAreaTap = useCallback(() => {
    if (!chatRef.current) return
    markUserScrollIntent()
    suppressAutoScrollRef.current = true
    shouldAutoScroll.current = false
    chatRef.current.scrollTo({ top: 0, behavior: 'smooth' })
    updateScrollDerivedState({ fromUserScroll: true })
  }, [markUserScrollIntent, updateScrollDerivedState])

  useEffect(() => {
    if (!isNativeApp()) return

    const handleNativeUiEvent = (event: Event) => {
      const detail = parseNativeUiScrollToTopDetail((event as CustomEvent<unknown>).detail)
      if (!detail) return
      handleTopSafeAreaTap()
    }

    window.addEventListener(NATIVE_UI_EVENT, handleNativeUiEvent as EventListener)
    return () => {
      window.removeEventListener(NATIVE_UI_EVENT, handleNativeUiEvent as EventListener)
    }
  }, [handleTopSafeAreaTap])

  // On fresh mount/re-entry, pin to the latest messages first.
  // This prevents initial top-pagination from running before we settle at bottom.
  useLayoutEffect(() => {
    if (!chatRef.current || hasInitialBottomAnchorRef.current) return
    const node = chatRef.current
    node.scrollTop = node.scrollHeight
    shouldAutoScroll.current = true
    suppressAutoScrollRef.current = false
    hasInitialBottomAnchorRef.current = true

    const rafId = window.requestAnimationFrame(() => {
      allowAutoTopPaginationRef.current = true
      updateScrollDerivedState()
    })

    return () => window.cancelAnimationFrame(rafId)
  }, [updateScrollDerivedState, utterances.length])

  // Preserve scroll position after prepending older utterances
  useLayoutEffect(() => {
    if (!isPaginatingRef.current || prevScrollHeightRef.current === null || !chatRef.current) return
    const delta = chatRef.current.scrollHeight - prevScrollHeightRef.current
    chatRef.current.scrollTop += delta
    prevScrollHeightRef.current = null
    isPaginatingRef.current = false
    isLoadingOlderRef.current = false
    updateScrollDerivedState()
  }, [updateScrollDerivedState, utterances])

  useEffect(() => {
    if (
      chatRef.current
      && shouldAutoScroll.current
      && !suppressAutoScrollRef.current
      && !isPaginatingRef.current
      && !isLoadingOlderRef.current
    ) {
      const targetTop = chatRef.current.scrollHeight
      if (Math.abs(targetTop - chatRef.current.scrollTop) > 1) {
        chatRef.current.scrollTo({ top: targetTop, behavior: 'smooth' })
      }
    }
    updateScrollDerivedState()
  }, [demoTypingText, isConnecting, partialTranscript, updateScrollDerivedState, utterances])

  useEffect(() => {
    updateScrollDerivedState()
  }, [updateScrollDerivedState])

  useEffect(() => {
    return () => {
      clearScrollUiHideTimer()
    }
  }, [clearScrollUiHideTimer])

  const showRipple = isReady && volume > VOLUME_THRESHOLD
  const rippleScale = showRipple ? 1 + (volume - VOLUME_THRESHOLD) * 5 : 1

  // Determine target languages for bouncing dots during partial transcript
  const detectedLang = partialLang || (utterances.length > 0 ? utterances[utterances.length - 1].originalLang : null)
  const pendingPartialLangs = partialTranscript
    ? selectedLanguages.filter(l => l !== detectedLang && !partialTranslations[l])
    : []
  const availablePartialTranslations = partialTranscript
    ? Object.entries(partialTranslations).filter(([lang]) => selectedLanguages.includes(lang) && lang !== detectedLang)
    : []

  const isUsageLimited = typeof usageLimitSec === 'number'
  const remainingSec = isUsageLimited
    ? Math.max(0, usageLimitSec - usageSec)
    : null
  const usagePercent = isUsageLimited
    ? Math.min(100, (usageSec / usageLimitSec) * 100)
    : null
  const showScrollToBottom = scrollMetrics.distanceToBottom > SCROLL_TO_BOTTOM_BUTTON_THRESHOLD_PX
  const scrollDateTop = Math.max(
    16,
    Math.min(
      scrollMetrics.clientHeight - 16,
      scrollMetrics.thumbTop + (scrollMetrics.thumbHeight / 2),
    ),
  )
  const navSurfaceClassName = 'bg-white'

  return (
    <PhoneFrame>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* Header */}
        <div
          className={`relative z-40 shrink-0 flex items-center justify-between ${navSurfaceClassName}`}
          style={{
            paddingTop: "max(calc(env(safe-area-inset-top) + 20px), 24px)",
            paddingBottom: "10px",
            paddingLeft: "max(calc(env(safe-area-inset-left) + 14px), 18px)",
            paddingRight: "max(calc(env(safe-area-inset-right) + 14px), 18px)",
          }}
        >
          {isIosTopTapEnabled && (
            <button
              type="button"
              aria-label="Scroll to top"
              onClick={handleTopSafeAreaTap}
              className="absolute inset-x-0 top-0 z-10 bg-transparent"
              style={{ height: "max(env(safe-area-inset-top), 20px)" }}
            />
          )}
          <span className="text-[2.05rem] font-extrabold leading-[1.08] bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            Mingle
          </span>
          <div className="relative flex items-center gap-1">
            <div className="relative mr-1.5">
              <button
                ref={langSelectorButtonRef}
                onClick={() => {
                  if (isActive) return
                  setMenuOpen(false)
                  setLangSelectorOpen(o => !o)
                }}
                disabled={isActive}
                className="flex items-center gap-1 disabled:opacity-60"
              >
                {selectedLanguages.map((lang) => (
                  <span
                    key={lang}
                    className="text-[1.35rem]"
                    title={lang.toUpperCase()}
                  >
                    {FLAG_MAP[lang] || '🌐'}
                  </span>
                ))}
              </button>
              <LanguageSelector
                isOpen={langSelectorOpen}
                onClose={() => setLangSelectorOpen(false)}
                selectedLanguages={selectedLanguages}
                onToggleLanguage={handleToggleLanguage}
                uiLocale={uiLocale}
                disabled={isActive}
                triggerRef={langSelectorButtonRef}
              />
            </div>
            <div className="relative">
              <button
                ref={menuButtonRef}
                type="button"
                onClick={() => {
                  setLangSelectorOpen(false)
                  setMenuOpen(o => !o)
                }}
                disabled={isAuthActionPending}
                className={`inline-flex h-11 min-w-[44px] items-center justify-center px-2 text-gray-700 transition-colors hover:text-gray-900 active:text-gray-900 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amber-400 disabled:cursor-not-allowed disabled:opacity-60 ${navSurfaceClassName}`}
                aria-label={menuLabel}
                aria-expanded={menuOpen}
              >
                <Menu size={16} strokeWidth={2} />
              </button>
              {menuOpen && (
                <div
                  ref={menuPanelRef}
                  className={`absolute right-0 top-full z-50 mt-1 w-44 border border-gray-200 p-0 ${navSurfaceClassName}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onLogout()
                    }}
                    disabled={isAuthActionPending}
                    className="inline-flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-gray-700 transition-colors hover:text-gray-900 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <LogOut size={15} strokeWidth={2} />
                    <span>{logoutLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false)
                      onDeleteAccount()
                    }}
                    disabled={isAuthActionPending}
                    className="inline-flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-medium text-rose-600 transition-colors hover:text-rose-700 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <Trash2 size={15} strokeWidth={2} />
                    <span>{deleteAccountLabel}</span>
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Chat Area */}
        <div className="relative min-h-0 flex-1 bg-gray-50/50">
          <div
            ref={chatRef}
            onScroll={handleScroll}
            onWheel={markUserScrollIntent}
            onTouchMove={markUserScrollIntent}
            onPointerDown={markUserScrollIntent}
            className="min-h-0 h-full overflow-y-auto no-scrollbar py-2.5 space-y-3"
            style={{
              paddingLeft: "max(calc(env(safe-area-inset-left) + 6px), 10px)",
              paddingRight: "max(calc(env(safe-area-inset-right) + 6px), 10px)",
            }}
          >
          {hasOlderUtterances && (
            <button
              onClick={handleLoadOlder}
              className="w-full py-2 text-xs text-gray-400 hover:text-gray-500 active:text-gray-600 transition-colors"
            >
              ···
            </button>
          )}
          <AnimatePresence mode="popLayout">
            {utterances.map((u) => (
              <div
                key={u.id}
                data-utterance-created-at={
                  (typeof u.createdAtMs === 'number' && Number.isFinite(u.createdAtMs))
                    ? String(Math.floor(u.createdAtMs))
                    : ''
                }
              >
                <ChatBubble
                  utterance={u}
                  isSpeaking={speakingItem?.utteranceId === u.id}
                  speakingLanguage={speakingItem?.language ?? null}
                />
              </div>
            ))}
          </AnimatePresence>

          {partialTranscript && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-1"
            >
                <div className="max-w-[85%] bg-white/80 border border-gray-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                <p className="text-sm text-gray-400 leading-snug">
                  {partialTranscript}
                  <span className="inline-block w-1 h-3 ml-0.5 bg-amber-400 rounded-full animate-pulse" />
                </p>
              </div>
              {/* Available partial translations */}
              {availablePartialTranslations.map(([lang, text]) => (
                <div
                  key={lang}
                  className="ml-2.5 max-w-[80%] bg-amber-50/80 border border-amber-100 rounded-2xl rounded-tl-sm px-3.5 py-2"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-base">{FLAG_MAP[lang] || '🌐'}</span>
                  <span className="text-xs font-semibold text-amber-500 uppercase">{lang}</span>
                </div>
                  <p className="text-sm text-gray-500 leading-relaxed">{text}</p>
                </div>
              ))}
              {/* Bouncing dots for pending partial translations */}
              {pendingPartialLangs.map((lang) => (
                <div
                key={`partial-pending-${lang}`}
                  className="ml-2.5 max-w-[80%] bg-amber-50/60 border border-amber-100 rounded-2xl rounded-tl-sm px-3.5 py-2"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-base">{FLAG_MAP[lang] || '🌐'}</span>
                    <span className="text-xs font-semibold text-amber-400 uppercase">{lang}</span>
                  </div>
                  <div className="flex items-center gap-0.5 h-4">
                    <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1 h-1 bg-amber-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
              ))}
            </motion.div>
          )}

          {/* Demo typing animation */}
          {demoTypingLang && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="flex flex-col gap-1"
            >
              <div className="max-w-[85%] bg-white/80 border border-gray-200 rounded-2xl rounded-tl-sm px-3.5 py-2.5">
                <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-base">{FLAG_MAP[demoTypingLang] || '🌐'}</span>
                    <span className="text-xs font-semibold text-gray-500 uppercase">{demoTypingLang}</span>
                  </div>
                <p className="text-sm text-gray-600 leading-snug">
                  {demoTypingText}
                  <span className="inline-block w-1 h-3 ml-0.5 bg-amber-400 rounded-full animate-pulse" />
                </p>
              </div>
              {/* Demo translations - typed in parallel */}
              {Object.entries(demoTypingTranslations).map(([lang, text]) => (
                <motion.div
                  key={lang}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                   className="ml-2.5 max-w-[80%] bg-amber-50/80 border border-amber-100 rounded-2xl rounded-tl-sm px-3.5 py-2"
                 >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-base">{FLAG_MAP[lang] || '🌐'}</span>
                     <span className="text-xs font-semibold text-amber-500 uppercase">{lang}</span>
                  </div>
                  <p className="text-sm text-gray-500 leading-relaxed">
                    {text}
                    <span className="inline-block w-0.5 h-3 ml-0.5 bg-amber-300 rounded-full animate-pulse" />
                  </p>
                 </motion.div>
              ))}
            </motion.div>
          )}

          {/* Empty state */}
          {utterances.length === 0 && !partialTranscript && !demoTypingText && !demoTypingLang && !isDemoAnimating && !isActive && !isError && !isLimitReached && (
            <div className="flex min-h-full flex-col items-center justify-center text-center text-gray-400 gap-2">
                <Play size={38} className="text-gray-300" />
                <p className="text-base">{tapPlayToStartLabel}</p>
              </div>
            )}

          {/* Limit reached state */}
          {isLimitReached && !isActive && (
            <div className="flex flex-col items-center justify-center text-center text-gray-400 gap-2 pt-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-5 py-3.5 text-center">
                <p className="text-sm font-semibold text-amber-600 mb-1">{usageLimitReachedLabel}</p>
              <p className="text-xs text-amber-500/80">{usageLimitRetryHintLabel}</p>
          </div>
      </div>
    )}

          {/* Connecting state */}
          {isConnecting && (
            <div className="flex items-center justify-center gap-2 py-4">
                <Loader2 size={20} className="text-amber-400 animate-spin" />
                <p className="text-sm text-gray-400">{connectingLabel}</p>
            </div>
          )}

          {/* Error state */}
          {isError && (
              <div className="flex min-h-full flex-col items-center justify-center text-center text-red-400 gap-2">
                <p className="text-sm">{connectionFailedLabel}</p>
             </div>
          )}
          </div>

          <AnimatePresence>
            {scrollUiVisible && scrollMetrics.scrollable && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="pointer-events-none absolute inset-y-0 right-1 z-20"
              >
                {scrollDateLabel && (
                  <div
                    className="absolute right-2.5 -translate-y-1/2 whitespace-nowrap rounded-full border border-black/10 bg-white/48 px-3 py-1 text-[11px] font-medium tracking-tight text-black/[0.46] shadow-sm backdrop-blur-[1px]"
                    style={{ top: scrollDateTop }}
                  >
                    {scrollDateLabel}
                  </div>
                )}
                <div
                  className="absolute right-0 w-[3px] rounded-full bg-black/28"
                  style={{
                    top: scrollMetrics.thumbTop,
                    height: scrollMetrics.thumbHeight,
                  }}
                />
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {showScrollToBottom && (
              <motion.div
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.98 }}
                transition={{ duration: 0.2, ease: 'easeOut' }}
                className="pointer-events-none absolute inset-x-0 bottom-3 z-20 flex justify-center"
              >
                <button
                  type="button"
                  onClick={handleScrollToBottom}
                  className="pointer-events-auto inline-flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-white text-black shadow-[0_4px_12px_rgba(0,0,0,0.18)]"
                  aria-label="Scroll to latest"
                >
                  <ChevronDown size={16} strokeWidth={1.85} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Bottom Bar with Mic Button */}
        <div
          className="shrink-0 grid grid-cols-[1fr_auto_1fr] items-center border-t border-gray-100 bg-white"
          style={{
            paddingTop: "10px",
            paddingBottom: "max(calc(env(safe-area-inset-bottom) + 16px), 20px)",
            paddingLeft: "max(calc(env(safe-area-inset-left) + 10px), 14px)",
            paddingRight: "max(calc(env(safe-area-inset-right) + 10px), 14px)",
          }}
        >
          <div className="justify-self-start pl-2">
            {/* Usage progress bar */}
            {usageSec > 0 && (
              <div className="flex items-center gap-1.5">
                {isUsageLimited ? (
                  <>
                    <div className="w-28 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${usageSec >= 25 ? 'bg-red-400' : 'bg-amber-400'}`}
                        style={{ width: `${usagePercent}%` }}
                      />
                    </div>
                    <span className={`text-sm tabular-nums ${isLimitReached ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
                      {remainingSec}s
                    </span>
                  </>
                ) : (
                  <span className="text-sm tabular-nums text-gray-400">
                    {usageSec}s
                  </span>
                )}
              </div>
            )}
          </div>
           <div className="flex justify-center">
            <button
              onPointerDown={handleMicPointerDown}
              onClick={handleMicClick}
              disabled={isConnecting || isError}
              className="relative flex items-center justify-center w-[4rem] h-[4rem] rounded-full transition-all duration-200 active:scale-95 disabled:opacity-50"
            >
              {showRipple && (
                <span
                  className="absolute inset-0 rounded-full bg-red-400 transition-transform duration-150"
                  style={{ transform: `scale(${rippleScale})`, opacity: 0.25 }}
                />
              )}

              {isReady && (
                <span className="absolute inset-0 rounded-full bg-red-500 animate-ping opacity-20" />
              )}

              <span
                  className={`relative flex items-center justify-center w-full h-full rounded-full shadow-lg ${
                    isLimitReached
                      ? 'bg-gray-300'
                      : isReady
                        ? 'bg-red-500'
                        : isConnecting
                          ? 'bg-gray-300'
                          : 'bg-gradient-to-br from-amber-400 to-orange-500'
                  }`}
                >
                  {isConnecting ? (
                   <Loader2 size={30} className="text-white animate-spin" />
                  ) : (
                   <Play size={30} className="text-white" />
                  )}
                </span>
             </button>
          </div>
          <div className="justify-self-end">
            {usageSec > 0 && (
              <div className="flex items-center gap-1">
                {enableAutoTTS && (
                  <button
                    onClick={() => {
                      const next = !isSoundEnabled
                      setIsSoundEnabled(next)
                      if (!next) {
                        setSpeakingItem(null)
                      }
                    }}
                     className="p-2 rounded-full transition-colors hover:bg-gray-100 active:scale-90"
                      aria-label={isSoundEnabled ? muteTtsLabel : unmuteTtsLabel}
                    >
                    {isSoundEnabled ? (
                       <Volume2 size={18} className="text-amber-500" />
                    ) : (
                       <VolumeX size={18} className="text-gray-400" />
                    )}
                  </button>
                )}
                <button
                  onClick={() => setAecEnabled(!aecEnabled)}
                  className="p-2 rounded-full transition-colors hover:bg-gray-100 active:scale-90"
                  aria-label={aecEnabled ? 'Echo off (AEC on)' : 'Echo on (AEC off)'}
                  title={aecEnabled ? 'Echo off (AEC on)' : 'Echo on (AEC off)'}
                >
                  <EchoInputRouteIcon echoAllowed={!aecEnabled} />
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
})

export default LivePhoneDemo

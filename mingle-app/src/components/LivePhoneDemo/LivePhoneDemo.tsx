'use client'

import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Play, Loader2, Volume2, VolumeX } from 'lucide-react'
import PhoneFrame from './PhoneFrame'
import ChatBubble from './ChatBubble'
import type { Utterance } from './ChatBubble'
import LanguageSelector from './LanguageSelector'
import useRealtimeSTT from './useRealtimeSTT'

const VOLUME_THRESHOLD = 0.05
const LS_KEY_LANGUAGES = 'mingle_demo_languages'
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
const TTS_ORDER_WAIT_TIMEOUT_MS = 2000
const LS_KEY_TTS_DEBUG = 'mingle_tts_debug'

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

function logTtsQueue(event: string, payload?: Record<string, unknown>) {
  if (!isTtsDebugEnabled()) return
  if (payload) {
    console.log('[MingleTTSQueue]', event, payload)
    return
  }
  console.log('[MingleTTSQueue]', event)
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
  tapPlayToStartLabel: string
  usageLimitReachedLabel: string
  usageLimitRetryHintLabel: string
  connectingLabel: string
  connectionFailedLabel: string
  muteTtsLabel: string
  unmuteTtsLabel: string
}

type TtsQueueItem = {
  utteranceId: string
  audioBlob: Blob
  language: string
}

function getFirstTranslationToSpeak(utterance: Utterance, selectedLanguages: string[]) {
  const entries = Object.entries(utterance.translations)
    .filter(([lang, text]) => (
      selectedLanguages.includes(lang)
      && lang !== utterance.originalLang
      && Boolean(text?.trim())
      && utterance.translationFinalized?.[lang] === true
    ))
  if (entries.length === 0) return null
  const [language, text] = entries[0]
  return { language, text: text.trim() }
}

async function saveConversation(utterances: Utterance[], selectedLanguages: string[], usageSec: number) {
  try {
    await fetch('/api/log-conversation', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        utterances,
        selectedLanguages,
        usageSec,
        screenWidth: window.screen.width,
        screenHeight: window.screen.height,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        platform: navigator.platform,
        language: navigator.language,
        referrer: document.referrer || null,
        pathname: window.location.pathname,
        fullUrl: window.location.href,
        queryParams: window.location.search || null,
      }),
    })
  } catch { /* silently fail */ }
}

const LivePhoneDemo = forwardRef<LivePhoneDemoRef, LivePhoneDemoProps>(function LivePhoneDemo({
  onLimitReached,
  enableAutoTTS = false,
  tapPlayToStartLabel,
  usageLimitReachedLabel,
  usageLimitRetryHintLabel,
  connectingLabel,
  connectionFailedLabel,
  muteTtsLabel,
  unmuteTtsLabel,
}, ref) {
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(() => {
    if (typeof window === 'undefined') return ['en', 'ko', 'ja']
    try {
      const stored = localStorage.getItem(LS_KEY_LANGUAGES)
      return stored ? JSON.parse(stored) : ['en', 'ko', 'ja']
    } catch { return ['en', 'ko', 'ja'] }
  })
  const [langSelectorOpen, setLangSelectorOpen] = useState(false)
  const [isSoundEnabled, setIsSoundEnabled] = useState(true)
  const [speakingItem, setSpeakingItem] = useState<{ utteranceId: string, language: string } | null>(null)
  const utterancesRef = useRef<Utterance[]>([])
  const playerAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentAudioUrlRef = useRef<string | null>(null)
  const ttsPendingByUtteranceRef = useRef<Map<string, TtsQueueItem>>(new Map())
  const ttsPlayedUtteranceRef = useRef<Set<string>>(new Set())
  const ttsWaitingSinceRef = useRef<Map<string, number>>(new Map())
  const ttsOrderWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTtsProcessingRef = useRef(false)
  const isAudioPrimedRef = useRef(false)
  const ttsNeedsUnlockRef = useRef(false)
  const processTtsQueueRef = useRef<() => void>(() => {})
  const initialUtteranceIdsRef = useRef<string[] | null>(null)
  const stopClickResumeTimerIdsRef = useRef<number[]>([])

  // Persist selected languages
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_LANGUAGES, JSON.stringify(selectedLanguages))
    } catch { /* ignore */ }
  }, [selectedLanguages])

  // Ignore preloaded/history utterances for TTS queue ordering.
  // Only utterances created after this component mount should be considered for playback.
  useEffect(() => {
    const initialIds = initialUtteranceIdsRef.current ?? []
    for (const id of initialIds) {
      ttsPlayedUtteranceRef.current.add(id)
    }
  }, [])

  const ensureAudioPlayer = useCallback(() => {
    if (playerAudioRef.current) return playerAudioRef.current
    const audio = new Audio()
    audio.preload = 'auto'
    ;(audio as HTMLAudioElement & { playsInline?: boolean }).playsInline = true
    playerAudioRef.current = audio
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

  const clearTtsOrderWaitTimer = useCallback(() => {
    if (ttsOrderWaitTimerRef.current) {
      clearTimeout(ttsOrderWaitTimerRef.current)
      ttsOrderWaitTimerRef.current = null
    }
  }, [])

  const processTtsQueue = useCallback(() => {
    if (isTtsProcessingRef.current) return
    if (!enableAutoTTS || !isSoundEnabled) {
      clearTtsOrderWaitTimer()
      ttsPendingByUtteranceRef.current.clear()
      ttsWaitingSinceRef.current.clear()
      return
    }

    const nextSpeakableUtterance = utterancesRef.current.find((utterance) => {
      if (ttsPlayedUtteranceRef.current.has(utterance.id)) return false
      return Boolean(getFirstTranslationToSpeak(utterance, selectedLanguages))
    })

    if (!nextSpeakableUtterance) {
      clearTtsOrderWaitTimer()
      setSpeakingItem(null)
      return
    }

    const next = ttsPendingByUtteranceRef.current.get(nextSpeakableUtterance.id)
    if (!next) {
      const now = Date.now()
      const waitSince = ttsWaitingSinceRef.current.get(nextSpeakableUtterance.id) ?? now
      ttsWaitingSinceRef.current.set(nextSpeakableUtterance.id, waitSince)
      const waitedMs = now - waitSince
      if (waitedMs >= TTS_ORDER_WAIT_TIMEOUT_MS) {
        // Skip missing earlier TTS after timeout so later items don't block forever.
        logTtsQueue('queue.timeout_skip', {
          utteranceId: nextSpeakableUtterance.id,
          waitedMs,
        })
        ttsPlayedUtteranceRef.current.add(nextSpeakableUtterance.id)
        ttsWaitingSinceRef.current.delete(nextSpeakableUtterance.id)
        processTtsQueueRef.current()
        return
      }

      const remainMs = TTS_ORDER_WAIT_TIMEOUT_MS - waitedMs
      if (!ttsOrderWaitTimerRef.current) {
        ttsOrderWaitTimerRef.current = setTimeout(() => {
          ttsOrderWaitTimerRef.current = null
          processTtsQueueRef.current()
        }, remainMs)
      }
      return
    }

    clearTtsOrderWaitTimer()
    ttsWaitingSinceRef.current.delete(nextSpeakableUtterance.id)
    ttsPendingByUtteranceRef.current.delete(nextSpeakableUtterance.id)

    isTtsProcessingRef.current = true
    cleanupCurrentAudio()
    setSpeakingItem({ utteranceId: next.utteranceId, language: next.language })
    const audio = ensureAudioPlayer()
    const objectUrl = URL.createObjectURL(next.audioBlob)
    currentAudioUrlRef.current = objectUrl
    audio.src = objectUrl
    logTtsQueue('play.start', {
      utteranceId: next.utteranceId,
      language: next.language,
      audioBytes: next.audioBlob.size,
    })

    audio.onended = () => {
      if (currentAudioUrlRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        currentAudioUrlRef.current = null
      }
      logTtsQueue('play.ended', {
        utteranceId: next.utteranceId,
        language: next.language,
      })
      ttsPlayedUtteranceRef.current.add(next.utteranceId)
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      isTtsProcessingRef.current = false
      processTtsQueueRef.current()
    }

    audio.onerror = () => {
      if (currentAudioUrlRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        currentAudioUrlRef.current = null
      }
      logTtsQueue('play.error', {
        utteranceId: next.utteranceId,
        language: next.language,
      })
      // Keep ordering moving even if one audio payload is broken.
      ttsPlayedUtteranceRef.current.add(next.utteranceId)
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      isTtsProcessingRef.current = false
      processTtsQueueRef.current()
    }

    audio.play().catch((error) => {
      if (currentAudioUrlRef.current === objectUrl) {
        URL.revokeObjectURL(objectUrl)
        currentAudioUrlRef.current = null
      }
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      ttsNeedsUnlockRef.current = true
      ttsPendingByUtteranceRef.current.set(next.utteranceId, next)
      logTtsQueue('play.blocked', {
        utteranceId: next.utteranceId,
        language: next.language,
        error: error instanceof Error ? error.message : 'play_failed',
      })
      isTtsProcessingRef.current = false
    })
  }, [cleanupCurrentAudio, clearTtsOrderWaitTimer, enableAutoTTS, ensureAudioPlayer, isSoundEnabled, selectedLanguages])

  useEffect(() => {
    processTtsQueueRef.current = processTtsQueue
  }, [processTtsQueue])

  // Handle TTS audio received inline with translation response.
  const handleTtsAudio = useCallback((utteranceId: string, audioBlob: Blob, language: string) => {
    if (!enableAutoTTS || !isSoundEnabled) return
    if (ttsPlayedUtteranceRef.current.has(utteranceId)) return
    logTtsQueue('queue.add', { utteranceId, language, audioBytes: audioBlob.size })
    ttsPendingByUtteranceRef.current.set(utteranceId, { utteranceId, audioBlob, language })
    ttsWaitingSinceRef.current.delete(utteranceId)
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
    // Demo animation states
    isDemoAnimating,
    demoTypingText,
    demoTypingLang,
    demoTypingTranslations,
  } = useRealtimeSTT({
    languages: selectedLanguages,
    onLimitReached,
    onTtsAudio: handleTtsAudio,
    enableTts: enableAutoTTS && isSoundEnabled,
  })

  useEffect(() => {
    utterancesRef.current = utterances
    if (initialUtteranceIdsRef.current === null) {
      initialUtteranceIdsRef.current = utterances.map(utterance => utterance.id)
    }
  }, [utterances])

  // Re-evaluate queue after utterance state commit.
  // This closes the race where inline TTS arrives before translationFinalized state is rendered.
  useEffect(() => {
    if (!enableAutoTTS || !isSoundEnabled) return
    if (isTtsProcessingRef.current) return
    if (ttsPendingByUtteranceRef.current.size === 0) return
    const timerId = window.setTimeout(() => {
      processTtsQueue()
    }, 0)
    return () => {
      window.clearTimeout(timerId)
    }
  }, [enableAutoTTS, isSoundEnabled, processTtsQueue, utterances])

  // Save conversation to DB when recording stops
  const prevIsActiveRef = useRef(false)
  const sessionStartCountRef = useRef(0)
  useEffect(() => {
    if (isActive && !prevIsActiveRef.current) {
      // Recording started - remember how many utterances existed
      sessionStartCountRef.current = utterances.length
    }
    if (!isActive && prevIsActiveRef.current) {
      // Recording stopped - save new utterances from this session
      const sessionUtterances = utterances.slice(sessionStartCountRef.current)
      if (sessionUtterances.length > 0) {
        saveConversation(sessionUtterances, selectedLanguages, usageSec)
      }
    }
    prevIsActiveRef.current = isActive
  }, [isActive, utterances, selectedLanguages, usageSec])

  const primeAudioPlayback = useCallback(async (force = false): Promise<boolean> => {
    if (!force && isAudioPrimedRef.current) return true
    try {
      const player = ensureAudioPlayer()
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

  // Stop current playback when sound is disabled.
  useEffect(() => {
    if (isSoundEnabled) return
    clearTtsOrderWaitTimer()
    ttsPendingByUtteranceRef.current.clear()
    ttsPlayedUtteranceRef.current.clear()
    ttsWaitingSinceRef.current.clear()
    isTtsProcessingRef.current = false
    ttsNeedsUnlockRef.current = false
    cleanupCurrentAudio()
  }, [clearTtsOrderWaitTimer, isSoundEnabled, cleanupCurrentAudio])

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
      if (ttsPendingByUtteranceRef.current.size === 0) return
      processTtsQueue()
    }, 350)
    return () => {
      window.clearInterval(intervalId)
    }
  }, [enableAutoTTS, isSoundEnabled, processTtsQueue])

  useEffect(() => {
    const pendingByUtterance = ttsPendingByUtteranceRef.current
    const playedUtterance = ttsPlayedUtteranceRef.current
    const waitingSince = ttsWaitingSinceRef.current

    return () => {
      clearStopClickResumeTimers()
      clearTtsOrderWaitTimer()
      pendingByUtterance.clear()
      playedUtterance.clear()
      waitingSince.clear()
      isTtsProcessingRef.current = false
      ttsNeedsUnlockRef.current = false
      cleanupCurrentAudio()
    }
  }, [clearStopClickResumeTimers, clearTtsOrderWaitTimer, cleanupCurrentAudio])

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

  const handleScroll = () => {
    if (!chatRef.current) return
    const { scrollTop, scrollHeight, clientHeight } = chatRef.current
    shouldAutoScroll.current = scrollHeight - scrollTop - clientHeight < 80
  }

  useEffect(() => {
    if (chatRef.current && shouldAutoScroll.current) {
      chatRef.current.scrollTop = chatRef.current.scrollHeight
    }
  }, [utterances, partialTranscript, isConnecting, demoTypingText])

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

  return (
    <PhoneFrame>
      <div className="flex h-full min-h-0 flex-col overflow-hidden">
        {/* Header */}
        <div
          className="shrink-0 flex items-center justify-between border-b border-gray-100"
          style={{
            paddingTop: "max(calc(env(safe-area-inset-top) + 20px), 24px)",
            paddingBottom: "10px",
            paddingLeft: "max(calc(env(safe-area-inset-left) + 14px), 18px)",
            paddingRight: "max(calc(env(safe-area-inset-right) + 14px), 18px)",
          }}
        >
          <span className="text-[2.15rem] font-extrabold leading-none bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            Mingle
          </span>
          <div className="relative flex items-center gap-1.5">
            <button
              onClick={() => !isActive && setLangSelectorOpen(o => !o)}
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
              disabled={isActive}
            />
          </div>
        </div>

        {/* Chat Area */}
        <div
          ref={chatRef}
          onScroll={handleScroll}
          className="min-h-0 flex-1 overflow-y-auto no-scrollbar py-2.5 space-y-3 bg-gray-50/50"
          style={{
            paddingLeft: "max(calc(env(safe-area-inset-left) + 6px), 10px)",
            paddingRight: "max(calc(env(safe-area-inset-right) + 6px), 10px)",
          }}
        >
          <AnimatePresence mode="popLayout">
            {utterances.map((u) => (
              <ChatBubble
                key={u.id}
                utterance={u}
                selectedLanguages={selectedLanguages}
                isSpeaking={speakingItem?.utteranceId === u.id}
                speakingLanguage={speakingItem?.language ?? null}
              />
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
          <div />
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
                {enableAutoTTS && (
                  <button
                    onClick={() => {
                      setIsSoundEnabled(prev => {
                        const next = !prev
                        if (!next) {
                          setSpeakingItem(null)
                        }
                        return next
                      })
                    }}
                     className="ml-2 p-2 rounded-full transition-colors hover:bg-gray-100 active:scale-90"
                      aria-label={isSoundEnabled ? muteTtsLabel : unmuteTtsLabel}
                    >
                    {isSoundEnabled ? (
                       <Volume2 size={18} className="text-amber-500" />
                    ) : (
                       <VolumeX size={18} className="text-gray-400" />
                    )}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    </PhoneFrame>
  )
})

export default LivePhoneDemo

'use client'

import { useState, useRef, useEffect, useImperativeHandle, forwardRef, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Mic, Wifi, Battery, Signal, Loader2, Volume2, VolumeX } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import PhoneFrame from './PhoneFrame'
import ChatBubble from './ChatBubble'
import type { Utterance } from './ChatBubble'
import LanguageSelector from './LanguageSelector'
import useRealtimeSTT from './useRealtimeSTT'

const VOLUME_THRESHOLD = 0.05
const USAGE_LIMIT_SEC = 60
const LS_KEY_LANGUAGES = 'mingle_demo_languages'
const SILENT_WAV_DATA_URI = 'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQAAAAA='
const TTS_ORDER_WAIT_TIMEOUT_MS = 2000

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
}

type TtsQueueItem = {
  utteranceId: string
  audioDataUrl: string
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

const LivePhoneDemo = forwardRef<LivePhoneDemoRef, LivePhoneDemoProps>(function LivePhoneDemo({ onLimitReached, enableAutoTTS = false }, ref) {
  const { t } = useTranslation()
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
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const ttsPendingByUtteranceRef = useRef<Map<string, TtsQueueItem>>(new Map())
  const ttsPlayedUtteranceRef = useRef<Set<string>>(new Set())
  const ttsWaitingSinceRef = useRef<Map<string, number>>(new Map())
  const ttsOrderWaitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const isTtsProcessingRef = useRef(false)
  const isAudioPrimedRef = useRef(false)
  const ttsNeedsUnlockRef = useRef(false)
  const processTtsQueueRef = useRef<() => void>(() => {})

  // Persist selected languages
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_LANGUAGES, JSON.stringify(selectedLanguages))
    } catch { /* ignore */ }
  }, [selectedLanguages])

  const cleanupCurrentAudio = useCallback(() => {
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.src = ''
      currentAudioRef.current.onended = null
      currentAudioRef.current.onerror = null
      currentAudioRef.current = null
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
    const audio = new Audio(next.audioDataUrl)
    currentAudioRef.current = audio

    audio.onended = () => {
      if (currentAudioRef.current === audio) currentAudioRef.current = null
      ttsPlayedUtteranceRef.current.add(next.utteranceId)
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      isTtsProcessingRef.current = false
      processTtsQueueRef.current()
    }

    audio.onerror = () => {
      if (currentAudioRef.current === audio) currentAudioRef.current = null
      // Keep ordering moving even if one audio payload is broken.
      ttsPlayedUtteranceRef.current.add(next.utteranceId)
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      isTtsProcessingRef.current = false
      processTtsQueueRef.current()
    }

    audio.play().catch(() => {
      if (currentAudioRef.current === audio) currentAudioRef.current = null
      setSpeakingItem(prev => (prev?.utteranceId === next.utteranceId ? null : prev))
      ttsNeedsUnlockRef.current = true
      ttsPendingByUtteranceRef.current.set(next.utteranceId, next)
      isTtsProcessingRef.current = false
    })
  }, [cleanupCurrentAudio, clearTtsOrderWaitTimer, enableAutoTTS, isSoundEnabled, selectedLanguages])
  processTtsQueueRef.current = processTtsQueue

  // Handle TTS audio received inline with translation response.
  const handleTtsAudio = useCallback((utteranceId: string, audioDataUrl: string, language: string) => {
    if (!enableAutoTTS || !isSoundEnabled) return
    if (ttsPlayedUtteranceRef.current.has(utteranceId)) return
    ttsPendingByUtteranceRef.current.set(utteranceId, { utteranceId, audioDataUrl, language })
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
  utterancesRef.current = utterances

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

  const primeAudioPlayback = useCallback(async (): Promise<boolean> => {
    if (isAudioPrimedRef.current) return true
    try {
      const unlockAudio = new Audio(SILENT_WAV_DATA_URI)
      unlockAudio.volume = 0
      await unlockAudio.play()
      unlockAudio.pause()
      unlockAudio.currentTime = 0
      isAudioPrimedRef.current = true
      ttsNeedsUnlockRef.current = false
      return true
    } catch {
      return false
    }
  }, [])

  // Stop current playback when sound is disabled.
  useEffect(() => {
    if (isSoundEnabled) return
    clearTtsOrderWaitTimer()
    ttsPendingByUtteranceRef.current.clear()
    ttsPlayedUtteranceRef.current.clear()
    ttsWaitingSinceRef.current.clear()
    isTtsProcessingRef.current = false
    cleanupCurrentAudio()
    setSpeakingItem(null)
  }, [clearTtsOrderWaitTimer, isSoundEnabled, cleanupCurrentAudio])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return
      const audio = currentAudioRef.current
      if (!audio || audio.ended || !audio.paused) return

      audio.play().catch(() => {
        ttsNeedsUnlockRef.current = true
      })
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    if (!enableAutoTTS) return
    const handleUserGesture = () => {
      if (!ttsNeedsUnlockRef.current) return
      void primeAudioPlayback().then((ok) => {
        if (!ok) return
        const current = currentAudioRef.current
        if (current) {
          void current.play().then(() => {
            ttsNeedsUnlockRef.current = false
          }).catch(() => {
            ttsNeedsUnlockRef.current = true
          })
          return
        }
        ttsNeedsUnlockRef.current = false
        processTtsQueue()
      })
    }

    window.addEventListener('pointerdown', handleUserGesture, { passive: true })
    window.addEventListener('touchstart', handleUserGesture, { passive: true })
    return () => {
      window.removeEventListener('pointerdown', handleUserGesture)
      window.removeEventListener('touchstart', handleUserGesture)
    }
  }, [enableAutoTTS, primeAudioPlayback, processTtsQueue])

  useEffect(() => {
    return () => {
      clearTtsOrderWaitTimer()
      ttsPendingByUtteranceRef.current.clear()
      ttsPlayedUtteranceRef.current.clear()
      ttsWaitingSinceRef.current.clear()
      isTtsProcessingRef.current = false
      cleanupCurrentAudio()
    }
  }, [clearTtsOrderWaitTimer, cleanupCurrentAudio])

  const handleToggleLanguage = useCallback((code: string) => {
    setSelectedLanguages(prev => {
      if (prev.includes(code)) {
        return prev.filter(c => c !== code)
      }
      return [...prev, code]
    })
  }, [])

  const handleMicClick = useCallback(() => {
    if (isLimitReached) {
      onLimitReached?.()
      return
    }
    if (enableAutoTTS) {
      void primeAudioPlayback().then((ok) => {
        if (!ok) {
          ttsNeedsUnlockRef.current = true
          return
        }
        processTtsQueue()
      })
    }
    toggleRecording()
  }, [enableAutoTTS, isLimitReached, onLimitReached, primeAudioPlayback, processTtsQueue, toggleRecording])

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

  const now = new Date()
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })

  // Determine target languages for bouncing dots during partial transcript
  const detectedLang = partialLang || (utterances.length > 0 ? utterances[utterances.length - 1].originalLang : null)
  const pendingPartialLangs = partialTranscript
    ? selectedLanguages.filter(l => l !== detectedLang && !partialTranslations[l])
    : []
  const availablePartialTranslations = partialTranscript
    ? Object.entries(partialTranslations).filter(([lang]) => selectedLanguages.includes(lang) && lang !== detectedLang)
    : []

  const remainingSec = Math.max(0, USAGE_LIMIT_SEC - usageSec)
  const usagePercent = Math.min(100, (usageSec / USAGE_LIMIT_SEC) * 100)

  return (
    <PhoneFrame>
      <div className="flex flex-col h-[600px]">
        {/* Status Bar - overlaps with notch area */}
        <div className="relative z-30 flex items-center justify-between px-8 pt-2 pb-1 text-xs text-gray-500 select-none h-9">
          {isReady ? (
            <span className="flex items-center gap-1 bg-red-500 text-white font-semibold px-1.5 py-0.5 rounded-full">
              <span className="w-1.5 h-1.5 bg-white rounded-full animate-pulse" />
              {timeStr}
            </span>
          ) : (
            <span className="font-semibold">{timeStr}</span>
          )}
          <div className="flex items-center gap-1">
            <Signal className="w-3 h-3" />
            <Wifi className="w-3 h-3" />
            <Battery className="w-3 h-3" />
          </div>
        </div>

        {/* Spacer for notch */}
        <div className="h-1" />

        {/* Header */}
        <div className="flex items-center justify-between px-6 pb-2 border-b border-gray-100">
          <span className="text-base font-bold bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent">
            Mingle
          </span>
          <div className="relative flex items-center gap-1">
            <button
              onClick={() => !isActive && setLangSelectorOpen(o => !o)}
              disabled={isActive}
              className="flex items-center gap-1 disabled:opacity-60"
            >
              {selectedLanguages.map((lang) => (
                <span
                  key={lang}
                  className="text-base"
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
          className="flex-1 overflow-y-auto no-scrollbar px-3 py-3 space-y-3 bg-gray-50/50"
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
              <div className="max-w-[85%] bg-white/80 border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2">
                <p className="text-sm text-gray-400 leading-snug">
                  {partialTranscript}
                  <span className="inline-block w-1 h-3.5 ml-0.5 bg-amber-400 rounded-full animate-pulse" />
                </p>
              </div>
              {/* Available partial translations */}
              {availablePartialTranslations.map(([lang, text]) => (
                <div
                  key={lang}
                  className="ml-3 max-w-[80%] bg-amber-50/80 border border-amber-100 rounded-2xl rounded-tl-sm px-3 py-1.5"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px]">{FLAG_MAP[lang] || '🌐'}</span>
                    <span className="text-[9px] font-semibold text-amber-500 uppercase">{lang}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug">{text}</p>
                </div>
              ))}
              {/* Bouncing dots for pending partial translations */}
              {pendingPartialLangs.map((lang) => (
                <div
                  key={`partial-pending-${lang}`}
                  className="ml-3 max-w-[80%] bg-amber-50/60 border border-amber-100 rounded-2xl rounded-tl-sm px-3 py-1.5"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px]">{FLAG_MAP[lang] || '🌐'}</span>
                    <span className="text-[9px] font-semibold text-amber-400 uppercase">{lang}</span>
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
              <div className="max-w-[85%] bg-white/80 border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2">
                <div className="flex items-center gap-1.5 mb-0.5">
                  <span className="text-[10px]">{FLAG_MAP[demoTypingLang] || '🌐'}</span>
                  <span className="text-[9px] font-semibold text-gray-500 uppercase">{demoTypingLang}</span>
                </div>
                <p className="text-sm text-gray-600 leading-snug">
                  {demoTypingText}
                  <span className="inline-block w-1 h-3.5 ml-0.5 bg-amber-400 rounded-full animate-pulse" />
                </p>
              </div>
              {/* Demo translations - typed in parallel */}
              {Object.entries(demoTypingTranslations).map(([lang, text]) => (
                <motion.div
                  key={lang}
                  initial={{ opacity: 0, y: 5 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="ml-3 max-w-[80%] bg-amber-50/80 border border-amber-100 rounded-2xl rounded-tl-sm px-3 py-1.5"
                >
                  <div className="flex items-center gap-1.5 mb-0.5">
                    <span className="text-[10px]">{FLAG_MAP[lang] || '🌐'}</span>
                    <span className="text-[9px] font-semibold text-amber-500 uppercase">{lang}</span>
                  </div>
                  <p className="text-xs text-gray-500 leading-snug">
                    {text}
                    <span className="inline-block w-0.5 h-3 ml-0.5 bg-amber-300 rounded-full animate-pulse" />
                  </p>
                </motion.div>
              ))}
            </motion.div>
          )}

          {/* Empty state */}
          {utterances.length === 0 && !partialTranscript && !demoTypingText && !demoTypingLang && !isDemoAnimating && !isActive && !isError && !isLimitReached && (
            <div className="flex flex-col items-center justify-center h-full text-center text-gray-400 gap-2 pt-12">
              <Mic size={28} className="text-gray-300" />
              <p className="text-sm">Tap the mic to start</p>
            </div>
          )}

          {/* Limit reached state */}
          {isLimitReached && !isActive && (
            <div className="flex flex-col items-center justify-center text-center text-gray-400 gap-2 pt-4">
              <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-center">
                <p className="text-xs font-semibold text-amber-600 mb-1">{t('demo.limitReached')}</p>
                <p className="text-[10px] text-amber-500/80">{t('demo.limitDesc')}</p>
              </div>
            </div>
          )}

          {/* Connecting state */}
          {isConnecting && (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 size={16} className="text-amber-400 animate-spin" />
              <p className="text-xs text-gray-400">Connecting...</p>
            </div>
          )}

          {/* Error state */}
          {isError && (
            <div className="flex flex-col items-center justify-center h-full text-center text-red-400 gap-2 pt-12">
              <p className="text-sm">Connection failed. Retrying...</p>
            </div>
          )}
        </div>

        {/* Bottom Bar with Mic Button */}
        <div className="flex items-center justify-center py-3 border-t border-gray-100 bg-white">
          <div className="flex items-center gap-1.5">
            <button
              onClick={handleMicClick}
              disabled={isConnecting || isError}
              className="relative flex items-center justify-center w-12 h-12 mr-10 rounded-full transition-all duration-200 active:scale-95 disabled:opacity-50"
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
                  <Loader2 size={22} className="text-white animate-spin" />
                ) : (
                  <Mic size={22} className="text-white" />
                )}
              </span>
            </button>
            {/* Usage progress bar */}
            {usageSec > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-20 h-1 bg-gray-200 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${usageSec >= 25 ? 'bg-red-400' : 'bg-amber-400'}`}
                    style={{ width: `${usagePercent}%` }}
                  />
                </div>
                <span className={`text-[10px] tabular-nums ${isLimitReached ? 'text-red-400 font-semibold' : 'text-gray-400'}`}>
                  {remainingSec}s
                </span>
                {enableAutoTTS && (
                  <button
                    onClick={() => setIsSoundEnabled(prev => !prev)}
                    className="ml-1 p-1 rounded-full transition-colors hover:bg-gray-100 active:scale-90"
                    aria-label={isSoundEnabled ? 'Mute TTS' : 'Unmute TTS'}
                  >
                    {isSoundEnabled ? (
                      <Volume2 size={14} className="text-amber-500" />
                    ) : (
                      <VolumeX size={14} className="text-gray-400" />
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

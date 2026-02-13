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
  id: string
  language: string
  text: string
}

type TtsPlaybackResult = 'completed' | 'blocked' | 'failed'

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
  return { language, text }
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
  const [isAutoTtsArmed, setIsAutoTtsArmed] = useState(false)
  const [isSoundEnabled, setIsSoundEnabled] = useState(true)
  const [speakingItem, setSpeakingItem] = useState<{ utteranceId: string, language: string } | null>(null)
  const spokenTranslationSignatureRef = useRef(new Map<string, string>())
  const ttsQueueRef = useRef<TtsQueueItem[]>([])
  const isTtsProcessingRef = useRef(false)
  const currentAudioRef = useRef<HTMLAudioElement | null>(null)
  const currentAudioUrlRef = useRef<string | null>(null)
  const currentPlaybackSettleRef = useRef<((result: TtsPlaybackResult) => void) | null>(null)
  const isAudioPrimedRef = useRef(false)
  const ttsNeedsUnlockRef = useRef(false)

  // Persist selected languages
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_LANGUAGES, JSON.stringify(selectedLanguages))
    } catch { /* ignore */ }
  }, [selectedLanguages])

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
  })

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

  const cleanupCurrentAudio = useCallback(() => {
    currentPlaybackSettleRef.current = null
    if (currentAudioRef.current) {
      currentAudioRef.current.pause()
      currentAudioRef.current.src = ''
      currentAudioRef.current.onended = null
      currentAudioRef.current.onerror = null
      currentAudioRef.current = null
    }
    if (currentAudioUrlRef.current) {
      URL.revokeObjectURL(currentAudioUrlRef.current)
      currentAudioUrlRef.current = null
    }
  }, [])

  const playSingleTts = useCallback(async (item: TtsQueueItem): Promise<TtsPlaybackResult> => {
    ttsNeedsUnlockRef.current = false
    setSpeakingItem({ utteranceId: item.id, language: item.language })
    const response = await fetch('/api/tts/inworld', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: item.text, language: item.language }),
    })
    if (!response.ok) {
      setSpeakingItem(prev => (prev?.utteranceId === item.id ? null : prev))
      return 'failed'
    }

    const audioBlob = await response.blob()
    if (!audioBlob.size) {
      setSpeakingItem(prev => (prev?.utteranceId === item.id ? null : prev))
      return 'failed'
    }

    cleanupCurrentAudio()
    const url = URL.createObjectURL(audioBlob)
    const audio = new Audio(url)
    audio.preload = 'auto'
    currentAudioRef.current = audio
    currentAudioUrlRef.current = url

    return await new Promise<TtsPlaybackResult>((resolve) => {
      let settled = false
      const settle = (result: TtsPlaybackResult) => {
        if (settled) return
        settled = true
        currentPlaybackSettleRef.current = null
        cleanupCurrentAudio()
        setSpeakingItem(prev => (prev?.utteranceId === item.id ? null : prev))
        resolve(result)
      }

      currentPlaybackSettleRef.current = settle

      audio.onended = () => settle('completed')
      audio.onerror = () => settle('failed')
      audio.play().catch(() => {
        ttsNeedsUnlockRef.current = true
        settle('blocked')
      })
    })
  }, [cleanupCurrentAudio])

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

  const processTtsQueue = useCallback(async () => {
    if (!enableAutoTTS || !isAutoTtsArmed || isTtsProcessingRef.current) return
    isTtsProcessingRef.current = true
    try {
      while (ttsQueueRef.current.length > 0) {
        const next = ttsQueueRef.current.shift()
        if (!next) break
        const result = await playSingleTts(next)
        if (result === 'blocked') {
          ttsQueueRef.current.unshift(next)
          break
        }
      }
    } finally {
      isTtsProcessingRef.current = false
    }
  }, [enableAutoTTS, isAutoTtsArmed, playSingleTts])

  useEffect(() => {
    if (!enableAutoTTS || !isAutoTtsArmed || !isSoundEnabled) return

    for (const utterance of utterances) {
      const firstTranslation = getFirstTranslationToSpeak(utterance, selectedLanguages)
      if (!firstTranslation) continue

      const signature = `${firstTranslation.language}::${firstTranslation.text}`
      const previousSignature = spokenTranslationSignatureRef.current.get(utterance.id)
      if (previousSignature === signature) continue

      spokenTranslationSignatureRef.current.set(utterance.id, signature)
      ttsQueueRef.current.push({
        id: utterance.id,
        language: firstTranslation.language,
        text: firstTranslation.text,
      })
    }

    void processTtsQueue()
  }, [enableAutoTTS, isAutoTtsArmed, isSoundEnabled, processTtsQueue, selectedLanguages, utterances])

  // Stop current playback and clear queue when sound is disabled.
  useEffect(() => {
    if (isSoundEnabled) return
    ttsQueueRef.current = []
    spokenTranslationSignatureRef.current.clear()
    cleanupCurrentAudio()
    setSpeakingItem(null)
  }, [isSoundEnabled, cleanupCurrentAudio])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.hidden) return
      const audio = currentAudioRef.current
      if (!audio || audio.ended || !audio.paused) return

      audio.play().catch(() => {
        ttsNeedsUnlockRef.current = true
        currentPlaybackSettleRef.current?.('blocked')
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
        void processTtsQueue()
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
      ttsQueueRef.current = []
      cleanupCurrentAudio()
    }
  }, [cleanupCurrentAudio])

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
    if (enableAutoTTS && !isActive && !isAutoTtsArmed) {
      const seeded = new Map<string, string>()
      for (const utterance of utterances) {
        const firstTranslation = getFirstTranslationToSpeak(utterance, selectedLanguages)
        if (!firstTranslation) continue
        seeded.set(utterance.id, `${firstTranslation.language}::${firstTranslation.text}`)
      }
      spokenTranslationSignatureRef.current = seeded
      setIsAutoTtsArmed(true)
    }
    if (enableAutoTTS) {
      void primeAudioPlayback().then((ok) => {
        if (!ok) {
          ttsNeedsUnlockRef.current = true
          return
        }
        void processTtsQueue()
      })
    }
    toggleRecording()
  }, [enableAutoTTS, isActive, isAutoTtsArmed, isLimitReached, onLimitReached, primeAudioPlayback, processTtsQueue, selectedLanguages, toggleRecording, utterances])

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

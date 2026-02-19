'use client'

import { memo } from 'react'
import { motion } from 'framer-motion'

const FLAG_MAP: Record<string, string> = {
  en: '🇺🇸', ko: '🇰🇷', ja: '🇯🇵', zh: '🇨🇳', es: '🇪🇸',
  fr: '🇫🇷', de: '🇩🇪', ru: '🇷🇺', pt: '🇧🇷', ar: '🇸🇦',
  hi: '🇮🇳', th: '🇹🇭', vi: '🇻🇳', it: '🇮🇹', id: '🇮🇩',
  tr: '🇹🇷', pl: '🇵🇱', nl: '🇳🇱', sv: '🇸🇪', ms: '🇲🇾',
}

const RECENT_THRESHOLD_MS = 90_000

function getBaseLang(): string {
  if (typeof navigator === 'undefined') return 'en'
  return (navigator.language || 'en').split('-')[0].toLowerCase()
}

function formatSecondsAgo(sec: number, lang: string): string {
  switch (lang) {
    case 'ko': return `${sec}초 전`
    case 'ja': return `${sec}秒前`
    case 'zh': return `${sec}秒前`
    case 'es': return `hace ${sec}s`
    case 'fr': return `il y a ${sec}s`
    case 'de': return `vor ${sec}s`
    case 'pt': return `há ${sec}s`
    case 'it': return `${sec}s fa`
    default: return `${sec}s ago`
  }
}

function formatTimestamp(createdAtMs: number | undefined): string {
  if (!createdAtMs) return ''
  const now = Date.now()
  const created = new Date(createdAtMs)
  const current = new Date(now)

  if (
    created.getFullYear() === current.getFullYear() &&
    created.getMonth() === current.getMonth() &&
    created.getDate() === current.getDate() &&
    created.getHours() === current.getHours() &&
    created.getMinutes() === current.getMinutes()
  ) {
    const sec = Math.max(0, Math.floor((now - createdAtMs) / 1000))
    return formatSecondsAgo(sec, getBaseLang())
  }

  return `${created.getHours().toString().padStart(2, '0')}:${created.getMinutes().toString().padStart(2, '0')}`
}

export interface Utterance {
  id: string
  originalText: string
  originalLang: string
  translations: Record<string, string>
  translationFinalized?: Record<string, boolean>
  createdAtMs?: number
}

interface ChatBubbleProps {
  utterance: Utterance
  selectedLanguages: string[]
  isSpeaking?: boolean
  speakingLanguage?: string | null
}

function SpeakingIndicator() {
  return (
    <div className="flex items-end gap-0.5" aria-label="tts-speaking">
      <span className="w-0.5 h-2 bg-amber-400/90 rounded-full animate-pulse" style={{ animationDelay: '0ms' }} />
      <span className="w-0.5 h-3 bg-amber-500 rounded-full animate-pulse" style={{ animationDelay: '120ms' }} />
      <span className="w-0.5 h-2.5 bg-amber-400/90 rounded-full animate-pulse" style={{ animationDelay: '240ms' }} />
      <span className="w-0.5 h-1.5 bg-amber-300/90 rounded-full animate-pulse" style={{ animationDelay: '360ms' }} />
    </div>
  )
}

function ChatBubble({ utterance, selectedLanguages, isSpeaking = false, speakingLanguage = null }: ChatBubbleProps) {
  const flag = FLAG_MAP[utterance.originalLang] || '🌐'
  // Use selectedLanguages order (= language list order) for consistent display ordering.
  const targetLangs = selectedLanguages.filter(lang => lang !== utterance.originalLang)
  const translationEntries = targetLangs
    .filter(lang => utterance.translations[lang])
    .map(lang => ({
      lang,
      text: utterance.translations[lang],
      isFinalized: utterance.translationFinalized?.[lang] !== false,
    }))
  const pendingLangs = targetLangs
    .filter(lang => !utterance.translations[lang])

  const timestamp = formatTimestamp(utterance.createdAtMs)

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-1"
    >
      {/* Original bubble */}
        <div className="max-w-[85%] bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3.5 py-2 shadow-sm">
        <div className="flex items-center justify-between mb-0.5">
          <div className="flex items-center gap-1.5">
            <span className="text-base">{flag}</span>
            <span className="text-xs font-semibold text-gray-400 uppercase">
              {utterance.originalLang}
            </span>
          </div>
          {timestamp && (
            <span className="text-[10px] text-gray-300 tabular-nums whitespace-nowrap">{timestamp}</span>
          )}
        </div>
        <p className="text-sm text-gray-900 leading-relaxed">{utterance.originalText}</p>
      </div>

      {/* Translation bubbles */}
      {translationEntries.map(({ lang, text, isFinalized }) => (
        <div
          key={lang}
          className={`ml-2.5 max-w-[80%] rounded-2xl rounded-tl-sm px-3.5 py-2 transition-colors ${
            isFinalized
              ? 'bg-amber-50 border border-amber-100'
              : 'bg-gray-100/80 border border-gray-200'
          }`}
        >
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-base">{FLAG_MAP[lang] || '🌐'}</span>
              <span className={`text-xs font-semibold uppercase ${
                isFinalized ? 'text-amber-500' : 'text-gray-400'
              }`}>{lang}</span>
              {!isFinalized && (
                <span className="inline-block w-1 h-1 rounded-full bg-gray-400 animate-pulse" />
              )}
            </div>
            {isSpeaking && speakingLanguage === lang && <SpeakingIndicator />}
          </div>
          <p className={`text-sm leading-relaxed ${
            isFinalized ? 'text-gray-700' : 'text-gray-500'
          }`}>{text}</p>
        </div>
      ))}
      {/* Bouncing dots for pending translations */}
      {pendingLangs.map((lang) => (
        <div
          key={`pending-${lang}`}
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
  )
}

function chatBubbleAreEqual(prev: ChatBubbleProps, next: ChatBubbleProps): boolean {
  // Always re-render recent utterances so relative timestamp stays fresh
  const createdAtMs = next.utterance.createdAtMs
  if (createdAtMs && (Date.now() - createdAtMs) < RECENT_THRESHOLD_MS) return false

  if (prev.isSpeaking !== next.isSpeaking) return false
  if (prev.speakingLanguage !== next.speakingLanguage) return false

  if (prev.selectedLanguages !== next.selectedLanguages) {
    if (prev.selectedLanguages.length !== next.selectedLanguages.length) return false
    for (let i = 0; i < prev.selectedLanguages.length; i++) {
      if (prev.selectedLanguages[i] !== next.selectedLanguages[i]) return false
    }
  }

  if (prev.utterance !== next.utterance) {
    const pu = prev.utterance
    const nu = next.utterance
    if (pu.id !== nu.id) return false
    if (pu.originalText !== nu.originalText) return false
    if (pu.originalLang !== nu.originalLang) return false
    if (pu.translations !== nu.translations) {
      const pk = Object.keys(pu.translations)
      const nk = Object.keys(nu.translations)
      if (pk.length !== nk.length) return false
      for (const k of pk) {
        if (pu.translations[k] !== nu.translations[k]) return false
      }
    }
    if (pu.translationFinalized !== nu.translationFinalized) {
      const pf = pu.translationFinalized || {}
      const nf = nu.translationFinalized || {}
      const pk = Object.keys(pf)
      const nk = Object.keys(nf)
      if (pk.length !== nk.length) return false
      for (const k of pk) {
        if (pf[k] !== nf[k]) return false
      }
    }
  }

  return true
}

export default memo(ChatBubble, chatBubbleAreEqual)

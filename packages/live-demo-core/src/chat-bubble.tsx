'use client'

import { motion } from 'framer-motion'

const FLAG_MAP: Record<string, string> = {
  en: '🇺🇸', ko: '🇰🇷', ja: '🇯🇵', zh: '🇨🇳', es: '🇪🇸',
  fr: '🇫🇷', de: '🇩🇪', ru: '🇷🇺', pt: '🇧🇷', ar: '🇸🇦',
  hi: '🇮🇳', th: '🇹🇭', vi: '🇻🇳', it: '🇮🇹', id: '🇮🇩',
  tr: '🇹🇷', pl: '🇵🇱', nl: '🇳🇱', sv: '🇸🇪', ms: '🇲🇾',
}

export interface Utterance {
  id: string
  originalText: string
  originalLang: string
  translations: Record<string, string>
  translationFinalized?: Record<string, boolean>
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

export default function ChatBubble({ utterance, selectedLanguages, isSpeaking = false, speakingLanguage = null }: ChatBubbleProps) {
  const flag = FLAG_MAP[utterance.originalLang] || '🌐'
  // Use selectedLanguages order (= language list order) for consistent display ordering.
  const targetLangs = selectedLanguages.filter(lang => lang !== utterance.originalLang)
  const translationEntries = targetLangs
    .filter(lang => utterance.translations[lang])
    .map(lang => [lang, utterance.translations[lang]] as const)
  const pendingLangs = targetLangs
    .filter(lang => !utterance.translations[lang])

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col gap-1"
    >
      {/* Original bubble */}
      <div className="max-w-[85%] bg-white border border-gray-200 rounded-2xl rounded-tl-sm px-3 py-2 shadow-sm">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-xs">{flag}</span>
          <span className="text-[10px] font-semibold text-gray-400 uppercase">
            {utterance.originalLang}
          </span>
        </div>
        <p className="text-sm text-gray-900 leading-snug">{utterance.originalText}</p>
      </div>

      {/* Translation bubbles */}
      {translationEntries.map(([lang, text]) => (
        <div
          key={lang}
          className="ml-3 max-w-[80%] bg-amber-50 border border-amber-100 rounded-2xl rounded-tl-sm px-3 py-1.5"
        >
          <div className="flex items-center justify-between mb-0.5">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px]">{FLAG_MAP[lang] || '🌐'}</span>
              <span className="text-[9px] font-semibold text-amber-500 uppercase">{lang}</span>
            </div>
            {isSpeaking && speakingLanguage === lang && <SpeakingIndicator />}
          </div>
          <p className="text-xs text-gray-700 leading-snug">{text}</p>
        </div>
      ))}
      {/* Bouncing dots for pending translations */}
      {pendingLangs.map((lang) => (
        <div
          key={`pending-${lang}`}
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
  )
}

'use client'

import { useRef, useEffect } from 'react'

const LANGUAGES = [
  { code: 'en', flag: '🇺🇸', name: 'English' },
  { code: 'ko', flag: '🇰🇷', name: '한국어' },
  { code: 'ja', flag: '🇯🇵', name: '日本語' },
  { code: 'zh', flag: '🇨🇳', name: '中文' },
  { code: 'es', flag: '🇪🇸', name: 'Español' },
  { code: 'fr', flag: '🇫🇷', name: 'Français' },
  { code: 'de', flag: '🇩🇪', name: 'Deutsch' },
  { code: 'ru', flag: '🇷🇺', name: 'Русский' },
  { code: 'pt', flag: '🇧🇷', name: 'Português' },
  { code: 'ar', flag: '🇸🇦', name: 'العربية' },
  { code: 'hi', flag: '🇮🇳', name: 'हिन्दी' },
  { code: 'th', flag: '🇹🇭', name: 'ไทย' },
  { code: 'vi', flag: '🇻🇳', name: 'Tiếng Việt' },
  { code: 'it', flag: '🇮🇹', name: 'Italiano' },
  { code: 'id', flag: '🇮🇩', name: 'Bahasa' },
]

const MAX_LANGS = 5
const MIN_LANGS = 2

interface LanguageSelectorProps {
  isOpen: boolean
  onClose: () => void
  selectedLanguages: string[]
  onToggleLanguage: (code: string) => void
  disabled?: boolean
}

export default function LanguageSelector({
  isOpen,
  onClose,
  selectedLanguages,
  onToggleLanguage,
  disabled,
}: LanguageSelectorProps) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose()
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [isOpen, onClose])

  if (!isOpen) return null

  const atMax = selectedLanguages.length >= MAX_LANGS
  const atMin = selectedLanguages.length <= MIN_LANGS

  return (
    <div
      ref={ref}
      className="absolute right-0 top-full mt-1 z-50 bg-white border border-gray-200 rounded-xl shadow-xl py-1.5 w-44 max-h-[280px] overflow-y-auto"
    >
      {LANGUAGES.map((lang) => {
        const isSelected = selectedLanguages.includes(lang.code)
        const isDisabled = disabled || (!isSelected && atMax) || (isSelected && atMin)
        return (
          <button
            key={lang.code}
            onClick={() => !isDisabled && onToggleLanguage(lang.code)}
            disabled={isDisabled}
            className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ${
              isDisabled && !isSelected
                ? 'opacity-40 cursor-not-allowed'
                : isDisabled && isSelected
                  ? 'opacity-70 cursor-not-allowed'
                  : 'hover:bg-gray-50'
            }`}
          >
            <span className={`w-4 h-4 rounded border flex items-center justify-center text-[10px] ${
              isSelected ? 'bg-amber-500 border-amber-500 text-white' : 'border-gray-300'
            }`}>
              {isSelected && '✓'}
            </span>
            <span>{lang.flag}</span>
            <span className="text-gray-700 truncate">{lang.name}</span>
          </button>
        )
      })}
    </div>
  )
}

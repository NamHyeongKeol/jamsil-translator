'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Download } from 'lucide-react'
import { languages } from '@/lib/i18n'

interface LanguageSelectorProps {
  version?: string
}

function LanguageSelector({ version }: LanguageSelectorProps) {
  const { i18n } = useTranslation()
  const router = useRouter()
  const [isOpen, setIsOpen] = useState(false)
  const currentLang = languages.find(l => l.code === i18n.language) || languages[0]
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    // 약간의 딜레이를 주어 현재 클릭 이벤트가 처리된 후 리스너 추가
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-sm text-text-primary"
      >
        <span>{currentLang.flag}</span>
        <span className="hidden sm:inline">{currentLang.name}</span>
        <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute right-0 top-full mt-2 py-2 bg-white border border-gray-200 rounded-xl shadow-xl z-[70] min-w-[160px] max-h-[400px] overflow-y-auto"
          >
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  i18n.changeLanguage(lang.code)
                  // URL 경로 업데이트 - 항상 locale 포함 (영어도 /en 포함)
                  // router.push를 사용해 Next.js 라우터가 params를 올바르게 업데이트하도록 함
                  const basePath = version ? `/${version}` : ''
                  const newPath = `${basePath}/${lang.code}`
                  router.push(newPath)
                  setIsOpen(false)
                }}
                className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-3 transition-colors ${lang.code === i18n.language ? 'text-accent-primary' : 'text-text-secondary'}`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

export interface NavBarProps {
  version?: string
  openModal: (buttonType: string) => void
}

export default function NavBar({ version, openModal }: NavBarProps) {
  const { t } = useTranslation()

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 py-5 bg-white/80 backdrop-blur-xl border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
        <div className="text-2xl font-extrabold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
          Mingle
        </div>
        <div className="flex items-center gap-4">
          <LanguageSelector version={version} />
          <button
            onClick={() => openModal('nav')}
            className="px-6 py-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-lg font-semibold text-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent-primary/30 transition-all text-sm flex items-center gap-2"
          >
            <Download size={16} />
            {t('nav.cta')}
          </button>
        </div>
      </div>
    </nav>
  )
}

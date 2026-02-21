'use client'

import { useEffect, useState } from 'react'
import i18n from '@/lib/i18n'

const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi', 'th', 'vi']
const versions = ['normal', 'flirting', 'working', 'gaming']

export function Providers({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    // URL 경로에서 언어 감지
    // /normal/ko, /ko, /normal 등 다양한 형태 지원
    const pathname = window.location.pathname
    const segments = pathname.split('/').filter(Boolean)

    let detectedLocale: string | null = null

    if (segments.length >= 2) {
      // /normal/ko 형태
      const first = segments[0]
      const second = segments[1]
      if (versions.includes(first) && locales.includes(second)) {
        detectedLocale = second
      }
    } else if (segments.length === 1) {
      // /ko 또는 /normal 형태
      const first = segments[0]
      if (locales.includes(first)) {
        detectedLocale = first
      }
      // /normal만 있으면 브라우저 언어 감지
      if (versions.includes(first)) {
        const browserLang = navigator.language.split('-')[0]
        // 브라우저 언어가 지원 목록에 있으면 사용, 아니면 기본값(en)
        if (locales.includes(browserLang)) {
          detectedLocale = browserLang
        } else if (locales.includes(navigator.language)) {
          // zh-CN, zh-TW 같은 전체 언어 코드 확인
          detectedLocale = navigator.language
        }
      }
    } else {
      // 루트 경로 "/" - 브라우저 언어 감지
      const browserLang = navigator.language.split('-')[0]
      if (locales.includes(browserLang)) {
        detectedLocale = browserLang
      } else if (locales.includes(navigator.language)) {
        detectedLocale = navigator.language
      }
    }

    if (detectedLocale) {
      i18n.changeLanguage(detectedLocale)
    }

    setMounted(true)
  }, [])

  // Show loading state until client-side hydration is complete
  // This prevents hydration mismatch from i18n language detection
  if (!mounted) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="text-center">
          <div className="text-4xl font-extrabold bg-gradient-to-r from-amber-500 to-orange-500 bg-clip-text text-transparent mb-4">
            Mingle
          </div>
          <div className="w-8 h-8 border-4 border-amber-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  return <>{children}</>
}

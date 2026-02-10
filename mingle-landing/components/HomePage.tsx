'use client'

import { useState, useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { logButtonClick, logVisit } from '@/components/sections/tracking'
import NavBar from '@/components/sections/NavBar'
import EmailModal from '@/components/sections/EmailModal'
import Footer from '@/components/sections/Footer'
import { versionConfigs, defaultVersion, sectionRegistry } from '@/configs/versions'

interface HomePageProps {
  version?: string
  locale?: string
}

export default function HomePage({ version, locale }: HomePageProps) {
  const { i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [isModalOpen, setIsModalOpen] = useState(false)

  // locale prop이 있으면 해당 언어로 설정
  useEffect(() => {
    if (locale && locale !== i18n.language) {
      i18n.changeLanguage(locale)
    }
  }, [locale, i18n])

  // Log page visit on mount (ref guard prevents Strict Mode double-fire)
  const visitLoggedRef = useRef(false)
  useEffect(() => {
    if (visitLoggedRef.current) return
    visitLoggedRef.current = true
    logVisit(i18n.language)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openModal = (buttonType: string) => {
    logButtonClick(buttonType)
    setIsModalOpen(true)
  }
  const closeModal = () => setIsModalOpen(false)

  // 버전 설정 가져오기 (없으면 기본 버전 사용)
  const config = versionConfigs[version || defaultVersion] ?? versionConfigs[defaultVersion]

  return (
    <div className="min-h-screen" dir={isRTL ? 'rtl' : 'ltr'}>
      <EmailModal isOpen={isModalOpen} onClose={closeModal} />

      {/* Navigation - 항상 표시 */}
      <NavBar version={version} openModal={openModal} />

      {/* 버전 설정에 따라 섹션을 동적으로 렌더링 */}
      {config.sections.map((section) => {
        const Component = sectionRegistry[section.id]
        if (!Component) {
          console.warn(`Unknown section: ${section.id}`)
          return null
        }
        return (
          <Component
            key={section.id}
            openModal={openModal}
            version={version}
          />
        )
      })}

      {/* Footer - 항상 표시 */}
      <Footer />
    </div>
  )
}

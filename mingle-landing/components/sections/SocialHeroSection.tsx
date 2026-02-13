'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Download, ChevronDown } from 'lucide-react'
import Image from 'next/image'
import { logButtonClick } from '@/components/sections/tracking'

export interface SocialHeroSectionProps {
  version?: string
  openModal: (buttonType: string) => void
}

// CJK 언어 판별 (한국어, 일본어, 중국어 등)
const CJK_LANGUAGES = ['ko', 'ja', 'zh-CN', 'zh-TW', 'zh', 'th', 'hi', 'ar']

export default function SocialHeroSection({ version, openModal }: SocialHeroSectionProps) {
  const { t, i18n } = useTranslation()

  const isGaming = version === 'gaming'
  const isCJK = CJK_LANGUAGES.includes(i18n.language)

  // CJK는 원래 크기 유지, 알파벳 언어만 축소
  const titleFontSize = isCJK
    ? 'clamp(2.5rem, 5vw, 4rem)'
    : 'clamp(2rem, 4vw, 3.2rem)'

  // i18n 키: gaming이면 socialHero.gaming.xxx, 아니면 socialHero.xxx
  const tKey = (key: string) =>
    isGaming
      ? t(`socialHero.gaming.${key}`, { defaultValue: t(`socialHero.${key}`) })
      : t(`socialHero.${key}`)

  const handleTryDemo = () => {
    logButtonClick('try-translator')
    const demoSection = document.getElementById('demo-section')
    if (demoSection) {
      // 충분히 내려가서 폰 중간~하단(마이크 버튼)이 보이도록
      const rect = demoSection.getBoundingClientRect()
      const y = rect.top + window.scrollY + rect.height * 0.15
      window.scrollTo({ top: y, behavior: 'smooth' })
    }
  }

  return (
    <section className="min-h-screen flex items-center pt-32 lg:pt-10 pb-20 px-6 relative overflow-hidden bg-gradient-to-b lg:bg-gradient-to-r from-orange-50/60 via-white to-white">
      {/* 배경 데코레이션 */}
      <div className="absolute top-[-200px] right-[-100px] w-[600px] h-[600px] bg-[radial-gradient(circle,rgba(99,102,241,0.06)_0%,transparent_70%)] pointer-events-none" />
      <div className="absolute bottom-[-100px] left-[-100px] w-[500px] h-[500px] bg-[radial-gradient(circle,rgba(245,158,11,0.06)_0%,transparent_70%)] pointer-events-none" />

      <div className="max-w-6xl mx-auto w-full grid lg:grid-cols-2 gap-12 items-center">
        {/* 왼쪽: 텍스트 */}
        <motion.div
          className="relative z-10"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="font-black leading-[1.1] mb-6">
            <span
              className="block text-text-primary"
              style={{ fontSize: titleFontSize }}
            >
              {tKey('title1')}
            </span>
            <span
              className="block bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent"
              style={{ fontSize: titleFontSize }}
            >
              {tKey('title2')}
            </span>
          </h1>
          <p className="text-lg lg:text-xl text-text-secondary max-w-lg mb-12 leading-relaxed">
            {tKey('subtitle')}
          </p>

          {/* 버튼 영역 */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4">
            <button
              onClick={() => openModal('social-hero')}
              className="group relative px-6 py-3.5 lg:px-8 lg:py-4 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all duration-300"
            >
              <div className="flex items-center justify-center gap-3">
                <Download size={20} className="text-white" />
                <div className="text-left">
                  <div className="text-white font-bold text-base leading-tight">
                    {tKey('ctaMain')}
                  </div>
                  <div className="text-white/80 text-xs mt-0.5">
                    {tKey('ctaSub')}
                  </div>
                </div>
              </div>
            </button>

            {/* gaming 버전에서만 테스트 버튼 표시 */}
            {isGaming && (
              <button
                onClick={handleTryDemo}
                className="px-6 py-3.5 lg:px-8 lg:py-4 bg-white border-2 border-accent-primary rounded-xl font-semibold text-accent-primary flex items-center justify-center gap-2 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent-primary/20 transition-all"
              >
                <ChevronDown size={20} className="animate-bounce" />
                {tKey('tryDemo')}
              </button>
            )}
          </div>
        </motion.div>

        {/* 오른쪽: 이미지 */}
        <motion.div
          initial={{ opacity: 0, x: 60 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="flex justify-center lg:justify-end"
        >
          <div className="relative w-full max-w-md lg:max-w-lg">
            <div className="absolute inset-0 bg-gradient-to-br from-accent-primary/10 to-accent-secondary/10 rounded-3xl blur-3xl" />
            <Image
              src={isGaming ? '/gaming-hero.png' : '/social-hero.jpeg'}
              alt={isGaming ? 'Mingle Gaming' : 'Mingle Social'}
              width={600}
              height={700}
              className="relative rounded-3xl object-cover w-full h-auto"
              priority
            />
          </div>
        </motion.div>
      </div>
    </section>
  )
}

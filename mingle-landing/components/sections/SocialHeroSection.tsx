'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import Image from 'next/image'

export interface SocialHeroSectionProps {
  version?: string
  openModal: (buttonType: string) => void
}

export default function SocialHeroSection({ openModal }: SocialHeroSectionProps) {
  const { t } = useTranslation()

  return (
    <section className="min-h-screen flex items-center pt-24 lg:pt-10 pb-20 px-6 relative overflow-hidden bg-gradient-to-br from-white via-white to-gray-50">
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
              style={{ fontSize: 'clamp(3rem, 6vw, 5rem)' }}
            >
              {t('socialHero.title1')}
            </span>
            <span
              className="block bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent"
              style={{ fontSize: 'clamp(3rem, 6vw, 5rem)' }}
            >
              {t('socialHero.title2')}
            </span>
          </h1>
          <p className="text-lg md:text-xl text-text-secondary max-w-lg mb-12 leading-relaxed">
            {t('socialHero.subtitle')}
          </p>

          {/* 다운로드 버튼 */}
          <button
            onClick={() => openModal('social-hero')}
            className="group relative px-10 py-5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-2xl hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all duration-300"
          >
            <div className="flex items-center gap-3">
              <Download size={22} className="text-white" />
              <div className="text-left">
                <div className="text-white font-bold text-lg leading-tight">
                  {t('socialHero.ctaMain')}
                </div>
                <div className="text-white/80 text-sm mt-0.5">
                  {t('socialHero.ctaSub')}
                </div>
              </div>
            </div>
          </button>
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
              src="/social-hero.jpeg"
              alt="Mingle Social"
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

'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Mic, Download } from 'lucide-react'
import LivePhoneDemo from '@/components/LivePhoneDemo/LivePhoneDemo'
import type { LivePhoneDemoRef } from '@/components/LivePhoneDemo/LivePhoneDemo'
import { logButtonClick } from '@/components/sections/tracking'

export interface HeroSectionProps {
  version?: string
  openModal: (buttonType: string) => void
}

export default function HeroSection({ version, openModal }: HeroSectionProps) {
  const { t } = useTranslation()
  const demoRef = useRef<LivePhoneDemoRef>(null)

  return (
    <section className="min-h-screen flex items-center justify-center pt-24 lg:pt-10 pb-20 px-6 relative overflow-hidden bg-gradient-to-br from-white via-white to-gray-100">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(245,158,11,0.08)_0%,transparent_70%)] pointer-events-none" />
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 items-center">
        <motion.div
          className="relative z-10"
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8 }}
        >
          <h1 className="font-extrabold leading-tight my-4 text-text-primary">
            <span className="block text-3xl md:text-4xl lg:text-5xl mb-4">
              {t(`hero.${version}.title1`, { defaultValue: t('hero.title1') })}
            </span>
            <span className="block text-4xl md:text-5xl lg:text-6xl bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
              {t(`hero.${version}.title2`, { defaultValue: t('hero.title2') })}
            </span>
          </h1>
          <p className="text-lg md:text-xl text-text-secondary max-w-xl mb-10 leading-relaxed">
            {t(`hero.${version}.subtitle`, { defaultValue: t('hero.subtitle') })}
          </p>
          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={() => openModal('hero')}
              className="px-8 py-4 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-xl font-semibold text-white flex items-center gap-2 hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all"
            >
              <Download size={20} />
              {t('hero.cta')}
            </button>
            <button
              onClick={() => {
                logButtonClick('try-translator')
                demoRef.current?.startRecording()
              }}
              className="px-8 py-4 bg-white border-2 border-accent-primary rounded-xl font-semibold text-accent-primary flex items-center gap-2 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent-primary/20 transition-all"
            >
              <Mic size={20} />
              {t('hero.tryDemo')}
            </button>
          </div>
        </motion.div>

        <motion.div
          initial={{ opacity: 0, y: 40 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, delay: 0.2 }}
          className="flex justify-center lg:justify-end pt-10"
        >
          <LivePhoneDemo ref={demoRef} onLimitReached={() => openModal('demo-limit')} />
        </motion.div>
      </div>
    </section>
  )
}

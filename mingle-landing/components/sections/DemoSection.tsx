'use client'

import { useRef } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Mic } from 'lucide-react'
import LivePhoneDemo from '@/components/LivePhoneDemo/LivePhoneDemo'
import type { LivePhoneDemoRef } from '@/components/LivePhoneDemo/LivePhoneDemo'
import { logButtonClick } from '@/components/sections/tracking'

export interface DemoSectionProps {
  openModal: (buttonType: string) => void
}

export default function DemoSection({ openModal }: DemoSectionProps) {
  const { t } = useTranslation()
  const demoRef = useRef<LivePhoneDemoRef>(null)

  const handleStartDemo = () => {
    logButtonClick('demo-section-try')
    demoRef.current?.startRecording()
  }

  return (
    <section
      id="demo-section"
      className="pt-10 pb-24 md:pt-16 md:pb-32 px-6 bg-gradient-to-br from-white via-white to-gray-100"
    >
      <div className="max-w-xl mx-auto">
        {/* 테스트 해보기 버튼 */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
          className="flex justify-center mb-8"
        >
          <button
            onClick={handleStartDemo}
            className="px-8 py-3.5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-2xl font-semibold text-white flex items-center gap-2 hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all duration-300"
          >
            <Mic size={20} />
            {t('socialHero.gaming.tryDemo', { defaultValue: t('hero.tryDemo') })}
          </button>
        </motion.div>

        {/* LivePhoneDemo */}
        <motion.div
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.8 }}
          className="flex flex-col items-center"
        >
          <LivePhoneDemo
            ref={demoRef}
            onLimitReached={() => openModal('demo-limit')}
            enableAutoTTS
          />
          <p className="mt-4 text-center text-xs text-gray-500">
            {t('socialHero.gaming.demoDisclaimer')}
          </p>
        </motion.div>
      </div>
    </section>
  )
}

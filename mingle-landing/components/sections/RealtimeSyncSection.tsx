'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { ArrowRight } from 'lucide-react'
import { fadeInUp } from '@/components/sections/shared'

function RealtimeSyncDisplay() {
  const { t } = useTranslation()

  return (
    <div className="flex flex-col items-center gap-4">
      {/* Phone images row */}
      <div className="relative flex items-start justify-center gap-2 md:gap-8 lg:gap-12 w-full max-w-3xl mx-auto">
        {/* Left Phone - My Screen */}
        <div className="flex-1 flex flex-col items-center max-w-[280px]">
          <span className="text-xs font-semibold text-accent-primary mb-2">{t('realtimeSync.myScreen')}</span>
          <img
            src="/chat_by_bear.png"
            alt={t('realtimeSync.myScreen')}
            className="w-full h-auto rounded-2xl"
          />
        </div>

        {/* Center Sync Indicator - desktop only */}
        <div className="hidden md:flex flex-col items-center gap-3 shrink-0 self-center">
          <div className="flex items-center gap-1">
            <ArrowRight size={16} className="text-accent-primary rotate-180" />
            <ArrowRight size={16} className="text-accent-primary" />
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1 bg-accent-primary/10 rounded-full border border-accent-primary/20">
            <span className="w-1.5 h-1.5 bg-accent-primary rounded-full animate-pulse" />
            <span className="text-xs font-medium text-accent-primary whitespace-nowrap">
              {t('realtimeSync.syncStatus')}
            </span>
          </div>
        </div>

        {/* Right Phone - Their Screen */}
        <div className="flex-1 flex flex-col items-center max-w-[280px]">
          <span className="text-xs font-semibold text-gray-500 mb-2">{t('realtimeSync.theirScreen')}</span>
          <img
            src="/chat_by_cat.png"
            alt={t('realtimeSync.theirScreen')}
            className="w-full h-auto rounded-2xl"
          />
        </div>
      </div>
    </div>
  )
}

export default function RealtimeSyncSection() {
  const { t } = useTranslation()

  return (
    <section className="py-32 px-6 bg-bg-secondary">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-12 md:mb-16"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('realtimeSync.label')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-text-primary">
            {t('realtimeSync.title')}
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            {t('realtimeSync.description')}
          </p>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <RealtimeSyncDisplay />
        </motion.div>
      </div>
    </section>
  )
}

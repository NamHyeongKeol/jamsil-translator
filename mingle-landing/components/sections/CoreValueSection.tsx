'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { UserPlus, ArrowRight, Send } from 'lucide-react'
import { fadeInUp } from '@/components/sections/shared'

function PartyScenario() {
  const { t } = useTranslation()

  return (
    <div className="relative bg-gradient-to-br from-amber-50 to-orange-50 rounded-3xl p-8 border border-amber-200 overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 right-0 w-64 h-64 bg-amber-200/30 rounded-full blur-3xl" />
      <div className="absolute bottom-0 left-0 w-48 h-48 bg-orange-200/30 rounded-full blur-3xl" />

      <div className="relative grid md:grid-cols-5 gap-4 items-center">
        {/* Step 1: Party */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-white border-2 border-amber-300 flex items-center justify-center mx-auto mb-3 text-2xl shadow-md">
            🎉
          </div>
          <h4 className="font-semibold mb-1 text-sm text-text-primary">{t('partyScenario.step1Title')}</h4>
          <p className="text-xs text-text-muted">
            {t('partyScenario.step1Desc')}
          </p>
        </div>

        {/* Arrow 1 */}
        <div className="hidden md:flex items-center justify-center">
          <ArrowRight size={24} className="text-amber-400" />
        </div>

        {/* Step 2: Invite - EMPHASIZED */}
        <div className="text-center relative">
          {/* Glow effect */}
          <div className="absolute inset-0 bg-accent-primary/20 rounded-2xl blur-xl" />
          <div className="relative bg-white/90 backdrop-blur-sm rounded-2xl p-4 border-2 border-accent-primary shadow-lg shadow-accent-primary/20">
            <div className="w-20 h-20 rounded-full bg-gradient-to-br from-accent-primary to-accent-secondary flex items-center justify-center mx-auto mb-3 text-3xl animate-pulse">
              <UserPlus size={36} className="text-white" />
            </div>
            <h4 className="font-bold mb-1 text-accent-primary-dark">{t('partyScenario.step2Title')}</h4>
            <p className="text-xs text-text-secondary">
              {t('partyScenario.step2Desc')}
            </p>
            <p className="text-xs text-accent-primary font-medium mt-1">
              {t('partyScenario.step2Highlight')}
            </p>
          </div>
        </div>

        {/* Arrow 2 */}
        <div className="hidden md:flex items-center justify-center">
          <ArrowRight size={24} className="text-amber-400" />
        </div>

        {/* Step 3: Continue */}
        <div className="text-center">
          <div className="w-16 h-16 rounded-full bg-white border-2 border-accent-green/50 flex items-center justify-center mx-auto mb-3 text-2xl shadow-md">
            💬
          </div>
          <h4 className="font-semibold mb-1 text-sm text-text-primary">{t('partyScenario.step3Title')}</h4>
          <p className="text-xs text-text-muted">
            {t('partyScenario.step3Desc')}
          </p>
        </div>
      </div>

      {/* Bottom result */}
      <div className="mt-8 pt-6 border-t border-amber-200">
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-amber-200 shadow-sm">
            <span className="text-lg">🎊</span>
            <span className="text-sm text-text-primary">{t('partyScenario.resultFriends')}</span>
          </div>
          <div className="flex items-center gap-2 bg-accent-primary/10 px-4 py-2 rounded-full border border-accent-primary/30">
            <Send size={16} className="text-accent-primary" />
            <span className="text-sm text-accent-primary font-medium">{t('partyScenario.resultSaved')}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function CoreValueSection() {
  const { t } = useTranslation()

  return (
    <section className="py-32 px-6 bg-bg-secondary">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-16"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('coreValue.label')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-text-primary">{t('coreValue.title')}</h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            {t('coreValue.desc1')} {t('coreValue.desc2')}
          </p>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
          className="mb-16"
        >
          <PartyScenario />
        </motion.div>

      </div>
    </section>
  )
}

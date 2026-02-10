'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { X, Check } from 'lucide-react'
import { fadeInUp } from '@/components/sections/shared'

function BeforeAfter() {
  const { t } = useTranslation()

  const problemIcons = ['⏳', '❓', '👋', '🔄']
  const solutionIcons = ['⚡', '🎯', '💬', '🌐']
  
  const problems = (t('beforeAfter.problems', { returnObjects: true }) as string[]).map((text, i) => ({
    icon: problemIcons[i],
    text
  }))

  const solutions = (t('beforeAfter.solutions', { returnObjects: true }) as string[]).map((text, i) => ({
    icon: solutionIcons[i],
    text
  }))

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Before */}
      <div className="relative">
        <div className="absolute -top-3 left-4 px-3 py-1 bg-accent-pink/20 text-accent-pink text-sm font-semibold rounded-full">
          {t('beforeAfter.beforeLabel')}
        </div>
        <div className="bg-white rounded-2xl p-6 border border-accent-pink/30 h-full shadow-lg">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">😰</div>
            <p className="text-text-muted text-sm">
              {t('beforeAfter.beforeDesc')}
            </p>
          </div>
          <div className="space-y-4">
            {problems.map((problem, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                <span className="text-xl">{problem.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <X size={14} className="text-accent-pink" />
                    <span className="text-accent-pink text-xs font-medium">{t('beforeAfter.problemLabel')} {i + 1}</span>
                  </div>
                  <p className="text-sm text-text-secondary">{problem.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* After */}
      <div className="relative">
        <div className="absolute -top-3 left-4 px-3 py-1 bg-accent-green/20 text-accent-green text-sm font-semibold rounded-full">
          {t('beforeAfter.afterLabel')}
        </div>
        <div className="bg-white rounded-2xl p-6 border border-accent-green/30 h-full shadow-lg">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">😊</div>
            <p className="text-text-muted text-sm">
              {t('beforeAfter.afterDesc')}
            </p>
          </div>
          <div className="space-y-4">
            {solutions.map((solution, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-green-50 rounded-xl border border-green-100">
                <span className="text-xl">{solution.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Check size={14} className="text-accent-green" />
                    <span className="text-accent-green text-xs font-medium">{t('beforeAfter.solutionLabel')} {i + 1}</span>
                  </div>
                  <p className="text-sm text-text-primary">{solution.text}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

export default function ProblemSection() {
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
            {t('problem.label')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 leading-tight text-text-primary">
            {t('problem.title1')}<br />{t('problem.title2')}
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            {t('problem.description')}
          </p>
        </motion.div>

        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
          className="mb-16"
        >
          <BeforeAfter />
        </motion.div>

      </div>
    </section>
  )
}

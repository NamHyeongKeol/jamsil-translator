'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Mic, Users, Zap, Globe } from 'lucide-react'
import { fadeInUp } from '@/components/sections/shared'

export default function FeaturesSection() {
  const { t } = useTranslation()

  return (
    <section className="py-32 px-6">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-20"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('features.label')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-text-primary">{t('features.title')}</h2>
          <p className="text-lg text-text-secondary max-w-xl mx-auto">
            {t('features.subtitle')}
          </p>
        </motion.div>
        <motion.div
          className="grid md:grid-cols-2 lg:grid-cols-4 gap-6"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={{ animate: { transition: { staggerChildren: 0.1 } } }}
        >
          {[
            { icon: Zap, color: 'amber', key: 'realtime' },
            { icon: Mic, color: 'green', key: 'continuous' },
            { icon: Globe, color: 'orange', key: 'autoDetect' },
            { icon: Users, color: 'pink', key: 'speaker' }
          ].map((feature, i) => (
            <motion.div
              key={i}
              className="bg-white rounded-2xl p-8 border border-gray-100 hover:-translate-y-2 hover:border-accent-primary/30 hover:shadow-xl transition-all"
              variants={fadeInUp}
            >
              <div className={`w-14 h-14 rounded-2xl flex items-center justify-center mb-6 ${
                feature.color === 'amber' ? 'bg-amber-100 text-amber-600' :
                feature.color === 'green' ? 'bg-green-100 text-green-600' :
                feature.color === 'orange' ? 'bg-orange-100 text-orange-600' :
                'bg-pink-100 text-pink-600'
              }`}>
                <feature.icon size={28} />
              </div>
              <h3 className="text-xl font-semibold mb-3 text-text-primary">{t(`features.${feature.key}.title`)}</h3>
              <p className="text-text-secondary text-sm leading-relaxed">{t(`features.${feature.key}.desc`)}</p>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

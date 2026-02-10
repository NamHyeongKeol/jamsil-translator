'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fadeInUp } from '@/components/sections/shared'

export default function TalkToWorldSection() {
  const { t } = useTranslation()

  return (
    <section className="pt-32 pb-0 px-6 overflow-hidden">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('talkToWorld.label')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-text-primary">{t('talkToWorld.title')}</h2>
          <p className="text-lg md:text-xl text-text-secondary max-w-2xl mx-auto">
            {t('talkToWorld.subtitle')} {t('talkToWorld.description')}
          </p>
        </motion.div>
      </div>
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.8 }}
        className="flex justify-center mb-16"
      >
        <img
          src="/talk-to-the-world.png"
          alt="Talk to the World"
          className="w-full md:w-2/3 h-auto"
        />
      </motion.div>
    </section>
  )
}

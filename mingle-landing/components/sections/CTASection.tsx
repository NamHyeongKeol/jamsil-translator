'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { Download } from 'lucide-react'
import { fadeInUp } from '@/components/sections/shared'

export interface CTASectionProps {
  openModal: (buttonType: string) => void
}

export default function CTASection({ openModal }: CTASectionProps) {
  const { t } = useTranslation()

  return (
    <section className="py-32 px-6 bg-gradient-to-br from-amber-50 to-orange-50 text-center">
      <div className="max-w-3xl mx-auto">
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <h2 className="text-3xl md:text-5xl font-bold mb-6 text-text-primary">
            {t('cta.title1')}<br />{t('cta.title2')}{' '}
            <span className="bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
              {t('cta.title2Highlight')}
            </span>
          </h2>
          <p className="text-lg text-text-secondary mb-12">
            {t('cta.subtitle')}
          </p>
          <button
            onClick={() => openModal('cta')}
            className="px-10 py-5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-xl font-semibold text-lg text-white flex items-center gap-3 mx-auto hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all"
          >
            <Download size={24} />
            {t('cta.button')}
          </button>
        </motion.div>
      </div>
    </section>
  )
}

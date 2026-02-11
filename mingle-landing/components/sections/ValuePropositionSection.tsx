'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { fadeInUp } from '@/components/sections/shared'

export interface ValuePropositionSectionProps {
  version?: string
}

export default function ValuePropositionSection({ version }: ValuePropositionSectionProps) {
  const { t } = useTranslation()

  // version-specific i18n key fallback
  const vt = (key: string) =>
    t(`valueProposition.${version}.${key}`, { defaultValue: t(`valueProposition.${key}`) })

  return (
    <section className="py-12 md:py-20 px-6 bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-6xl mx-auto">
        <motion.div
          className="text-center mb-8 md:mb-12"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {vt('label')}
          </div>
          <h2 className="text-3xl md:text-4xl font-bold mb-6 text-text-primary">
            {vt('title')}
            {' '}
            <span className="bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">{vt('titleHighlight')}</span>
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto">
            {vt('description')}
          </p>
        </motion.div>

        <motion.div
          className="flex justify-center gap-0 md:gap-10"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={{ animate: { transition: { staggerChildren: 0.15 } } }}
        >
          {/* Conversation Demo Video */}
          <motion.div
            className="relative flex-1 md:flex-none"
            variants={fadeInUp}
          >
            <div className="overflow-hidden rounded-2xl aspect-[9/16] md:aspect-auto md:h-[500px] lg:h-[600px]">
              <video
                className="h-full w-full object-contain"
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="/demo_conversation.mp4" type="video/mp4" />
              </video>
            </div>
          </motion.div>

          {/* App Demo Video */}
          <motion.div
            className="relative flex-1 md:flex-none"
            variants={fadeInUp}
          >
            <div className="overflow-hidden rounded-2xl aspect-[9/16] md:aspect-auto md:h-[500px] lg:h-[600px]">
              <video
                className="h-full w-full object-contain"
                autoPlay
                loop
                muted
                playsInline
              >
                <source src="/demo_app.mp4" type="video/mp4" />
              </video>
            </div>
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}


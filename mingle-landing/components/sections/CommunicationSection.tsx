'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { fadeInUp } from '@/components/sections/shared'

export default function CommunicationSection() {
  const { t } = useTranslation()

  return (
    <section className="py-24 md:py-32 px-6 bg-bg-secondary">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* 왼쪽: 이미지 */}
        <motion.div
          className="order-2 lg:order-1"
          initial={{ opacity: 0, x: -40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          <div className="max-w-sm lg:max-w-md mx-auto rounded-2xl overflow-hidden">
            <Image
              src="/facetime.avif"
              alt="Video Call"
              width={500}
              height={400}
              className="w-full h-auto object-cover"
            />
          </div>
        </motion.div>

        {/* 오른쪽: 텍스트 */}
        <motion.div
          className="order-1 lg:order-2"
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('communication.label')}
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 text-text-primary leading-tight">
            {t('communication.title')}
          </h2>
          <p className="text-lg text-text-secondary leading-relaxed max-w-lg">
            {t('communication.description')}
          </p>
        </motion.div>
      </div>
    </section>
  )
}

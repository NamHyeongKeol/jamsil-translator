'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'
import { fadeInUp } from '@/components/sections/shared'

export default function ConnectSection() {
  const { t } = useTranslation()

  return (
    <section className="py-24 md:py-32 px-6 bg-white">
      <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 lg:gap-16 items-center">
        {/* 왼쪽: 텍스트 */}
        <motion.div
          initial="initial"
          whileInView="animate"
          viewport={{ once: true }}
          variants={fadeInUp}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('connect.label')}
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 text-text-primary leading-tight">
            {t('connect.title1')}<br />
            {t('connect.title2')}
          </h2>
          <p className="text-lg text-text-secondary leading-relaxed max-w-lg">
            {t('connect.description')}
          </p>
        </motion.div>

        {/* 오른쪽: 겹치는 이미지 두 장 */}
        <motion.div
          className="flex items-center"
          initial={{ opacity: 0, x: 40 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.7 }}
        >
          {/* Conversations - 왼쪽, 우측 일부가 matching 아래로 겹침 */}
          <div className="w-[55%] -mr-[10%] z-10 rounded-2xl overflow-hidden flex-shrink-0">
            <Image
              src="/conversations.png"
              alt="Conversations"
              width={500}
              height={700}
              className="w-full h-full object-cover"
            />
          </div>
          {/* Matching - 오른쪽, conversations 위에 올라감 */}
          <div className="w-[55%] z-20 rounded-2xl overflow-hidden shadow-xl flex-shrink-0">
            <Image
              src="/matching.png"
              alt="Matching"
              width={400}
              height={600}
              className="w-full h-full object-cover"
            />
          </div>
        </motion.div>
      </div>
    </section>
  )
}

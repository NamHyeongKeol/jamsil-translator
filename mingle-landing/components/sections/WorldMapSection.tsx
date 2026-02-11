'use client'

import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import Image from 'next/image'

export default function WorldMapSection() {
  const { t } = useTranslation()

  return (
    <section className="relative py-24 md:py-32 px-6 overflow-hidden bg-white">
      {/* 배경 월드맵 */}
      <div className="absolute inset-0 flex items-center justify-center opacity-25 pointer-events-none">
        <Image
          src="/world-map.png"
          alt=""
          width={1400}
          height={700}
          className="w-full max-w-6xl h-auto object-contain"
        />
      </div>

      {/* 텍스트 */}
      <div className="relative z-10 max-w-6xl mx-auto text-center mb-16">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ duration: 0.6 }}
        >
          <div className="text-sm font-semibold text-accent-primary uppercase tracking-wider mb-4">
            {t('worldMap.label')}
          </div>
          <h2 className="text-3xl md:text-4xl lg:text-5xl font-bold mb-6 text-text-primary leading-tight">
            {t('worldMap.title')}
          </h2>
          <p className="text-lg text-text-secondary max-w-2xl mx-auto leading-relaxed">
            {t('worldMap.description')}
          </p>
        </motion.div>
      </div>

      {/* 가로 스크롤 이미지 2줄 */}
      <div className="relative z-10 space-y-3">
        {/* 줄 1 - 왼쪽으로 이동 */}
        <div className="overflow-hidden">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white to-transparent z-20 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white to-transparent z-20 pointer-events-none" />
          <motion.div
            className="flex gap-0"
            animate={{ x: [0, -600] }}
            transition={{
              x: { repeat: Infinity, repeatType: 'loop', duration: 30, ease: 'linear' },
            }}
          >
            {[...Array(6)].map((_, i) => (
              <div key={`h1-${i}`} className="flex-shrink-0 h-[70px] md:h-[90px] relative">
                <img
                  src="/horizontal1.png"
                  alt="User connections"
                  className="h-full w-auto"
                />
                {/* 프로필 오버레이 */}
                {[
                  { flag: '🇺🇸', name: 'David', age: 29 },
                  { flag: '🇩🇪', name: 'Ava', age: 25 },
                  { flag: '🇰🇷', name: '지수', age: 28 },
                  { flag: '🇯🇵', name: 'なずき', age: 20 },
                  { flag: '🇨🇦', name: 'Amy', age: 23 },
                  { flag: '🇺🇸', name: 'Grace', age: 30 },
                ].map((p, j) => (
                  <div
                    key={j}
                    className="absolute bottom-0 flex items-end justify-center pl-3 md:pl-12 pb-1 md:pb-1.5"
                    style={{ left: `${(j / 6) * 100}%`, width: `${100 / 6}%` }}
                  >
                    <div className="bg-gradient-to-t from-black/50 to-transparent absolute inset-x-0 bottom-0 h-[60%] pointer-events-none" />
                    <span className="relative text-white font-extrabold text-[10px] md:text-[13px] drop-shadow-md">
                      {p.flag} {p.name}, {p.age}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </div>

        {/* 줄 2 - 오른쪽으로 이동 */}
        <div className="overflow-hidden relative">
          <div className="absolute left-0 top-0 bottom-0 w-16 bg-gradient-to-r from-white to-transparent z-20 pointer-events-none" />
          <div className="absolute right-0 top-0 bottom-0 w-16 bg-gradient-to-l from-white to-transparent z-20 pointer-events-none" />
          <motion.div
            className="flex gap-0"
            animate={{ x: [-600, 0] }}
            transition={{
              x: { repeat: Infinity, repeatType: 'loop', duration: 35, ease: 'linear' },
            }}
          >
            {[...Array(6)].map((_, i) => (
              <div key={`h2-${i}`} className="flex-shrink-0 h-[70px] md:h-[90px] relative">
                <img
                  src="/horizontal2.png"
                  alt="Global connections"
                  className="h-full w-auto"
                />
                {/* 프로필 오버레이 */}
                {[
                  { flag: '🇰🇷', name: '현우', age: 32 },
                  { flag: '🇬🇧', name: 'Olivia', age: 23 },
                  { flag: '🇳🇬', name: 'Ella', age: 25 },
                  { flag: '🇸🇪', name: 'Lily', age: 30 },
                  { flag: '🇸🇦', name: 'سارة', age: 22 },
                  { flag: '🇺🇸', name: 'Joshua', age: 29 },
                ].map((p, j) => (
                  <div
                    key={j}
                    className="absolute bottom-0 flex items-end justify-center pl-3 md:pl-14 pb-1 md:pb-1.5"
                    style={{ left: `${(j / 6) * 100}%`, width: `${100 / 6}%` }}
                  >
                    <div className="bg-gradient-to-t from-black/50 to-transparent absolute inset-x-0 bottom-0 h-[60%] pointer-events-none" />
                    <span className="relative text-white font-extrabold text-[10px] md:text-[13px] drop-shadow-md">
                      {p.flag} {p.name}, {p.age}
                    </span>
                  </div>
                ))}
              </div>
            ))}
          </motion.div>
        </div>
      </div>
    </section>
  )
}

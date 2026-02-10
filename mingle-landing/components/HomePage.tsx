'use client'

import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Mic,
  Users,
  Zap,
  Globe,
  UserPlus,
  ArrowRight,
  X,
  ChevronDown,
  Download,
  Check,
  Send
} from 'lucide-react'
import { languages } from '@/lib/i18n'
import LivePhoneDemo from '@/components/LivePhoneDemo/LivePhoneDemo'
import type { LivePhoneDemoRef } from '@/components/LivePhoneDemo/LivePhoneDemo'

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
}

// Collect common user/browser info for all tracking calls
function getUserInfo() {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
    language: navigator.language,
    referrer: document.referrer || null,
    pathname: window.location.pathname,
    fullUrl: window.location.href,
    queryParams: window.location.search || null,
  }
}

// Log button click with user info
async function logButtonClick(buttonType: string) {
  try {
    await fetch('/api/log-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buttonType,
        ...getUserInfo(),
      }),
    })
  } catch (error) {
    // Silently fail - don't block user interaction
    console.error('Failed to log click:', error)
  }
}

// Log page visit with user info
async function logVisit(pageLanguage: string) {
  try {
    await fetch('/api/log-visit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getUserInfo(),
        pageLanguage,
      }),
    })
  } catch (error) {
    console.error('Failed to log visit:', error)
  }
}

interface LanguageSelectorProps {
  version?: string
}

function LanguageSelector({ version }: LanguageSelectorProps) {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const currentLang = languages.find(l => l.code === i18n.language) || languages[0]
  const dropdownRef = useRef<HTMLDivElement>(null)

  // 바깥 클릭 시 드롭다운 닫기
  useEffect(() => {
    if (!isOpen) return

    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false)
      }
    }

    // 약간의 딜레이를 주어 현재 클릭 이벤트가 처리된 후 리스너 추가
    setTimeout(() => {
      document.addEventListener('click', handleClickOutside)
    }, 0)

    return () => {
      document.removeEventListener('click', handleClickOutside)
    }
  }, [isOpen])

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 transition-colors text-sm text-text-primary"
      >
        <span>{currentLang.flag}</span>
        <span className="hidden sm:inline">{currentLang.name}</span>
        <ChevronDown size={16} className={`transition-transform ${isOpen ? 'rotate-180' : ''}`} />
      </button>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="absolute right-0 top-full mt-2 py-2 bg-white border border-gray-200 rounded-xl shadow-xl z-[70] min-w-[160px] max-h-[400px] overflow-y-auto"
          >
            {languages.map((lang) => (
              <button
                key={lang.code}
                onClick={() => {
                  i18n.changeLanguage(lang.code)
                  // URL 경로 업데이트 - version이 있으면 포함
                  const basePath = version ? `/${version}` : ''
                  const newPath = lang.code === 'en' ? basePath || '/' : `${basePath}/${lang.code}`
                  window.history.pushState({}, '', newPath)
                  setIsOpen(false)
                }}
                className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-3 transition-colors ${lang.code === i18n.language ? 'text-accent-primary' : 'text-text-secondary'}`}
              >
                <span>{lang.flag}</span>
                <span>{lang.name}</span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}


function EmailModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [feedback, setFeedback] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setStatus('loading')
    try {
      const res = await fetch('/api/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, feedback: feedback.trim() || null, ...getUserInfo() }),
      })
      if (res.ok) {
        setStatus('success')
        setEmail('')
        setFeedback('')
      } else {
        setStatus('error')
      }
    } catch {
      setStatus('error')
    }
  }

  if (!isOpen) return null

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      />
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 20 }}
        className="relative bg-white border border-gray-200 rounded-2xl p-8 max-w-md w-full shadow-2xl"
      >
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-400 hover:text-gray-600">
          <X size={24} />
        </button>

        {status === 'success' ? (
          <div className="text-center py-8">
            <div className="w-16 h-16 rounded-full bg-accent-green/20 flex items-center justify-center mx-auto mb-4">
              <Check size={32} className="text-accent-green" />
            </div>
            <h3 className="text-2xl font-bold mb-2 text-text-primary">{t('modal.success')}</h3>
            <p className="text-text-muted mb-6">{t('modal.successDesc')}</p>
            <button onClick={onClose} className="px-6 py-3 bg-gray-100 rounded-xl font-semibold hover:bg-gray-200 transition-colors text-text-primary">
              {t('modal.close')}
            </button>
          </div>
        ) : (
          <>
            <div className="text-center mb-6">
              <div className="w-16 h-16 rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary flex items-center justify-center mx-auto mb-4">
                <Download size={32} className="text-white" />
              </div>
              <h3 className="text-2xl font-bold mb-2 text-text-primary">{t('modal.title')}</h3>
              <p className="text-text-muted">{t('modal.subtitle')}</p>
            </div>
            <form onSubmit={handleSubmit}>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('modal.placeholder')}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-3 focus:outline-none focus:border-accent-primary transition-colors text-text-primary"
                required
              />
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                placeholder={t('modal.feedbackPlaceholder')}
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 focus:outline-none focus:border-accent-primary transition-colors text-text-primary resize-none"
                rows={3}
              />
              {status === 'error' && (
                <p className="text-accent-pink text-sm mb-4">{t('modal.error')}</p>
              )}
              <button
                type="submit"
                disabled={status === 'loading'}
                className="w-full py-4 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-xl font-semibold text-white flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-accent-primary/30 transition-all disabled:opacity-50"
              >
                {status === 'loading' ? '...' : t('modal.submit')}
              </button>
            </form>
          </>
        )}
      </motion.div>
    </div>
  )
}


// Before/After Comparison with 3 problems and 3 solutions
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

// Party Scenario Illustration with emphasized invite step
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

// Real-time Sync Section - Two phone screenshots with sync indicator
function RealtimeSyncSection() {
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

interface HomePageProps {
  version?: string
  locale?: string
}

export default function HomePage({ version, locale }: HomePageProps) {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [isModalOpen, setIsModalOpen] = useState(false)
  const demoRef = useRef<LivePhoneDemoRef>(null)

  // locale prop이 있으면 해당 언어로 설정
  useEffect(() => {
    if (locale && locale !== i18n.language) {
      i18n.changeLanguage(locale)
    }
  }, [locale, i18n])

  // Log page visit on mount (ref guard prevents Strict Mode double-fire)
  const visitLoggedRef = useRef(false)
  useEffect(() => {
    if (visitLoggedRef.current) return
    visitLoggedRef.current = true
    logVisit(i18n.language)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const openModal = (buttonType: string) => {
    logButtonClick(buttonType)
    setIsModalOpen(true)
  }
  const closeModal = () => setIsModalOpen(false)

  return (
    <div className="min-h-screen" dir={isRTL ? 'rtl' : 'ltr'}>
      <EmailModal isOpen={isModalOpen} onClose={closeModal} />

      {/* Navigation */}
      <nav className="fixed top-0 left-0 right-0 z-50 py-5 bg-white/80 backdrop-blur-xl border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6 flex justify-between items-center">
          <div className="text-2xl font-extrabold bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
            Mingle
          </div>
          <div className="flex items-center gap-4">
            <LanguageSelector version={version} />
            <button
              onClick={() => openModal('nav')}
              className="px-6 py-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-lg font-semibold text-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent-primary/30 transition-all text-sm flex items-center gap-2"
            >
              <Download size={16} />
              {t('nav.cta')}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center pt-24 lg:pt-10 pb-20 px-6 relative overflow-hidden bg-gradient-to-br from-white via-white to-gray-100">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(245,158,11,0.08)_0%,transparent_70%)] pointer-events-none" />
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 items-center">
          <motion.div
            className="relative z-10"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <h1 className="font-extrabold leading-tight my-4 text-text-primary">
              <span className="block text-3xl md:text-4xl lg:text-5xl mb-4">
                {t(`hero.${version}.title1`, { defaultValue: t('hero.title1') })}
              </span>
              <span className="block text-4xl md:text-5xl lg:text-6xl bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                {t(`hero.${version}.title2`, { defaultValue: t('hero.title2') })}
              </span>
            </h1>
            <p className="text-lg md:text-xl text-text-secondary max-w-xl mb-10 leading-relaxed">
              {t(`hero.${version}.subtitle`, { defaultValue: t('hero.subtitle') })}
            </p>
            <div className="flex flex-wrap items-center gap-4">
              <button
                onClick={() => openModal('hero')}
                className="px-8 py-4 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-xl font-semibold text-white flex items-center gap-2 hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all"
              >
                <Download size={20} />
                {t('hero.cta')}
              </button>
              <button
                onClick={() => {
                  logButtonClick('try-translator')
                  demoRef.current?.startRecording()
                }}
                className="px-8 py-4 bg-white border-2 border-accent-primary rounded-xl font-semibold text-accent-primary flex items-center gap-2 hover:-translate-y-1 hover:shadow-xl hover:shadow-accent-primary/20 transition-all"
              >
                <Mic size={20} />
                {t('hero.tryDemo')}
              </button>
            </div>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="flex justify-center lg:justify-end pt-10"
          >
            <LivePhoneDemo ref={demoRef} onLimitReached={() => openModal('demo-limit')} />
          </motion.div>
        </div>
      </section>

      {/* Value Proposition Section */}
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
              {t('valueProposition.label')}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold mb-6 text-text-primary">
              {t('valueProposition.title')}
            </h2>
            <p className="text-lg text-text-secondary max-w-2xl mx-auto">
              {t('valueProposition.description')}
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

      {/* Problem Section with Before/After */}
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

      {/* Features Section */}
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

      {/* Real-time Sync Section */}
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
            <RealtimeSyncSection />
          </motion.div>
        </div>
      </section>

      {/* Core Value - Socializing with Party Scenario */}
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

      {/* Talk to the World */}
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

      {/* Final CTA */}
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

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-gray-100 text-center bg-white">
        <p className="text-text-muted text-sm">{t('footer.copyright')}</p>
      </footer>
    </div>
  )
}

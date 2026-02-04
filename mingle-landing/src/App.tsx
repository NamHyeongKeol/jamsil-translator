import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import {
  Mic,
  Languages,
  Users,
  MessageSquare,
  Zap,
  Globe,
  UserPlus,
  ArrowRight,
  X,
  Sparkles,
  ChevronDown,
  Download,
  Check,
  Send
} from 'lucide-react'
import { languages } from './i18n'
import './index.css'

const fadeInUp = {
  initial: { opacity: 0, y: 30 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.6 }
}

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001'

function LanguageSelector() {
  const { i18n } = useTranslation()
  const [isOpen, setIsOpen] = useState(false)
  const currentLang = languages.find(l => l.code === i18n.language) || languages[0]

  return (
    <div className="relative">
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
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute right-0 top-full mt-2 py-2 bg-white border border-gray-200 rounded-xl shadow-xl z-50 min-w-[160px] max-h-[400px] overflow-y-auto"
            >
              {languages.map((lang) => (
                <button
                  key={lang.code}
                  onClick={() => { i18n.changeLanguage(lang.code); setIsOpen(false) }}
                  className={`w-full px-4 py-2 text-left text-sm hover:bg-gray-50 flex items-center gap-3 transition-colors ${lang.code === i18n.language ? 'text-accent-primary' : 'text-text-secondary'}`}
                >
                  <span>{lang.flag}</span>
                  <span>{lang.name}</span>
                </button>
              ))}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  )
}

function EmailModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setStatus('loading')
    try {
      const res = await fetch(`${API_URL}/api/subscribe`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })
      if (res.ok) {
        setStatus('success')
        setEmail('')
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
                className="w-full px-4 py-3 bg-gray-50 border border-gray-200 rounded-xl mb-4 focus:outline-none focus:border-accent-primary transition-colors text-text-primary"
                required
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

// Phone Mockup Component - Uses actual screenshot image
function PhoneMockup() {
  return (
    <div className="relative mx-auto w-[320px]">
      <img
        src="/image.png"
        alt="Mingle App Screenshot"
        className="w-full h-auto rounded-3xl shadow-2xl"
      />
    </div>
  )
}

// Before/After Comparison with 3 problems and 3 solutions
function BeforeAfter() {
  const { i18n } = useTranslation()
  const isKorean = i18n.language === 'ko'

  const problems = [
    { icon: '⏳', text: isKorean ? '한 문장씩 번역하느라 대화 흐름이 끊김' : 'Conversation flow breaks while translating sentence by sentence' },
    { icon: '❓', text: isKorean ? '3명 이상 대화에서 누가 뭐라 했는지 구분 불가' : "Can't tell who said what in group conversations of 3+ people" },
    { icon: '👋', text: isKorean ? '헤어지고 나면 연락할 방법이 없음' : 'No way to stay in touch after parting' }
  ]

  const solutions = [
    { icon: '⚡', text: isKorean ? '실시간으로 끊김 없이 자연스러운 대화' : 'Real-time seamless natural conversation' },
    { icon: '🎯', text: isKorean ? '음성 인식으로 발화자별 대화 자동 분리' : 'Voice recognition auto-separates by speaker' },
    { icon: '💬', text: isKorean ? '대화록이 채팅방으로 변환, 언제든 연락 가능' : 'Conversation becomes chat room, stay connected' }
  ]

  return (
    <div className="grid md:grid-cols-2 gap-8">
      {/* Before */}
      <div className="relative">
        <div className="absolute -top-3 left-4 px-3 py-1 bg-accent-pink/20 text-accent-pink text-sm font-semibold rounded-full">
          Before
        </div>
        <div className="bg-white rounded-2xl p-6 border border-accent-pink/30 h-full shadow-lg">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">😰</div>
            <p className="text-text-muted text-sm">
              {isKorean ? '번역 앱으로 한 문장씩...' : 'Translating one sentence at a time...'}
            </p>
          </div>
          <div className="space-y-4">
            {problems.map((problem, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-red-50 rounded-xl border border-red-100">
                <span className="text-xl">{problem.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <X size={14} className="text-accent-pink" />
                    <span className="text-accent-pink text-xs font-medium">Problem {i + 1}</span>
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
          With Mingle
        </div>
        <div className="bg-white rounded-2xl p-6 border border-accent-green/30 h-full shadow-lg">
          <div className="text-center mb-6">
            <div className="text-4xl mb-2">😊</div>
            <p className="text-text-muted text-sm">
              {isKorean ? '끊김 없는 자연스러운 대화!' : 'Seamless natural conversation!'}
            </p>
          </div>
          <div className="space-y-4">
            {solutions.map((solution, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-green-50 rounded-xl border border-green-100">
                <span className="text-xl">{solution.icon}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <Check size={14} className="text-accent-green" />
                    <span className="text-accent-green text-xs font-medium">Solution {i + 1}</span>
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
  const { i18n } = useTranslation()
  const isKorean = i18n.language === 'ko'

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
          <h4 className="font-semibold mb-1 text-sm text-text-primary">{isKorean ? '1. 파티에서 만남' : '1. Meet at Party'}</h4>
          <p className="text-xs text-text-muted">
            {isKorean ? 'Mingle로 실시간 번역' : 'Real-time translation'}
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
            <h4 className="font-bold mb-1 text-accent-primary-dark">{isKorean ? '2. 앱에 초대!' : '2. Invite to App!'}</h4>
            <p className="text-xs text-text-secondary">
              {isKorean ? '상대를 앱에 초대하면' : 'Invite your new friend'}
            </p>
            <p className="text-xs text-accent-primary font-medium mt-1">
              {isKorean ? '대화록이 채팅방으로!' : 'Chat room created!'}
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
          <h4 className="font-semibold mb-1 text-sm text-text-primary">{isKorean ? '3. 계속 연락!' : '3. Stay Connected!'}</h4>
          <p className="text-xs text-text-muted">
            {isKorean ? '언제든 다시 대화' : 'Chat anytime'}
          </p>
        </div>
      </div>

      {/* Bottom result */}
      <div className="mt-8 pt-6 border-t border-amber-200">
        <div className="flex items-center justify-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 bg-white px-4 py-2 rounded-full border border-amber-200 shadow-sm">
            <span className="text-lg">🎊</span>
            <span className="text-sm text-text-primary">{isKorean ? '파티 후에도 친구로!' : 'Friends after the party!'}</span>
          </div>
          <div className="flex items-center gap-2 bg-accent-green/10 px-4 py-2 rounded-full border border-accent-green/30">
            <Send size={16} className="text-accent-green" />
            <span className="text-sm text-accent-green font-medium">{isKorean ? '번역된 대화 기록 영구 저장' : 'Translated history saved forever'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function App() {
  const { t, i18n } = useTranslation()
  const isRTL = i18n.language === 'ar'
  const [isModalOpen, setIsModalOpen] = useState(false)

  const openModal = () => setIsModalOpen(true)
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
            <LanguageSelector />
            <button
              onClick={openModal}
              className="px-6 py-2.5 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-lg font-semibold text-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-accent-primary/30 transition-all text-sm flex items-center gap-2"
            >
              <Download size={16} />
              {t('nav.cta')}
            </button>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <section className="min-h-screen flex items-center justify-center pt-32 pb-20 px-6 relative overflow-hidden">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-[800px] h-[800px] bg-[radial-gradient(circle,rgba(245,158,11,0.1)_0%,transparent_70%)] pointer-events-none" />
        <div className="max-w-6xl mx-auto grid lg:grid-cols-2 gap-12 items-center">
          <motion.div
            className="relative z-10"
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8 }}
          >
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent-primary/10 border border-accent-primary/30 rounded-full text-sm text-accent-primary-dark mb-8">
              <Sparkles size={16} />
              <span>{t('hero.badge')}</span>
            </div>
            <h1 className="text-4xl md:text-5xl lg:text-6xl font-extrabold leading-tight mb-6 text-text-primary">
              {t('hero.title1')}<br />
              <span className="bg-gradient-to-r from-accent-primary to-accent-secondary bg-clip-text text-transparent">
                {t('hero.title2')}
              </span>{t('hero.title3')}
            </h1>
            <p className="text-lg md:text-xl text-text-secondary max-w-xl mb-10 leading-relaxed">
              {t('hero.subtitle')}
            </p>
            <button
              onClick={openModal}
              className="px-8 py-4 bg-gradient-to-r from-accent-primary to-accent-secondary rounded-xl font-semibold text-white flex items-center gap-2 hover:-translate-y-1 hover:shadow-2xl hover:shadow-accent-primary/40 transition-all"
            >
              <Download size={20} />
              {t('hero.cta')}
            </button>
          </motion.div>

          <motion.div
            initial={{ opacity: 0, x: 40 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.8, delay: 0.2 }}
            className="hidden lg:block"
          >
            <PhoneMockup />
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
            <div className="inline-flex items-center gap-2 px-4 py-2 bg-accent-green/10 border border-accent-green/30 rounded-full text-sm text-accent-green mb-6">
              <Sparkles size={16} />
              <span>{t('coreValue.highlight')}</span>
            </div>
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

          <motion.div
            className="grid md:grid-cols-2 gap-8 items-center"
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={fadeInUp}
          >
            <div className="bg-white rounded-3xl p-8 border border-gray-100 shadow-lg">
              <div className="flex items-center gap-4 mb-6 pb-6 border-b border-gray-100">
                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-accent-primary to-accent-secondary flex items-center justify-center font-semibold text-white">
                  JM
                </div>
                <div>
                  <h4 className="font-medium text-text-primary">Jamie from NYC</h4>
                  <span className="text-sm text-text-muted">{t('coreValue.chatDate')}</span>
                </div>
              </div>
              <div className="bg-gray-50 rounded-xl p-5 mb-6">
                <p className="text-sm text-text-secondary mb-2">{t('coreValue.chatMsg1')}</p>
                <p className="text-sm text-text-secondary mb-3">{t('coreValue.chatMsg2')}</p>
                <div className="text-xs text-text-muted">22:47</div>
              </div>
              <button className="w-full py-3.5 bg-accent-green rounded-xl text-white font-semibold flex items-center justify-center gap-2 hover:bg-accent-green/90 transition-colors">
                <UserPlus size={20} />
                {t('coreValue.inviteBtn')}
              </button>
            </div>
            <div className="text-center md:text-left">
              <p className="text-xl text-text-secondary leading-relaxed">
                {t('coreValue.desc3')} <strong className="text-text-primary">Mingle</strong>.
              </p>
            </div>
          </motion.div>
        </div>
      </section>

      {/* How it Works */}
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
              {t('howItWorks.label')}
            </div>
            <h2 className="text-3xl md:text-4xl font-bold text-text-primary">{t('howItWorks.title')}</h2>
          </motion.div>
          <motion.div
            className="grid md:grid-cols-3 gap-12"
            initial="initial"
            whileInView="animate"
            viewport={{ once: true }}
            variants={{ animate: { transition: { staggerChildren: 0.2 } } }}
          >
            {[
              { icon: Mic, num: 1, key: 'step1' },
              { icon: Languages, num: 2, key: 'step2' },
              { icon: MessageSquare, num: 3, key: 'step3' }
            ].map((step, i) => (
              <motion.div key={i} className="text-center relative" variants={fadeInUp}>
                {i < 2 && (
                  <div className={`hidden md:block absolute top-10 ${isRTL ? 'left-0 -translate-x-1/2' : 'right-0 translate-x-1/2'} w-full h-0.5 bg-gradient-to-r from-accent-primary to-transparent`} />
                )}
                <div className="w-20 h-20 rounded-full bg-white border-2 border-accent-primary/30 flex items-center justify-center mx-auto mb-6 text-accent-primary shadow-lg">
                  <step.icon size={32} />
                </div>
                <h3 className="text-xl font-semibold mb-3 text-text-primary">{step.num}. {t(`howItWorks.${step.key}.title`)}</h3>
                <p className="text-text-secondary leading-relaxed">{t(`howItWorks.${step.key}.desc`)}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
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
              {t('cta.title1')}<br />{t('cta.title2')}
            </h2>
            <p className="text-lg text-text-secondary mb-12">
              {t('cta.subtitle')}
            </p>
            <button
              onClick={openModal}
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

export default App

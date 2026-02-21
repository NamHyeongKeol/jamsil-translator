'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { useTranslation } from 'react-i18next'
import { X, Download, Check } from 'lucide-react'
import { getUserInfo } from '@/components/sections/tracking'
import { buildLandingApiPath } from '@/lib/api-contract'

export interface EmailModalProps {
  isOpen: boolean
  onClose: () => void
}

export default function EmailModal({ isOpen, onClose }: EmailModalProps) {
  const { t } = useTranslation()
  const [email, setEmail] = useState('')
  const [feedback, setFeedback] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!email) return

    setStatus('loading')
    try {
      const res = await fetch(buildLandingApiPath('/subscribe'), {
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

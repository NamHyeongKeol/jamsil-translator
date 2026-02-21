'use client'

import { useTranslation } from 'react-i18next'

export default function Footer() {
  const { t } = useTranslation()

  return (
    <footer className="py-12 px-6 border-t border-gray-100 text-center bg-white">
      <p className="text-text-muted text-sm">{t('footer.copyright')}</p>
    </footer>
  )
}

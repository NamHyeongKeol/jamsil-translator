'use client'

import { useParams } from 'next/navigation'
import HomePage from '@/components/HomePage'
import { notFound } from 'next/navigation'

const versions = ['normal', 'flirting', 'working', 'social']
const locales = ['en', 'ko', 'ja', 'zh-CN', 'zh-TW', 'fr', 'de', 'es', 'pt', 'it', 'ru', 'ar', 'hi', 'th', 'vi']

export default function VersionPage() {
  const params = useParams()
  const version = params.version as string
  const localeSegments = params.locale as string[] | undefined
  const locale = localeSegments?.[0]

  // 유효하지 않은 버전이면 404
  if (!versions.includes(version)) {
    notFound()
  }

  // locale이 있는데 유효하지 않으면 404
  if (locale && !locales.includes(locale)) {
    notFound()
  }

  // version과 locale을 HomePage에 전달
  return <HomePage version={version} locale={locale} />
}

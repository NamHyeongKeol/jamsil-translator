'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import useRealtimeSTTCore from '@mingle/live-demo-core/use-realtime-stt'
import type { Utterance } from '@mingle/live-demo-core/chat-bubble'

const LS_KEY_DEMO_COMPLETED = 'mingle_demo_animation_completed'

const INITIAL_UTTERANCES: Utterance[] = [
  {
    id: 'demo-1',
    originalText: '最近週末はいつも何をしていますか。',
    originalLang: 'ja',
    translations: {
      en: 'What do you usually do on weekends recently.',
      ko: '요즘 주말에는 항상 무엇을 하고 있나요.',
    },
  },
  {
    id: 'demo-2',
    originalText: '저는 보통 집에서 영화 보거나 게임해요.',
    originalLang: 'ko',
    translations: {
      en: 'I usually watch movies or play games at home.',
      ja: '私は普段、家で映画を見たりゲームをしたりします。',
    },
  },
  {
    id: 'demo-3',
    originalText: 'I usually go hiking. The weather is so nice these days.',
    originalLang: 'en',
    translations: {
      ko: '저는 보통 하이킹을 갑니다. 요즘 날씨가 정말 좋네요.',
      ja: '私は普段ハイキングに行きます。最近とても天気が良いです。',
    },
  },
]

function isDemoCompleted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(LS_KEY_DEMO_COMPLETED) === 'true'
  } catch {
    return false
  }
}

function markDemoCompleted(): void {
  try {
    localStorage.setItem(LS_KEY_DEMO_COMPLETED, 'true')
  } catch {
    // ignore localStorage failures
  }
}

export default function useRealtimeSTT(options: Parameters<typeof useRealtimeSTTCore>[0]) {
  const core = useRealtimeSTTCore(options)
  const isSeedingRef = useRef(false)
  const [isDemoAnimating, setIsDemoAnimating] = useState(() => {
    if (typeof window === 'undefined') return false
    return !isDemoCompleted()
  })
  const [demoTypingText, setDemoTypingText] = useState('')
  const [demoTypingLang, setDemoTypingLang] = useState<string | null>(null)
  const [demoTypingTranslations, setDemoTypingTranslations] = useState<Record<string, string>>({})

  const stopDemoAnimation = useCallback((complete = true) => {
    setIsDemoAnimating(false)
    setDemoTypingText('')
    setDemoTypingLang(null)
    setDemoTypingTranslations({})
    if (complete) {
      markDemoCompleted()
    }
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    if (isSeedingRef.current) return
    if (core.utterances.length > 0 && !isDemoCompleted()) {
      markDemoCompleted()
      if (isDemoAnimating) {
        stopDemoAnimation(false)
      }
    }
  }, [core.utterances.length, isDemoAnimating, stopDemoAnimation])

  useEffect(() => {
    if (!isDemoAnimating) return
    if (isDemoCompleted()) {
      stopDemoAnimation(false)
      return
    }

    let isCancelled = false
    const TYPING_DELAY = 40
    const UTTERANCE_PAUSE = 800
    const INITIAL_DELAY = 1000
    const TRANSLATION_START_OFFSET = 3
    const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

    const animateDemo = async () => {
      isSeedingRef.current = true
      await sleep(INITIAL_DELAY)
      if (isCancelled) return

      for (let i = 0; i < INITIAL_UTTERANCES.length; i += 1) {
        const utterance = INITIAL_UTTERANCES[i]
        const text = utterance.originalText
        const translationEntries = Object.entries(utterance.translations)

        setDemoTypingLang(utterance.originalLang)
        const initialTranslations: Record<string, string> = {}
        for (const [lang] of translationEntries) {
          initialTranslations[lang] = ''
        }
        setDemoTypingTranslations(initialTranslations)

        for (let j = 0; j <= text.length; j += 1) {
          if (isCancelled) return
          setDemoTypingText(text.slice(0, j))
          const translationProgress = Math.max(0, j - TRANSLATION_START_OFFSET)
          const progressRatio = text.length > TRANSLATION_START_OFFSET
            ? translationProgress / (text.length - TRANSLATION_START_OFFSET)
            : (j > 0 ? 1 : 0)
          const nextTranslations: Record<string, string> = {}
          for (const [lang, fullText] of translationEntries) {
            const charsToShow = Math.floor(fullText.length * progressRatio)
            nextTranslations[lang] = fullText.slice(0, charsToShow)
          }
          setDemoTypingTranslations(nextTranslations)
          await sleep(TYPING_DELAY)
        }

        const completedTranslations: Record<string, string> = {}
        for (const [lang, fullText] of translationEntries) {
          completedTranslations[lang] = fullText
        }
        setDemoTypingTranslations(completedTranslations)
        await sleep(400)
        if (isCancelled) return

        core.appendUtterances([utterance])
        setDemoTypingText('')
        setDemoTypingLang(null)
        setDemoTypingTranslations({})

        if (i < INITIAL_UTTERANCES.length - 1) {
          await sleep(UTTERANCE_PAUSE)
        }
      }

      if (!isCancelled) {
        stopDemoAnimation(true)
      }
      isSeedingRef.current = false
    }

    void animateDemo()
    return () => {
      isCancelled = true
      isSeedingRef.current = false
    }
  }, [core.appendUtterances, isDemoAnimating, stopDemoAnimation])

  const toggleRecording = useCallback(() => {
    if (isDemoAnimating) {
      stopDemoAnimation(true)
    }
    core.toggleRecording()
  }, [core.toggleRecording, isDemoAnimating, stopDemoAnimation])

  return {
    ...core,
    toggleRecording,
    isDemoAnimating,
    demoTypingText,
    demoTypingLang,
    demoTypingTranslations,
  }
}

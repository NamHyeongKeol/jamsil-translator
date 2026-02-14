'use client'

import useRealtimeSTTCore from './use-realtime-stt'

export default function useRealtimeSTT(options: Parameters<typeof useRealtimeSTTCore>[0]) {
  const core = useRealtimeSTTCore({
    ...options,
    usageLimitSec: null,
  })

  return {
    ...core,
    isDemoAnimating: false,
    demoTypingText: '',
    demoTypingLang: null,
    demoTypingTranslations: {} as Record<string, string>,
  }
}

'use client'

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'

const LS_KEY_TTS_ENABLED = 'mingle_tts_enabled'

interface TtsSettingsContextValue {
  ttsEnabled: boolean
  setTtsEnabled: (value: boolean) => void
}

const TtsSettingsContext = createContext<TtsSettingsContextValue | null>(null)

export function TtsSettingsProvider({ children }: { children: ReactNode }) {
  const [ttsEnabled, setTtsEnabledState] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      const stored = window.localStorage.getItem(LS_KEY_TTS_ENABLED)
      if (stored === 'false') return false
    } catch { /* ignore */ }
    return true
  })

  const setTtsEnabled = useCallback((value: boolean) => {
    setTtsEnabledState(value)
    try {
      window.localStorage.setItem(LS_KEY_TTS_ENABLED, String(value))
    } catch { /* ignore */ }
  }, [])

  return (
    <TtsSettingsContext.Provider value={{ ttsEnabled, setTtsEnabled }}>
      {children}
    </TtsSettingsContext.Provider>
  )
}

export function useTtsSettings(): TtsSettingsContextValue {
  const ctx = useContext(TtsSettingsContext)
  if (!ctx) throw new Error('useTtsSettings must be used inside TtsSettingsProvider')
  return ctx
}

'use client'

import { createContext, useContext, useState, useCallback, useMemo, type ReactNode } from 'react'

const LS_KEY_TTS_ENABLED = 'mingle_tts_enabled'
const LS_KEY_AEC_ENABLED = 'mingle_aec_enabled'

interface TtsSettingsContextValue {
  ttsEnabled: boolean
  setTtsEnabled: (value: boolean) => void
  aecEnabled: boolean
  setAecEnabled: (value: boolean) => void
}

const TtsSettingsContext = createContext<TtsSettingsContextValue | null>(null)

export function TtsSettingsProvider({ children }: { children: ReactNode }) {
  const [ttsEnabled, setTtsEnabledState] = useState(() => {
    if (typeof window === 'undefined') return false
    try {
      const stored = window.localStorage.getItem(LS_KEY_TTS_ENABLED)
      if (stored === 'true') return true
    } catch { /* ignore */ }
    return false
  })

  const [aecEnabled, setAecEnabledState] = useState(() => {
    if (typeof window === 'undefined') return true
    try {
      const stored = window.localStorage.getItem(LS_KEY_AEC_ENABLED)
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

  const setAecEnabled = useCallback((value: boolean) => {
    setAecEnabledState(value)
    try {
      window.localStorage.setItem(LS_KEY_AEC_ENABLED, String(value))
    } catch { /* ignore */ }
  }, [])

  const value = useMemo(
    () => ({ ttsEnabled, setTtsEnabled, aecEnabled, setAecEnabled }),
    [ttsEnabled, setTtsEnabled, aecEnabled, setAecEnabled],
  )

  return (
    <TtsSettingsContext.Provider value={value}>
      {children}
    </TtsSettingsContext.Provider>
  )
}

export function useTtsSettings(): TtsSettingsContextValue {
  const ctx = useContext(TtsSettingsContext)
  if (!ctx) throw new Error('useTtsSettings must be used inside TtsSettingsProvider')
  return ctx
}

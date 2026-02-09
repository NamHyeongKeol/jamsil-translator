'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Utterance } from './ChatBubble'

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT || '3001'
const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  return `ws://${host}:${WS_PORT}`
}
const VOLUME_THRESHOLD = 0.05
const USAGE_LIMIT_SEC = 30

const LS_KEY_UTTERANCES = 'mingle_demo_utterances'
const LS_KEY_USAGE = 'mingle_demo_usage_sec'

// Initial demo conversation data - shown when user first visits
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

type ConnectionStatus = 'idle' | 'connecting' | 'ready' | 'error'

function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return output
}

function toBase64(data: Int16Array): string {
  const bytes = new Uint8Array(data.buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

interface UseRealtimeSTTOptions {
  languages: string[]
  onLimitReached?: () => void
}

export default function useRealtimeSTT({ languages, onLimitReached }: UseRealtimeSTTOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [utterances, setUtterances] = useState<Utterance[]>(() => {
    if (typeof window === 'undefined') return INITIAL_UTTERANCES
    try {
      const stored = localStorage.getItem(LS_KEY_UTTERANCES)
      if (!stored) return INITIAL_UTTERANCES
      const parsed: Utterance[] = JSON.parse(stored)
      // Deduplicate by id (fix corrupted data from previous bug)
      const seen = new Set<string>()
      return parsed.filter(u => {
        if (seen.has(u.id)) return false
        seen.add(u.id)
        return true
      })
    } catch { return INITIAL_UTTERANCES }
  })
  const [partialTranscript, setPartialTranscript] = useState('')
  const [partialTranslations, setPartialTranslations] = useState<Record<string, string>>({})
  const [partialLang, setPartialLang] = useState<string | null>(null)
  const [volume, setVolume] = useState(0)
  const [usageSec, setUsageSec] = useState(() => {
    if (typeof window === 'undefined') return 0
    try {
      return parseInt(localStorage.getItem(LS_KEY_USAGE) || '0', 10)
    } catch { return 0 }
  })

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const utteranceIdRef = useRef(0)
  const usageIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const onLimitReachedRef = useRef(onLimitReached)
  onLimitReachedRef.current = onLimitReached

  // Ref mirror of partialTranslations for synchronous read
  // (avoids nesting setUtterances inside setPartialTranslations updater,
  //  which causes duplicates in React Strict Mode)
  const partialTranslationsRef = useRef<Record<string, string>>({})

  // Persist utterances to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_UTTERANCES, JSON.stringify(utterances))
    } catch { /* ignore */ }
  }, [utterances])

  // Persist usage to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY_USAGE, String(usageSec))
    } catch { /* ignore */ }
  }, [usageSec])

  const isLimitReached = usageSec >= USAGE_LIMIT_SEC

  const cleanup = useCallback(() => {
    if (usageIntervalRef.current) {
      clearInterval(usageIntervalRef.current)
      usageIntervalRef.current = null
    }
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    if (processorRef.current) {
      processorRef.current.disconnect()
      processorRef.current = null
    }
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop())
      streamRef.current = null
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
    }
    audioContextRef.current = null
    analyserRef.current = null
    setVolume(0)
  }, [])

  const resetToIdle = useCallback(() => {
    cleanup()
    setConnectionStatus('idle')
  }, [cleanup])

  const visualize = useCallback(() => {
    if (analyserRef.current) {
      const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
      analyserRef.current.getByteTimeDomainData(dataArray)
      let sum = 0
      for (let i = 0; i < dataArray.length; i++) {
        sum += Math.pow((dataArray[i] - 128) / 128, 2)
      }
      const rms = Math.sqrt(sum / dataArray.length)
      setVolume(rms)
      animationFrameRef.current = requestAnimationFrame(visualize)
    } else {
      setVolume(0)
    }
  }, [])

  const startAudioProcessing = useCallback(() => {
    if (!audioContextRef.current || !streamRef.current || !socketRef.current) return

    const context = audioContextRef.current
    const stream = streamRef.current
    const socket = socketRef.current

    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    visualize()

    const processor = context.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor
    source.connect(processor)
    processor.connect(context.destination)
    processor.onaudioprocess = (e) => {
      if (socket.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0)
        const pcmData = floatTo16BitPCM(inputData)
        const base64Data = toBase64(pcmData)
        socket.send(JSON.stringify({
          type: 'audio_chunk',
          data: { chunk: base64Data }
        }))
      }
    }
  }, [visualize])

  const startRecording = useCallback(async () => {
    // Check limit before starting
    if (usageSec >= USAGE_LIMIT_SEC) {
      onLimitReachedRef.current?.()
      return
    }

    try {
      setConnectionStatus('connecting')
      setPartialTranscript('')
      setPartialTranslations({})
      partialTranslationsRef.current = {}
      setPartialLang(null)

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const context = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      audioContextRef.current = context

      const socket = new WebSocket(getWsUrl())
      socketRef.current = socket

      socket.onopen = () => {
        const config = {
          sample_rate: context.sampleRate,
          languages,
          stt_model: 'soniox',
          translate_model: 'gemini-2.5-flash-lite',
          lang_hints_strict: true,
        }
        socket.send(JSON.stringify(config))
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)

        if (message.status === 'ready') {
          setConnectionStatus('ready')
          startAudioProcessing()

          // Start usage timer
          usageIntervalRef.current = setInterval(() => {
            setUsageSec(prev => {
              const next = prev + 1
              if (next >= USAGE_LIMIT_SEC) {
                // Hit limit - defer cleanup to avoid setState-during-render
                setTimeout(() => {
                  cleanup()
                  setConnectionStatus('idle')
                  onLimitReachedRef.current?.()
                }, 0)
              }
              return next
            })
          }, 1000)
        } else if (message.type === 'transcript' && message.data?.utterance) {
          const rawText = message.data.utterance.text || ''
          const text = rawText.replace(/<\/?end>/gi, '').trim()
          const lang = message.data.utterance.language || 'unknown'

          if (message.data.is_final) {
            utteranceIdRef.current += 1
            // Read partial translations from ref (not via state updater)
            // This avoids React Strict Mode double-invoke creating duplicate utterances
            const seedTranslations = { ...partialTranslationsRef.current }
            const newUtterance: Utterance = {
              id: `u-${Date.now()}-${utteranceIdRef.current}`,
              originalText: text,
              originalLang: lang,
              translations: seedTranslations,
            }
            setUtterances(u => [...u, newUtterance])
            setPartialTranslations({})
            partialTranslationsRef.current = {}
            setPartialTranscript('')
            setPartialLang(null)
          } else {
            setPartialTranscript(text)
            setPartialLang(lang)
          }
        } else if (message.type === 'translation' && message.data) {
          const targetLang = message.data.target_language
          const rawTranslated = message.data.translated_utterance?.text
          const translatedText = rawTranslated ? rawTranslated.replace(/<\/?end>/gi, '').trim() : ''

          if (targetLang && translatedText) {
            if (message.data.is_partial) {
              partialTranslationsRef.current = { ...partialTranslationsRef.current, [targetLang]: translatedText }
              setPartialTranslations(prev => ({ ...prev, [targetLang]: translatedText }))
            } else {
              setUtterances(prev => {
                if (prev.length === 0) return prev
                const lastIndex = prev.length - 1
                const lastUtterance = prev[lastIndex]
                return [
                  ...prev.slice(0, lastIndex),
                  {
                    ...lastUtterance,
                    translations: { ...lastUtterance.translations, [targetLang]: translatedText },
                  },
                ]
              })
            }
          }
        }
      }

      socket.onerror = () => {
        cleanup()
        setConnectionStatus('error')
        setTimeout(() => setConnectionStatus('idle'), 3000)
      }

      socket.onclose = () => {
        resetToIdle()
      }
    } catch {
      cleanup()
      setConnectionStatus('error')
      setTimeout(() => setConnectionStatus('idle'), 3000)
    }
  }, [cleanup, resetToIdle, startAudioProcessing, languages, usageSec])

  const toggleRecording = useCallback(() => {
    if (connectionStatus === 'error') return
    if (connectionStatus !== 'idle') {
      resetToIdle()
    } else {
      startRecording()
    }
  }, [connectionStatus, resetToIdle, startRecording])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [cleanup])

  return {
    connectionStatus,
    utterances,
    partialTranscript,
    volume,
    toggleRecording,
    isActive: connectionStatus !== 'idle' && connectionStatus !== 'error',
    isReady: connectionStatus === 'ready',
    isConnecting: connectionStatus === 'connecting',
    isError: connectionStatus === 'error',
    partialTranslations,
    partialLang,
    usageSec,
    isLimitReached,
  }
}

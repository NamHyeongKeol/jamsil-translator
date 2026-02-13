'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import type { Utterance } from './ChatBubble'

const WS_PORT = process.env.NEXT_PUBLIC_WS_PORT || '3001'
const getWsUrl = () => {
  if (process.env.NEXT_PUBLIC_WS_URL) return process.env.NEXT_PUBLIC_WS_URL
  const host = typeof window !== 'undefined' ? window.location.hostname : 'localhost'
  const isSecure = typeof window !== 'undefined' && window.location.protocol === 'https:'
  const protocol = isSecure ? 'wss' : 'ws'
  return `${protocol}://${host}:${WS_PORT}`
}
const VOLUME_THRESHOLD = 0.05
const USAGE_LIMIT_SEC = 30

const LS_KEY_UTTERANCES = 'mingle_demo_utterances'
const LS_KEY_USAGE = 'mingle_demo_usage_sec'
const LS_KEY_DEMO_COMPLETED = 'mingle_demo_animation_completed'

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

// Check if demo animation has been completed before
function isDemoCompleted(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(LS_KEY_DEMO_COMPLETED) === 'true'
  } catch { return false }
}

// Mark demo animation as completed
function markDemoCompleted(): void {
  try {
    localStorage.setItem(LS_KEY_DEMO_COMPLETED, 'true')
  } catch { /* ignore */ }
}

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
  suppressInput?: boolean
}

export default function useRealtimeSTT({ languages, onLimitReached, suppressInput = false }: UseRealtimeSTTOptions) {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  
  // Demo animation states
  const [isDemoAnimating, setIsDemoAnimating] = useState(() => {
    if (typeof window === 'undefined') return false
    return !isDemoCompleted()
  })
  const [demoTypingText, setDemoTypingText] = useState('')
  const [demoTypingLang, setDemoTypingLang] = useState<string | null>(null)
  const [demoTypingTranslations, setDemoTypingTranslations] = useState<Record<string, string>>({})
  
  const [utterances, setUtterances] = useState<Utterance[]>(() => {
    if (typeof window === 'undefined') return INITIAL_UTTERANCES
    // If demo not completed, start with empty array for animation
    if (!isDemoCompleted()) return []
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
  const partialTranscriptRef = useRef('')
  const partialLangRef = useRef<string | null>(null)
  const stopAckResolverRef = useRef<(() => void) | null>(null)
  const isStoppingRef = useRef(false)
  const lastFinalSignatureRef = useRef<{ sig: string, at: number }>({ sig: '', at: 0 })
  const suppressInputRef = useRef(suppressInput)

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

  useEffect(() => {
    partialTranscriptRef.current = partialTranscript
  }, [partialTranscript])

  useEffect(() => {
    partialLangRef.current = partialLang
  }, [partialLang])

  useEffect(() => {
    suppressInputRef.current = suppressInput
  }, [suppressInput])

  // Demo animation effect - typewriter effect for initial utterances
  useEffect(() => {
    if (!isDemoAnimating) return

    let isCancelled = false
    const TYPING_DELAY = 40 // ms per character
    const UTTERANCE_PAUSE = 800 // ms between utterances
    const INITIAL_DELAY = 1000 // ms before starting
    const TRANSLATION_START_OFFSET = 3 // Start translation after N original chars

    const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

    const animateDemo = async () => {
      await sleep(INITIAL_DELAY)
      if (isCancelled) return

      for (let i = 0; i < INITIAL_UTTERANCES.length; i++) {
        const utterance = INITIAL_UTTERANCES[i]
        const text = utterance.originalText
        const translations = utterance.translations
        const translationEntries = Object.entries(translations)

        // Set the language we're typing in
        setDemoTypingLang(utterance.originalLang)
        // Initialize all translation slots as empty strings (so UI shows the boxes)
        const initialTranslations: Record<string, string> = {}
        for (const [lang] of translationEntries) {
          initialTranslations[lang] = ''
        }
        setDemoTypingTranslations(initialTranslations)

        // Typewriter effect - original and translations typed in parallel
        for (let j = 0; j <= text.length; j++) {
          if (isCancelled) return
          
          // Update original text
          setDemoTypingText(text.slice(0, j))
          
          // Update translations proportionally
          // Start translations after TRANSLATION_START_OFFSET characters
          const translationProgress = Math.max(0, j - TRANSLATION_START_OFFSET)
          const progressRatio = text.length > TRANSLATION_START_OFFSET 
            ? translationProgress / (text.length - TRANSLATION_START_OFFSET)
            : (j > 0 ? 1 : 0)
          
          const newTranslations: Record<string, string> = {}
          for (const [lang, fullText] of translationEntries) {
            const charsToShow = Math.floor(fullText.length * progressRatio)
            newTranslations[lang] = fullText.slice(0, charsToShow)
          }
          setDemoTypingTranslations(newTranslations)
          
          await sleep(TYPING_DELAY)
        }

        // Complete all translations (in case of rounding issues)
        const finalTranslations: Record<string, string> = {}
        for (const [lang, fullText] of translationEntries) {
          finalTranslations[lang] = fullText
        }
        setDemoTypingTranslations(finalTranslations)

        // Small pause after typing complete
        await sleep(400)
        if (isCancelled) return

        // Finalize this utterance
        setUtterances(prev => [...prev, utterance])
        setDemoTypingText('')
        setDemoTypingLang(null)
        setDemoTypingTranslations({})

        // Pause before next utterance
        if (i < INITIAL_UTTERANCES.length - 1) {
          await sleep(UTTERANCE_PAUSE)
        }
      }

      // Mark demo as completed
      if (!isCancelled) {
        setIsDemoAnimating(false)
        markDemoCompleted()
      }
    }

    animateDemo()

    return () => {
      isCancelled = true
    }
  }, [isDemoAnimating])

  const isLimitReached = usageSec >= USAGE_LIMIT_SEC

  const stopAudioPipeline = useCallback(() => {
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

  const cleanup = useCallback(() => {
    stopAudioPipeline()
    if (socketRef.current) {
      socketRef.current.close()
      socketRef.current = null
    }
  }, [stopAudioPipeline])

  const resetToIdle = useCallback(() => {
    isStoppingRef.current = false
    stopAckResolverRef.current = null
    cleanup()
    setConnectionStatus('idle')
  }, [cleanup])

  const stopRecordingGracefully = useCallback(async (notifyLimitReached = false) => {
    if (isStoppingRef.current) return
    isStoppingRef.current = true

    // Stop capturing mic/audio immediately, but keep WS alive briefly for finalization ack.
    stopAudioPipeline()

    const socket = socketRef.current
    const pendingText = partialTranscriptRef.current.trim()
    const pendingLang = partialLangRef.current || 'unknown'

    try {
      if (socket && socket.readyState === WebSocket.OPEN) {
        await new Promise<void>((resolve) => {
          let settled = false
          const settle = () => {
            if (settled) return
            settled = true
            stopAckResolverRef.current = null
            resolve()
          }

          stopAckResolverRef.current = settle
          socket.send(JSON.stringify({
            type: 'stop_recording',
            data: {
              pending_text: pendingText,
              pending_language: pendingLang,
            },
          }))
          setTimeout(settle, 1800)
        })
      }
    } catch {
      // fall through and close anyway
    } finally {
      if (socketRef.current) {
        socketRef.current.close()
        socketRef.current = null
      }
      setConnectionStatus('idle')
      isStoppingRef.current = false
      if (notifyLimitReached) {
        onLimitReachedRef.current?.()
      }
    }
  }, [stopAudioPipeline])

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
      if (suppressInputRef.current) return
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

    // Stop demo animation if running (discard current typing, keep completed utterances)
    if (isDemoAnimating) {
      setIsDemoAnimating(false)
      setDemoTypingText('')
      setDemoTypingLang(null)
      setDemoTypingTranslations({})
      markDemoCompleted()
    }

    try {
      setConnectionStatus('connecting')
      setPartialTranscript('')
      setPartialTranslations({})
      partialTranslationsRef.current = {}
      setPartialLang(null)

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      })
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
                  void stopRecordingGracefully(true)
                }, 0)
              }
              return next
            })
          }, 1000)
        } else if (message.type === 'stop_recording_ack') {
          stopAckResolverRef.current?.()
        } else if (message.type === 'transcript' && message.data?.utterance) {
          const rawText = message.data.utterance.text || ''
          const text = rawText.replace(/<\/?end>/gi, '').trim()
          const lang = message.data.utterance.language || 'unknown'

          if (message.data.is_final) {
            const sig = `${lang}::${text}`
            const now = Date.now()
            if (sig && lastFinalSignatureRef.current.sig === sig && now - lastFinalSignatureRef.current.at < 2000) {
              return
            }
            lastFinalSignatureRef.current = { sig, at: now }

            utteranceIdRef.current += 1
            // Read partial translations from ref (not via state updater)
            // This avoids React Strict Mode double-invoke creating duplicate utterances
            const seedTranslations = { ...partialTranslationsRef.current }
            const seedFinalized: Record<string, boolean> = {}
            for (const key of Object.keys(seedTranslations)) {
              seedFinalized[key] = false
            }
            const newUtterance: Utterance = {
              id: `u-${Date.now()}-${utteranceIdRef.current}`,
              originalText: text,
              originalLang: lang,
              translations: seedTranslations,
              translationFinalized: seedFinalized,
            }
            setUtterances(u => [...u, newUtterance])
            setPartialTranslations({})
            partialTranslationsRef.current = {}
            setPartialTranscript('')
            partialTranscriptRef.current = ''
            setPartialLang(null)
            partialLangRef.current = null
          } else {
            setPartialTranscript(text)
            partialTranscriptRef.current = text
            setPartialLang(lang)
            partialLangRef.current = lang
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
                    translationFinalized: { ...lastUtterance.translationFinalized, [targetLang]: true },
                  },
                ]
              })
            }
          }
        }
      }

      socket.onerror = () => {
        stopAckResolverRef.current?.()
        cleanup()
        setConnectionStatus('error')
        setTimeout(() => setConnectionStatus('idle'), 3000)
      }

      socket.onclose = () => {
        stopAckResolverRef.current?.()
        resetToIdle()
      }
    } catch {
      cleanup()
      setConnectionStatus('error')
      setTimeout(() => setConnectionStatus('idle'), 3000)
    }
  }, [cleanup, resetToIdle, startAudioProcessing, languages, usageSec, isDemoAnimating, stopRecordingGracefully])

  const toggleRecording = useCallback(() => {
    if (connectionStatus === 'error') return
    if (connectionStatus !== 'idle') {
      void stopRecordingGracefully()
    } else {
      startRecording()
    }
  }, [connectionStatus, startRecording, stopRecordingGracefully])

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
    // Demo animation states
    isDemoAnimating,
    demoTypingText,
    demoTypingLang,
    demoTypingTranslations,
  }
}

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Mic, MicOff, User } from 'lucide-react'
import { cn } from '@/lib/utils'

const VOLUME_THRESHOLD = 0.05 // 목소리 감지 민감도
const STT_PROXY_URL = 'ws://localhost:3001'

const SUPPORTED_LANGUAGES = [
  { code: 'en', name: 'English' },
  { code: 'ko', name: 'Korean' },
  { code: 'th', name: 'Thai' },
  { code: 'zh', name: 'Chinese' },
  { code: 'ja', name: 'Japanese' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'French' },
  { code: 'de', name: 'German' },
  { code: 'ru', name: 'Russian' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ar', name: 'Arabic' },
  { code: 'hi', name: 'Hindi' },
  { code: 'vi', name: 'Vietnamese' },
  { code: 'it', name: 'Italian' },
  { code: 'id', name: 'Indonesian' },
  { code: 'tr', name: 'Turkish' },
  { code: 'pl', name: 'Polish' },
  { code: 'nl', name: 'Dutch' },
  { code: 'sv', name: 'Swedish' },
  { code: 'ms', name: 'Malay' },
];

// Helper function to convert float audio data to base64 string
function floatTo16BitPCM(input: Float32Array): Int16Array {
  const output = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]))
    output[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return output
}

function toBase64(data: Int16Array): string {
  return Buffer.from(data.buffer).toString('base64')
}

// Message type for chat history
type Message = {
  id: string;
  speaker: 'A' | 'B';
  text: string;
  translation?: string;
  isFinal: boolean;
  timestamp: Date;
}

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [volume, setVolume] = useState(0)

  // Chat state
  const [messages, setMessages] = useState<Message[]>([])
  const [currentSpeaker, setCurrentSpeaker] = useState<'A' | 'B'>('A')
  // We need to track the active message ID to update it
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)

  const [lang1, setLang1] = useState('en');
  const [lang2, setLang2] = useState('ko');
  const [targetLang, setTargetLang] = useState('ko'); // Default translation target is Korean

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  useEffect(() => {
    // Set default languages on mount
    const browserLang = navigator.language.split('-')[0];
    const defaultLang2 = browserLang === 'en' ? 'ko' : browserLang;
    // Check if the browser language is supported, otherwise default to 'ko'
    if (SUPPORTED_LANGUAGES.some(l => l.code === defaultLang2)) {
      setLang2(defaultLang2);
    } else {
      setLang2('ko');
    }
  }, []);

  const cleanup = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
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
    }
    if (audioContextRef.current && audioContextRef.current.state !== 'closed') {
      audioContextRef.current.close()
    }
    streamRef.current = null
    analyserRef.current = null
    audioContextRef.current = null
    setIsRecording(false)
    setVolume(0)
    setActiveMessageId(null)
  }

  // Create a new message or return existing one
  const getOrCreateActiveMessage = useCallback((speaker: 'A' | 'B') => {
    setMessages(prev => {
      // If we have an active message and it's the correct speaker, return prev
      // But actually we need to update state, so we handle logic better in the socket callback
      return prev;
    });
  }, []);

  const startAudioProcessing = () => {
    if (!audioContextRef.current || !streamRef.current || !socketRef.current) return;

    const context = audioContextRef.current;
    const stream = streamRef.current;
    const socket = socketRef.current;

    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 256
    source.connect(analyser)
    analyserRef.current = analyser
    visualize()

    const processor = context.createScriptProcessor(4096, 1, 1)
    processorRef.current = processor;
    source.connect(processor)
    processor.connect(context.destination)
    processor.onaudioprocess = (e) => {
      if (socket.readyState === WebSocket.OPEN) {
        const inputData = e.inputBuffer.getChannelData(0)
        const pcmData = floatTo16BitPCM(inputData)
        const base64Data = toBase64(pcmData)
        socket.send(JSON.stringify({
          type: 'audio_chunk',
          data: {
            chunk: base64Data
          }
        }))
      }
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const context = new (window.AudioContext || window.webkitAudioContext)()
      audioContextRef.current = context

      const socket = new WebSocket(STT_PROXY_URL)
      socketRef.current = socket

      socket.onopen = () => {
        const languages = [lang1, lang2].filter(Boolean);
        const config = {
          sample_rate: context.sampleRate,
          languages: languages,
          target_languages: targetLang ? [targetLang] : []
        }
        socket.send(JSON.stringify(config))
        setIsRecording(true)
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)

        if (message.status === 'ready') {
          console.log('Server is ready, starting audio processing.');
          startAudioProcessing();
        } else if (message.type === 'transcript' && message.data && message.data.utterance) {
          const text = message.data.utterance.text;
          const isFinal = message.data.is_final;

          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            // If there's an active message that isn't final yet, and speaker matches, update it
            if (lastMsg && !lastMsg.isFinal && lastMsg.speaker === currentSpeaker) {
              return prev.map((msg, idx) => {
                if (idx === prev.length - 1) {
                  return { ...msg, text: text, isFinal: isFinal };
                }
                return msg;
              });
            }
            // Otherwise create a new message
            else if (text.trim().length > 0) {
              return [...prev, {
                id: Date.now().toString(),
                speaker: currentSpeaker,
                text: text,
                isFinal: isFinal,
                timestamp: new Date()
              }];
            }
            return prev;
          });

        } else if (message.type === 'translation' && message.data && message.data.utterance) {
          const translatedText = message.data.utterance.text;

          setMessages(prev => {
            const lastMsg = prev[prev.length - 1];
            // Attach translation to the last message if matches speaker
            if (lastMsg && lastMsg.speaker === currentSpeaker) {
              return prev.map((msg, idx) => {
                if (idx === prev.length - 1) {
                  return { ...msg, translation: translatedText };
                }
                return msg;
              });
            }
            return prev;
          });
        }
      }

      socket.onerror = (error) => {
        console.error('WebSocket Error:', error)
        alert('WebSocket 연결에 오류가 발생했습니다.')
        cleanup()
      }

      socket.onclose = () => {
        console.log('WebSocket connection closed')
        cleanup()
      }
    } catch (err) {
      console.error('마이크 접근 오류:', err)
      alert('마이크 사용 권한이 필요합니다.')
      cleanup()
    }
  }

  const visualize = () => {
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
  }

  const handleToggleRecording = () => {
    if (isRecording) {
      cleanup()
    } else {
      startRecording()
    }
  }

  const handleSpeakerChange = (speaker: 'A' | 'B') => {
    // If we switch speakers, finalize the previous message manually if it wasn't already
    setMessages(prev => {
      if (prev.length === 0) return prev;
      const lastMsg = prev[prev.length - 1];
      if (!lastMsg.isFinal) {
        return prev.map((msg, idx) => {
          if (idx === prev.length - 1) {
            return { ...msg, isFinal: true };
          }
          return msg;
        });
      }
      return prev;
    });
    setCurrentSpeaker(speaker);
  }

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  return (
    <div className="h-screen bg-gray-50 flex flex-col overflow-hidden">
      {/* Header */}
      <header className="bg-white border-b px-6 py-4 flex items-center justify-between shadow-sm z-10">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Jamsil Translator</h1>
          <p className="text-xs text-gray-500">실시간 대화 번역</p>
        </div>
        <div className="flex gap-2">
          <select
            value={targetLang}
            onChange={(e) => setTargetLang(e.target.value)}
            className="text-sm border-none bg-gray-100 rounded-md px-3 py-1.5 focus:ring-2 focus:ring-indigo-500"
            disabled={isRecording}
          >
            <option value="">번역 안 함</option>
            {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}로 번역</option>)}
          </select>
        </div>
      </header>

      {/* Settings Bar (Languages) */}
      <div className="bg-white/80 backdrop-blur-sm border-b px-6 py-2 flex items-center justify-center gap-4 text-sm z-10">
        <div className="flex items-center gap-2">
          <span className="text-gray-500">언어 1:</span>
          <select
            value={lang1}
            onChange={(e) => setLang1(e.target.value)}
            disabled={isRecording}
            className="bg-transparent font-medium text-gray-900 focus:outline-none cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
          </select>
        </div>
        <span className="text-gray-300">|</span>
        <div className="flex items-center gap-2">
          <span className="text-gray-500">언어 2:</span>
          <select
            value={lang2}
            onChange={(e) => setLang2(e.target.value)}
            disabled={isRecording}
            className="bg-transparent font-medium text-gray-900 focus:outline-none cursor-pointer"
          >
            {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
          </select>
        </div>
      </div>

      {/* Chat Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-6 bg-gradient-to-b from-gray-50 to-white">
        {messages.length === 0 && (
          <div className="h-full flex flex-col items-center justify-center text-gray-400 space-y-4">
            <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <User size={32} className="opacity-20" />
            </div>
            <p>대화를 시작하려면 녹음 버튼을 누르세요.</p>
          </div>
        )}

        {messages.map((msg, idx) => (
          <div key={idx} className={cn(
            "flex w-full",
            msg.speaker === 'A' ? "justify-end" : "justify-start"
          )}>
            <div className={cn(
              "max-w-[80%] rounded-2xl px-5 py-3 shadow-sm",
              msg.speaker === 'A'
                ? "bg-indigo-600 text-white rounded-tr-none"
                : "bg-white border border-gray-200 text-gray-900 rounded-tl-none"
            )}>
              <div className="text-xs opacity-70 mb-1 flex justify-between items-center gap-4">
                <span>Speaker {msg.speaker}</span>
                {/* <span>{msg.timestamp.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}</span> */}
              </div>
              <p className="text-lg leading-relaxed">{msg.text}</p>
              {msg.translation && (
                <div className={cn(
                  "mt-2 pt-2 border-t text-sm font-medium",
                  msg.speaker === 'A' ? "border-white/20 text-indigo-100" : "border-gray-100 text-indigo-600"
                )}>
                  {msg.translation}
                </div>
              )}
            </div>
          </div>
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Control Bar */}
      <div className="bg-white border-t p-4 pb-8 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
        <div className="max-w-3xl mx-auto flex items-center justify-center gap-6">
          {/* Speaker A Toggle */}
          <button
            onClick={() => handleSpeakerChange('A')}
            className={cn(
              "flex flex-col items-center gap-1 p-3 rounded-lg transition-all",
              currentSpeaker === 'A'
                ? "bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500 ring-offset-2"
                : "hover:bg-gray-50 text-gray-500"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <span className="font-bold text-lg">A</span>
            </div>
            <span className="text-xs font-medium">Speaker A</span>
          </button>


          {/* Main Record Button */}
          <Button
            onClick={handleToggleRecording}
            size="lg"
            className={cn(
              "h-20 w-20 rounded-full shadow-xl transition-all duration-300 transform hover:scale-105 active:scale-95",
              isRecording
                ? "bg-red-500 hover:bg-red-600 ring-4 ring-red-100"
                : "bg-indigo-600 hover:bg-indigo-700 ring-4 ring-indigo-100"
            )}
          >
            {isRecording ? (
              <MicOff size={32} className="text-white" />
            ) : (
              <Mic size={32} className="text-white" />
            )}
          </Button>


          {/* Speaker B Toggle */}
          <button
            onClick={() => handleSpeakerChange('B')}
            className={cn(
              "flex flex-col items-center gap-1 p-3 rounded-lg transition-all",
              currentSpeaker === 'B'
                ? "bg-indigo-50 text-indigo-700 ring-2 ring-indigo-500 ring-offset-2"
                : "hover:bg-gray-50 text-gray-500"
            )}
          >
            <div className="w-10 h-10 rounded-full bg-gray-100 flex items-center justify-center border border-gray-200">
              <span className="font-bold text-lg text-gray-700">B</span>
            </div>
            <span className="text-xs font-medium">Speaker B</span>
          </button>
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          {isRecording
            ? `Recording Speaker ${currentSpeaker}... Tap toggle to switch.`
            : "Press microphone to start translation"}
        </p>
      </div>
    </div>
  )
}
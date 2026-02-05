'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Play, Loader2 } from 'lucide-react'

const VOLUME_THRESHOLD = 0.05 // 목소리 감지 민감도
const STT_PROXY_URL = 'ws://localhost:3001'

// 연결 상태: idle(대기) -> connecting(연결 중) -> ready(음성 인식 가능)
type ConnectionStatus = 'idle' | 'connecting' | 'ready'

// 발화 타입: 원본 + 번역들
interface Utterance {
  id: string
  originalText: string
  originalLang: string
  translations: Record<string, string>  // { 'ko': '한국어 번역', 'ja': '일본어 번역' }
}

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

export default function Home() {
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('idle')
  const [volume, setVolume] = useState(0)
  const [utterances, setUtterances] = useState<Utterance[]>([])
  const [partialTranscript, setPartialTranscript] = useState('')
  const [selectedLanguages, setSelectedLanguages] = useState<string[]>(['en', 'ko'])
  const [lang1, setLang1] = useState('en');
  const [lang2, setLang2] = useState('ko');
  const [lang3, setLang3] = useState('');

  const audioContextRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const processorRef = useRef<ScriptProcessorNode | null>(null)

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
    setConnectionStatus('idle')
    setVolume(0)
  }

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
      // 연결 시작 - connecting 상태로 변경
      setConnectionStatus('connecting')
      
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const context = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      audioContextRef.current = context

      const socket = new WebSocket(STT_PROXY_URL)
      socketRef.current = socket

      socket.onopen = () => {
        const languages = [lang1, lang2, lang3].filter(Boolean);
        const config = {
          sample_rate: context.sampleRate,
          languages: languages
        }
        socket.send(JSON.stringify(config))
        // 아직 connecting 상태 유지 - Gladia ready 까지 대기
      }

      socket.onmessage = (event) => {
        const message = JSON.parse(event.data)
        
        if (message.status === 'ready') {
          console.log('Server is ready, starting audio processing.');
          setConnectionStatus('ready')
          startAudioProcessing();
        } else if (message.type === 'transcript' && message.data && message.data.utterance) {
          const text = message.data.utterance.text;
          const lang = message.data.utterance.language || 'unknown';
          
          if (message.data.is_final) {
            // 발화 완료 - 배열에 추가
            const newUtterance: Utterance = {
              id: Date.now().toString(), // 간단한 ID 생성
              originalText: text,
              originalLang: lang,
              translations: {}
            };
            setUtterances(prev => [...prev, newUtterance]);
            setPartialTranscript('');
          } else {
            // 부분 결과 - 임시 표시
            setPartialTranscript(text);
          }
        } else if (message.type === 'translation' && message.data) {
          // 번역 결과 - 마지막 발화에 추가
          const targetLang = message.data.target_language;
          const translatedText = message.data.translated_utterance?.text;
          
          if (targetLang && translatedText) {
            setUtterances(prev => {
              if (prev.length === 0) return prev;
              // 마지막 발화에 번역 추가
              const lastIndex = prev.length - 1;
              const lastUtterance = prev[lastIndex];
              return [
                ...prev.slice(0, lastIndex),
                { ...lastUtterance, translations: { ...lastUtterance.translations, [targetLang]: translatedText } }
              ];
            });
          }
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
    if (connectionStatus !== 'idle') {
      cleanup()
    } else {
      startRecording()
    }
  }

  // 연결 시작 시 transcription 초기화
  useEffect(() => {
    if (connectionStatus === 'connecting') {
      setUtterances([])
      setPartialTranscript('')
    }
  }, [connectionStatus])

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  // 파생 상태
  const isActive = connectionStatus !== 'idle'
  const isReady = connectionStatus === 'ready'
  const isConnecting = connectionStatus === 'connecting'
  const showRipple = isReady && volume > VOLUME_THRESHOLD
  const rippleScale = showRipple ? 1 + (volume - VOLUME_THRESHOLD) * 5 : 1
  const rippleOpacity = showRipple ? 0.3 : 0
  
  // 상태 메시지
  const getStatusMessage = () => {
    switch (connectionStatus) {
      case 'connecting':
        return '음성 인식 서비스에 연결 중...'
      case 'ready':
        return '음성 인식 중... 버튼을 눌러 중지하세요.'
      default:
        return '버튼을 눌러 실시간 번역을 시작하세요.'
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="text-center mb-8">
        <h1 className="text-4xl font-bold text-gray-900">Jamsil Translator</h1>
        <p className="text-gray-600 mt-2">실시간 음성 번역</p>
      </div>

      <div className="w-full max-w-md mx-auto mb-8 p-4 bg-white/30 rounded-lg shadow-md backdrop-blur-sm">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label htmlFor="lang1" className="block text-sm font-medium text-gray-700">언어 1</label>
            <select id="lang1" value={lang1} onChange={(e) => setLang1(e.target.value)} disabled={isActive} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
              {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lang2" className="block text-sm font-medium text-gray-700">언어 2</label>
            <select id="lang2" value={lang2} onChange={(e) => setLang2(e.target.value)} disabled={isActive} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
              {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
            </select>
          </div>
          <div>
            <label htmlFor="lang3" className="block text-sm font-medium text-gray-700">언어 3 (선택)</label>
            <select id="lang3" value={lang3} onChange={(e) => setLang3(e.target.value)} disabled={isActive} className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md">
              <option value="">선택 안 함</option>
              {SUPPORTED_LANGUAGES.map(lang => <option key={lang.code} value={lang.code}>{lang.name}</option>)}
            </select>
          </div>
        </div>
      </div>

      <div className="relative flex items-center justify-center w-48 h-48">
        <div
          className="absolute h-28 w-28 rounded-full bg-blue-500 transition-all duration-300 ease-out"
          style={{
            transform: `scale(${rippleScale})`,
            opacity: rippleOpacity,
          }}
        />
        <Button
          onClick={handleToggleRecording}
          size="lg"
          disabled={isConnecting}
          className="relative flex h-28 w-28 items-center justify-center rounded-full bg-white/50 text-gray-700 shadow-lg backdrop-blur-xl transition-transform duration-200 ease-in-out hover:scale-105 active:scale-95 disabled:opacity-70"
        >
          {isConnecting ? (
            <Loader2 size={48} className="text-blue-600 animate-spin" />
          ) : isReady ? (
            <div className="h-8 w-8 bg-red-500 rounded-lg" />
          ) : (
            <Play size={100} className="text-gray-800" />
          )}
        </Button>
      </div>

      <div className="mt-12 text-center h-10">
        <p className={`transition-opacity duration-300 ${isConnecting ? 'text-blue-600 font-medium' : 'text-gray-600'}`}>
          {getStatusMessage()}
        </p>
      </div>

      <div className="mt-8 w-full max-w-md p-4 bg-white/30 rounded-lg shadow-md min-h-[100px] max-h-[400px] overflow-y-auto text-gray-800 backdrop-blur-sm">
        <div className="space-y-4">
          {utterances.filter(u => u.originalText).map((utterance) => (
            <div key={utterance.id} className="border-l-2 border-blue-400 pl-3 py-2 space-y-1">
              {/* 원본 */}
              <p className="font-medium">
                <span className="text-xs text-blue-600 mr-2">[{utterance.originalLang.toUpperCase()}]</span>
                {utterance.originalText}
              </p>
              {/* 번역들 (원본 언어 제외) */}
              {Object.entries(utterance.translations)
                .filter(([lang]) => lang !== utterance.originalLang)
                .map(([lang, text]) => (
                  <p key={lang} className="text-gray-600 text-sm">
                    <span className="text-xs text-gray-400 mr-2">[{lang.toUpperCase()}]</span>
                    {text}
                  </p>
                ))}
            </div>
          ))}
          {partialTranscript && (
            <p className="border-l-2 border-gray-300 pl-3 py-1 text-gray-500">
              {partialTranscript}
            </p>
          )}
          {utterances.length === 0 && !partialTranscript && (
            <p className="text-gray-400">음성 인식 결과가 여기에 표시됩니다.</p>
          )}
        </div>
      </div>
    </div>
  )
}
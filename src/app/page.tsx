'use client'

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Play } from 'lucide-react'

const VOLUME_THRESHOLD = 0.05 // 목소리 감지 민감도

export default function Home() {
  const [isRecording, setIsRecording] = useState(false)
  const [volume, setVolume] = useState(0)

  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const animationFrameRef = useRef<number | null>(null)

  const cleanup = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
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
  }

  const startRecording = async () => {
    try {
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
        streamRef.current = stream
        const context = new (window.AudioContext || window.webkitAudioContext)()
        audioContextRef.current = context
        const source = context.createMediaStreamSource(stream)
        const analyser = context.createAnalyser()
        analyser.fftSize = 256
        source.connect(analyser)
        analyserRef.current = analyser
        setIsRecording(true)
        visualize()
      } else {
        alert('현재 브라우저에서는 음성 인식을 지원하지 않습니다.')
      }
    } catch (err) {
      console.error('마이크 접근 오류:', err)
      alert('마이크 사용 권한이 필요합니다. 페이지를 새로고침하고 다시 시도해주세요.')
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

  useEffect(() => {
    return () => {
      cleanup()
    }
  }, [])

  const showRipple = isRecording && volume > VOLUME_THRESHOLD
  const rippleScale = showRipple ? 1 + (volume - VOLUME_THRESHOLD) * 5 : 1
  const rippleOpacity = showRipple ? 0.3 : 0

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 flex flex-col items-center justify-center p-4 overflow-hidden">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-gray-900">Jamsil Translator</h1>
        <p className="text-gray-600 mt-2">실시간 음성 번역</p>
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
          className="relative flex h-28 w-28 items-center justify-center rounded-full bg-white/50 text-gray-700 shadow-lg backdrop-blur-xl transition-transform duration-200 ease-in-out hover:scale-105 active:scale-95"
        >
          {isRecording ? (
            <div className="h-8 w-8 bg-red-500 rounded-lg" />
          ) : (
            <Play size={100} className="text-gray-800" />
          )}
        </Button>
      </div>

      <div className="mt-12 text-center h-10">
        <p className="text-gray-600 transition-opacity duration-300">
          {isRecording ? '음성 인식 중... 버튼을 눌러 중지하세요.' : '버튼을 눌러 실시간 번역을 시작하세요.'}
        </p>
      </div>
    </div>
  )
}

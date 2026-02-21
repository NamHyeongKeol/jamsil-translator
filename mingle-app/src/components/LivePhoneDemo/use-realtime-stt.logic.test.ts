import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildFinalizedUtterancePayload,
  canUseDeferredTtsStreaming,
  getWsUrl,
  parseDeferredTranslateNdjsonResponse,
  parseSttTranscriptMessage,
} from './use-realtime-stt'

describe('use-realtime-stt pure logic', () => {
  const originalWsUrl = process.env.NEXT_PUBLIC_WS_URL

  afterEach(() => {
    if (originalWsUrl === undefined) {
      delete process.env.NEXT_PUBLIC_WS_URL
    } else {
      process.env.NEXT_PUBLIC_WS_URL = originalWsUrl
    }
    vi.unstubAllGlobals()
  })

  it('prefers NEXT_PUBLIC_WS_URL over inferred ws URL', () => {
    process.env.NEXT_PUBLIC_WS_URL = 'wss://97e1-183-96-5-234.ngrok-free.app'
    vi.stubGlobal('window', {
      location: {
        hostname: 'localhost',
        protocol: 'http:',
      },
    })

    expect(getWsUrl()).toBe('wss://97e1-183-96-5-234.ngrok-free.app')
  })

  it('infers ws/wss from page protocol when env override is absent', () => {
    delete process.env.NEXT_PUBLIC_WS_URL

    vi.stubGlobal('window', {
      location: {
        hostname: 'mingle.local',
        protocol: 'http:',
      },
    })
    expect(getWsUrl()).toBe('ws://mingle.local:3001')

    vi.stubGlobal('window', {
      location: {
        hostname: 'mingle.app',
        protocol: 'https:',
      },
    })
    expect(getWsUrl()).toBe('wss://mingle.app:3001')
  })

  it('parses transcript message payload and normalizes text', () => {
    const parsed = parseSttTranscriptMessage({
      type: 'transcript',
      data: {
        is_final: true,
        utterance: {
          text: ' <fin> ... Hello there ',
          language: 'en-US',
        },
      },
    })

    expect(parsed).toEqual({
      rawText: ' <fin> ... Hello there ',
      text: 'Hello there',
      language: 'en-US',
      isFinal: true,
    })
  })

  it('returns null for malformed non-transcript payloads', () => {
    expect(parseSttTranscriptMessage({ type: 'ready' })).toBeNull()
    expect(parseSttTranscriptMessage({ type: 'transcript', data: null })).toBeNull()
    expect(parseSttTranscriptMessage({ type: 'transcript', data: { utterance: null } })).toBeNull()
  })

  it('builds finalized utterance payload with source-language filtering', () => {
    const built = buildFinalizedUtterancePayload({
      rawText: ' <end> hello everyone ',
      rawLanguage: 'en-US',
      languages: ['en', 'ko', 'ja', 'KO'],
      partialTranslations: {
        en: 'self',
        ko: ' 안녕하세요 ',
        ja: ' こんにちは ',
        blank: '   ',
      },
      utteranceSerial: 7,
      nowMs: 1700000000000,
    })

    expect(built).not.toBeNull()
    expect(built?.utteranceId).toBe('u-1700000000000-7')
    expect(built?.text).toBe('hello everyone')
    expect(built?.language).toBe('en-US')
    expect(built?.utterance).toEqual({
      id: 'u-1700000000000-7',
      originalText: 'hello everyone',
      originalLang: 'en-US',
      targetLanguages: ['ko', 'ja'],
      translations: {
        ko: '안녕하세요',
        ja: 'こんにちは',
      },
      translationFinalized: {
        ko: false,
        ja: false,
      },
      createdAtMs: 1700000000000,
    })
    expect(built?.currentTurnPreviousState).toEqual({
      sourceLanguage: 'en-US',
      sourceText: 'hello everyone',
      translations: {
        ko: '안녕하세요',
        ja: 'こんにちは',
      },
    })
  })

  it('returns null when final text is only markers/noise', () => {
    const built = buildFinalizedUtterancePayload({
      rawText: ' <fin> ... ',
      rawLanguage: 'ko',
      languages: ['ko', 'en'],
      partialTranslations: {},
      utteranceSerial: 1,
      nowMs: 1700000000000,
    })

    expect(built).toBeNull()
  })

  it('detects deferred streaming capability by runtime globals', () => {
    expect(canUseDeferredTtsStreaming()).toBe(true)
    vi.stubGlobal('ReadableStream', undefined as unknown as typeof ReadableStream)
    expect(canUseDeferredTtsStreaming()).toBe(false)
  })

  it('parses NDJSON stream and emits deferred TTS payload after translation', async () => {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('{"type":"translation","translations":{"ko":"안녕하세요"},"provider":"gemini","model":"test","ttsDeferred":true,"ttsLanguage":"ko"}\n'))
        controller.enqueue(encoder.encode('{"type":"tts","ttsLanguage":"ko","ttsAudioBase64":"YWJj","ttsAudioMime":"audio/mpeg"}\n{"type":"done"}\n'))
        controller.close()
      },
    })
    const response = new Response(stream, {
      headers: { 'Content-Type': 'application/x-ndjson; charset=utf-8' },
    })
    const deferredTts: Array<{ ttsLanguage?: string, ttsAudioBase64?: string }> = []

    const result = await parseDeferredTranslateNdjsonResponse({
      response,
      onDeferredTts: (payload) => deferredTts.push({
        ttsLanguage: payload.ttsLanguage,
        ttsAudioBase64: payload.ttsAudioBase64,
      }),
    })

    expect(result.translations).toEqual({ ko: '안녕하세요' })
    expect(result.provider).toBe('gemini')
    expect(result.model).toBe('test')
    expect(result.ttsDeferred).toBe(true)
    expect(deferredTts).toEqual([
      { ttsLanguage: 'ko', ttsAudioBase64: 'YWJj' },
    ])
  })

  it('falls back to response.text() parsing when stream body is unavailable', async () => {
    const response = {
      body: null,
      text: async () => [
        '{"type":"translation","translations":{"ko":"반갑습니다"},"provider":"gemini","model":"fallback","ttsDeferred":true,"ttsLanguage":"ko"}',
        '{"type":"done"}',
      ].join('\n'),
    } as unknown as Response
    const deferredTts: Array<{ ttsLanguage?: string }> = []

    const result = await parseDeferredTranslateNdjsonResponse({
      response,
      onDeferredTts: (payload) => deferredTts.push({ ttsLanguage: payload.ttsLanguage }),
    })

    expect(result.translations).toEqual({ ko: '반갑습니다' })
    expect(result.ttsDeferred).toBe(true)
    expect(deferredTts).toEqual([{ ttsLanguage: 'ko' }])
  })
})

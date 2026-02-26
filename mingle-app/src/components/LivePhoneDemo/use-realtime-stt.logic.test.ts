import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildFinalizedUtterancePayload,
  getWsUrl,
  parseSttTranscriptMessage,
  resolveSpeakerForTranscript,
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

  it('normalizes speaker id from transcript payload', () => {
    const parsed = parseSttTranscriptMessage({
      type: 'transcript',
      data: {
        is_final: false,
        utterance: {
          text: 'hello',
          language: 'en',
          speaker: 'Speaker 2',
        },
      },
    })

    expect(parsed?.speaker).toBe('speaker_2')
  })

  it('falls back to top-level speaker when utterance speaker is missing', () => {
    const parsed = parseSttTranscriptMessage({
      type: 'transcript',
      data: {
        is_final: false,
        speaker: '3',
        utterance: {
          text: 'hello',
          language: 'en',
        },
      },
    })

    expect(parsed?.speaker).toBe('speaker_3')
  })

  it('resolves unknown final speaker to matching partial speaker', () => {
    const speaker = resolveSpeakerForTranscript(
      undefined,
      'hello from speaker two',
      'en',
      {
        speaker_1: {
          text: 'hello from speaker one',
          language: 'en',
          updatedAtMs: 100,
        },
        speaker_2: {
          text: 'hello from speaker two',
          language: 'en',
          updatedAtMs: 110,
        },
      },
    )

    expect(speaker).toBe('speaker_2')
  })

  it('keeps speaker_unknown when partial matches are ambiguous', () => {
    const speaker = resolveSpeakerForTranscript(
      undefined,
      'same text',
      'en',
      {
        speaker_1: {
          text: 'same text',
          language: 'en',
          updatedAtMs: 100,
        },
        speaker_2: {
          text: 'same text',
          language: 'en',
          updatedAtMs: 100,
        },
      },
    )

    expect(speaker).toBe('speaker_unknown')
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

  it('keeps normalized speaker on finalized utterance payload', () => {
    const built = buildFinalizedUtterancePayload({
      rawText: 'hello',
      rawLanguage: 'en-US',
      rawSpeaker: 'speaker 7',
      languages: ['en', 'ko'],
      partialTranslations: {},
      utteranceSerial: 9,
      nowMs: 1700000000000,
    })

    expect(built?.speaker).toBe('speaker_7')
    expect(built?.utterance.speaker).toBe('speaker_7')
  })

  it('normalizes numeric speaker ids in finalized payload', () => {
    const built = buildFinalizedUtterancePayload({
      rawText: 'hello',
      rawLanguage: 'en',
      rawSpeaker: '2',
      languages: ['en', 'ko'],
      partialTranslations: {},
      utteranceSerial: 10,
      nowMs: 1700000000000,
    })

    expect(built?.speaker).toBe('speaker_2')
    expect(built?.utterance.speaker).toBe('speaker_2')
  })
})

import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type JsonObject = Record<string, unknown>

type FinalTurn = {
  text: string
  language: string
}

type Pcm16MonoWav = {
  sampleRate: number
  pcm: Buffer
}

const LIVE_TEST_TIMEOUT_MS = readEnvInt('MINGLE_TEST_TIMEOUT_MS', 90_000)
const WS_CONNECT_TIMEOUT_MS = readEnvInt('MINGLE_TEST_WS_CONNECT_TIMEOUT_MS', 10_000)
const WS_READY_TIMEOUT_MS = readEnvInt('MINGLE_TEST_WS_READY_TIMEOUT_MS', 20_000)
const STT_FINAL_TIMEOUT_MS = readEnvInt('MINGLE_TEST_STT_FINAL_TIMEOUT_MS', 60_000)
const API_TIMEOUT_MS = readEnvInt('MINGLE_TEST_API_TIMEOUT_MS', 30_000)
const STREAM_CHUNK_MS = readEnvInt('MINGLE_TEST_STREAM_CHUNK_MS', 40)
const STREAM_SEND_DELAY_MS = readEnvInt('MINGLE_TEST_STREAM_SEND_DELAY_MS', 15)

const API_BASE_URL = readEnvString('MINGLE_TEST_API_BASE_URL', 'http://127.0.0.1:3000')
const STT_WS_URL = readEnvString('MINGLE_TEST_WS_URL', 'ws://127.0.0.1:3001')
const STT_MODEL = readEnvString('MINGLE_TEST_STT_MODEL', 'soniox')
const SOURCE_LANGUAGE = readEnvString('MINGLE_TEST_SOURCE_LANGUAGE', 'en')
const TARGET_LANGUAGE = readEnvString('MINGLE_TEST_TARGET_LANGUAGE', 'ko')
const EXPECTED_PHRASE = readEnvString('MINGLE_TEST_EXPECTED_PHRASE', '')
const FALLBACK_TRANSLATION = readEnvString('MINGLE_TEST_FALLBACK_TRANSLATION', '테스트 폴백 번역')
const AUDIO_FIXTURE_PATH = readEnvString(
  'MINGLE_TEST_AUDIO_FIXTURE',
  path.resolve(process.cwd(), 'test-fixtures/audio/fixtures/stt-smoke.en.wav'),
)

function readEnvString(name: string, fallback: string): string {
  const value = process.env[name]
  if (!value) return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function asRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) return null
  return value as JsonObject
}

function decodeWsData(data: unknown): string {
  if (typeof data === 'string') return data
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString('utf8')
  }
  if (ArrayBuffer.isView(data)) {
    return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('utf8')
  }
  return ''
}

function parseWsJsonMessage(event: MessageEvent): JsonObject | null {
  const raw = decodeWsData(event.data)
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as unknown
    return asRecord(parsed)
  } catch {
    return null
  }
}

function parsePcm16MonoWav(filePath: string): Pcm16MonoWav {
  if (!fs.existsSync(filePath)) {
    throw new Error([
      '[live-test] audio fixture not found',
      `- expected path: ${filePath}`,
      '- add a 16-bit PCM mono WAV fixture and run again.',
    ].join('\n'))
  }

  const raw = fs.readFileSync(filePath)
  if (raw.length < 44) {
    throw new Error(`[live-test] invalid wav fixture (too short): ${filePath}`)
  }
  if (raw.toString('ascii', 0, 4) !== 'RIFF' || raw.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error(`[live-test] invalid wav fixture (RIFF/WAVE required): ${filePath}`)
  }

  let offset = 12
  let format: { audioFormat: number, numChannels: number, sampleRate: number, bitsPerSample: number } | null = null
  let dataChunk: Buffer | null = null

  while (offset + 8 <= raw.length) {
    const chunkId = raw.toString('ascii', offset, offset + 4)
    const chunkSize = raw.readUInt32LE(offset + 4)
    const chunkStart = offset + 8
    const chunkEnd = chunkStart + chunkSize
    if (chunkEnd > raw.length) break

    if (chunkId === 'fmt ' && chunkSize >= 16) {
      format = {
        audioFormat: raw.readUInt16LE(chunkStart),
        numChannels: raw.readUInt16LE(chunkStart + 2),
        sampleRate: raw.readUInt32LE(chunkStart + 4),
        bitsPerSample: raw.readUInt16LE(chunkStart + 14),
      }
    }
    if (chunkId === 'data') {
      dataChunk = raw.subarray(chunkStart, chunkEnd)
    }

    offset = chunkEnd + (chunkSize % 2)
  }

  if (!format || !dataChunk) {
    throw new Error(`[live-test] invalid wav fixture (missing fmt/data chunk): ${filePath}`)
  }
  if (format.audioFormat !== 1) {
    throw new Error(`[live-test] unsupported wav encoding (PCM only): ${filePath}`)
  }
  if (format.numChannels !== 1) {
    throw new Error(`[live-test] unsupported wav channel count (mono only): ${filePath}`)
  }
  if (format.bitsPerSample !== 16) {
    throw new Error(`[live-test] unsupported wav bit depth (16-bit only): ${filePath}`)
  }

  return {
    sampleRate: format.sampleRate,
    pcm: dataChunk,
  }
}

function splitPcmIntoChunks(pcm: Buffer, sampleRate: number, chunkMs: number): Buffer[] {
  const bytesPerSample = 2
  const bytesPerSecond = sampleRate * bytesPerSample
  const approxChunkBytes = Math.floor((bytesPerSecond * chunkMs) / 1000)
  const chunkBytes = Math.max(bytesPerSample, approxChunkBytes - (approxChunkBytes % bytesPerSample))
  const chunks: Buffer[] = []

  for (let cursor = 0; cursor < pcm.length; cursor += chunkBytes) {
    chunks.push(pcm.subarray(cursor, Math.min(pcm.length, cursor + chunkBytes)))
  }

  return chunks
}

function waitForOpen(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`[live-test] websocket open timeout (${timeoutMs}ms): ${STT_WS_URL}`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('open', onOpen)
      ws.removeEventListener('error', onError)
      ws.removeEventListener('close', onClose)
    }
    const onOpen = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new Error(`[live-test] websocket connection error: ${STT_WS_URL}`))
    }
    const onClose = (event: CloseEvent) => {
      cleanup()
      reject(new Error(`[live-test] websocket closed before open: code=${event.code} reason=${event.reason || 'none'}`))
    }

    ws.addEventListener('open', onOpen)
    ws.addEventListener('error', onError)
    ws.addEventListener('close', onClose)
  })
}

function waitForReady(ws: WebSocket, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`[live-test] did not receive STT ready event within ${timeoutMs}ms`))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
      ws.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent) => {
      const message = parseWsJsonMessage(event)
      if (!message) return
      if (message.status === 'ready') {
        cleanup()
        resolve()
      }
    }

    const onClose = (event: CloseEvent) => {
      cleanup()
      reject(new Error(`[live-test] websocket closed before ready: code=${event.code} reason=${event.reason || 'none'}`))
    }

    const onError = () => {
      cleanup()
      reject(new Error('[live-test] websocket error before ready'))
    }

    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onClose)
    ws.addEventListener('error', onError)
  })
}

function extractFinalTurn(message: JsonObject): FinalTurn | null {
  const type = typeof message.type === 'string' ? message.type : ''

  if (type === 'transcript') {
    const data = asRecord(message.data)
    const utterance = asRecord(data?.utterance)
    if (data?.is_final !== true) return null
    const text = typeof utterance?.text === 'string' ? utterance.text.trim() : ''
    const language = typeof utterance?.language === 'string' ? utterance.language.trim() : ''
    if (!text) return null
    return { text, language: language || 'unknown' }
  }

  if (type === 'stop_recording_ack') {
    const data = asRecord(message.data)
    const finalTurn = asRecord(data?.final_turn)
    const text = typeof finalTurn?.text === 'string' ? finalTurn.text.trim() : ''
    const language = typeof finalTurn?.language === 'string' ? finalTurn.language.trim() : ''
    if (!text) return null
    return { text, language: language || 'unknown' }
  }

  return null
}

function waitForFinalTurn(ws: WebSocket, timeoutMs: number): Promise<FinalTurn> {
  return new Promise((resolve, reject) => {
    const observedTypes: string[] = []
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error([
        `[live-test] did not receive final transcript within ${timeoutMs}ms`,
        `- observed message types: ${observedTypes.join(', ') || '(none)'}`,
      ].join('\n')))
    }, timeoutMs)

    const cleanup = () => {
      clearTimeout(timeoutId)
      ws.removeEventListener('message', onMessage)
      ws.removeEventListener('close', onClose)
      ws.removeEventListener('error', onError)
    }

    const onMessage = (event: MessageEvent) => {
      const message = parseWsJsonMessage(event)
      if (!message) return

      const type = typeof message.type === 'string'
        ? message.type
        : (typeof message.status === 'string' ? `status:${message.status}` : 'unknown')
      observedTypes.push(type)

      const finalTurn = extractFinalTurn(message)
      if (finalTurn) {
        cleanup()
        resolve(finalTurn)
      }
    }

    const onClose = (event: CloseEvent) => {
      cleanup()
      reject(new Error([
        '[live-test] websocket closed before final transcript',
        `- code=${event.code} reason=${event.reason || 'none'}`,
        `- observed message types: ${observedTypes.join(', ') || '(none)'}`,
      ].join('\n')))
    }

    const onError = () => {
      cleanup()
      reject(new Error('[live-test] websocket error while waiting for final transcript'))
    }

    ws.addEventListener('message', onMessage)
    ws.addEventListener('close', onClose)
    ws.addEventListener('error', onError)
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

async function fetchJsonWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ status: number, json: JsonObject, rawText: string }> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, { ...init, signal: controller.signal })
    const rawText = await response.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(rawText)
    } catch {
      throw new Error([
        `[live-test] expected JSON response from ${url}`,
        `- status: ${response.status}`,
        `- body preview: ${rawText.slice(0, 400)}`,
      ].join('\n'))
    }
    const json = asRecord(parsed)
    if (!json) {
      throw new Error(`[live-test] JSON response is not an object: ${url}`)
    }
    return { status: response.status, json, rawText }
  } finally {
    clearTimeout(timeoutId)
  }
}

async function streamAudioFixtureToStt(): Promise<FinalTurn> {
  const fixture = parsePcm16MonoWav(AUDIO_FIXTURE_PATH)
  const chunks = splitPcmIntoChunks(fixture.pcm, fixture.sampleRate, STREAM_CHUNK_MS)
  if (chunks.length === 0) {
    throw new Error(`[live-test] audio fixture has no PCM frames: ${AUDIO_FIXTURE_PATH}`)
  }

  const ws = new WebSocket(STT_WS_URL)

  await waitForOpen(ws, WS_CONNECT_TIMEOUT_MS)
  ws.send(JSON.stringify({
    sample_rate: fixture.sampleRate,
    languages: [SOURCE_LANGUAGE],
    stt_model: STT_MODEL,
    lang_hints_strict: true,
  }))
  await waitForReady(ws, WS_READY_TIMEOUT_MS)

  const finalTurnPromise = waitForFinalTurn(ws, STT_FINAL_TIMEOUT_MS)
  for (const chunk of chunks) {
    ws.send(JSON.stringify({
      type: 'audio_chunk',
      data: {
        chunk: chunk.toString('base64'),
      },
    }))
    await sleep(STREAM_SEND_DELAY_MS)
  }

  ws.send(JSON.stringify({
    type: 'stop_recording',
    data: {
      pending_text: '',
      pending_language: SOURCE_LANGUAGE,
    },
  }))

  try {
    return await finalTurnPromise
  } finally {
    try {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close()
      }
    } catch {
      // no-op
    }
  }
}

describe.sequential('local live integration: stt websocket + finalize api', () => {
  let capturedFinalTurn: FinalTurn | null = null

  it('streams fixture audio to local STT websocket and receives a final transcript', async () => {
    capturedFinalTurn = await streamAudioFixtureToStt()

    expect(capturedFinalTurn.text.length).toBeGreaterThan(0)
    expect(capturedFinalTurn.language.length).toBeGreaterThan(0)

    if (EXPECTED_PHRASE) {
      const actual = normalizeText(capturedFinalTurn.text)
      const expected = normalizeText(EXPECTED_PHRASE)
      expect(actual).toContain(expected)
    }
  }, LIVE_TEST_TIMEOUT_MS)

  it('sends the finalized transcript to local /api/translate/finalize', async (context) => {
    if (!capturedFinalTurn) {
      context.skip()
      return
    }

    const requestBody = {
      text: capturedFinalTurn.text,
      sourceLanguage: capturedFinalTurn.language,
      targetLanguages: [TARGET_LANGUAGE],
      currentTurnPreviousState: {
        sourceLanguage: capturedFinalTurn.language,
        sourceText: capturedFinalTurn.text,
        translations: {
          [TARGET_LANGUAGE]: FALLBACK_TRANSLATION,
        },
      },
    }

    const { status, json, rawText } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/api/translate/finalize`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
      },
      API_TIMEOUT_MS,
    )

    if (status === 500 && json.error === 'No translation API key configured') {
      throw new Error([
        '[live-test] GEMINI_API_KEY is missing in the running API server environment.',
        '- set GEMINI_API_KEY in the API server env and run pnpm test again.',
      ].join('\n'))
    }

    expect([200, 502]).toContain(status)

    if (status === 200) {
      const translations = asRecord(json.translations)
      expect(translations).not.toBeNull()
      const translatedText = typeof translations?.[TARGET_LANGUAGE] === 'string'
        ? translations[TARGET_LANGUAGE] as string
        : ''
      expect(translatedText.trim().length).toBeGreaterThan(0)
      return
    }

    const error = typeof json.error === 'string' ? json.error : ''
    expect(error).toBe('empty_translation_response')
    expect(rawText.length).toBeGreaterThan(0)
  }, LIVE_TEST_TIMEOUT_MS)
})

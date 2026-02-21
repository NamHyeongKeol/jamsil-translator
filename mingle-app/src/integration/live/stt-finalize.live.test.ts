import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { afterAll, describe, expect, it } from 'vitest'
import { WebSocket as NodeWebSocket } from 'ws'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    NodeWebSocket as unknown as typeof WebSocket
}

type JsonObject = Record<string, unknown>

type FinalTurn = {
  text: string
  language: string
}

type Pcm16MonoWav = {
  sampleRate: number
  pcm: Buffer
}

type AudioFixtureType = 'wav' | 'transcode' | 'unsupported'
type AudioTranscoder = 'ffmpeg' | 'afconvert'

const LIVE_TEST_TIMEOUT_MS = readEnvInt('MINGLE_TEST_TIMEOUT_MS', 90_000)
const WS_CONNECT_TIMEOUT_MS = readEnvInt('MINGLE_TEST_WS_CONNECT_TIMEOUT_MS', 10_000)
const WS_READY_TIMEOUT_MS = readEnvInt('MINGLE_TEST_WS_READY_TIMEOUT_MS', 20_000)
const STT_FINAL_TIMEOUT_MS = readEnvInt('MINGLE_TEST_STT_FINAL_TIMEOUT_MS', 60_000)
const API_TIMEOUT_MS = readEnvInt('MINGLE_TEST_API_TIMEOUT_MS', 30_000)
const STREAM_CHUNK_MS = readEnvInt('MINGLE_TEST_STREAM_CHUNK_MS', 40)
const STREAM_SEND_DELAY_MS = readEnvInt('MINGLE_TEST_STREAM_SEND_DELAY_MS', STREAM_CHUNK_MS)

const API_BASE_URL = readEnvString('MINGLE_TEST_API_BASE_URL', 'http://127.0.0.1:3000')
const API_NAMESPACE = normalizeApiNamespace(
  readEnvString('MINGLE_TEST_API_NAMESPACE', 'web/app/v1'),
)
const STT_WS_URL = readEnvString('MINGLE_TEST_WS_URL', 'ws://127.0.0.1:3001')
const STT_MODEL = readEnvString('MINGLE_TEST_STT_MODEL', 'soniox')
const SOURCE_LANGUAGE_HINT = readEnvString('MINGLE_TEST_SOURCE_LANGUAGE', 'en')
const TARGET_LANGUAGES_OVERRIDE = readEnvOptionalString('MINGLE_TEST_TARGET_LANGUAGES')
const TTS_LANGUAGE_OVERRIDE = readEnvOptionalString('MINGLE_TEST_TTS_LANGUAGE')
const EXPECTED_PHRASE = readEnvString('MINGLE_TEST_EXPECTED_PHRASE', '')
const FALLBACK_TRANSLATION = readEnvString('MINGLE_TEST_FALLBACK_TRANSLATION', '테스트 폴백 번역')
const AUDIO_FIXTURE_OVERRIDE = readEnvOptionalString('MINGLE_TEST_AUDIO_FIXTURE')
const AUDIO_FIXTURE_DIR_OVERRIDE = readEnvOptionalString('MINGLE_TEST_AUDIO_FIXTURE_DIR')
const AUDIO_FIXTURE_SCAN_DIRS = [
  path.resolve(process.cwd(), 'test-fixtures/audio/fixtures'),
  path.resolve(process.cwd(), 'test-fixtures/audio/local'),
]
const AUDIO_FIXTURE_CANDIDATES = collectAudioFixtureCandidates()
const describeWithFixtureCandidates = AUDIO_FIXTURE_CANDIDATES.length > 0 ? describe.sequential : describe.skip
const AUDIO_TRANSCODER = detectAudioTranscoder()
const TTS_OUTPUT_DIR = readEnvString(
  'MINGLE_TEST_TTS_OUTPUT_DIR',
  path.resolve(process.cwd(), 'test-fixtures/audio/local/tts-output'),
)
const TRANSCODE_EXTENSIONS = new Set([
  '.m4a',
  '.mp3',
  '.aac',
  '.flac',
  '.ogg',
  '.webm',
  '.mp4',
  '.caf',
  '.aif',
  '.aiff',
])

function readEnvString(name: string, fallback: string): string {
  const value = process.env[name]
  if (!value) return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

function readEnvOptionalString(name: string): string | null {
  const value = process.env[name]
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

function normalizeApiNamespace(value: string): string {
  return value.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

function commandExists(command: string): boolean {
  const result = spawnSync('which', [command], { stdio: 'ignore' })
  return result.status === 0
}

function detectAudioTranscoder(): AudioTranscoder | null {
  if (commandExists('ffmpeg')) return 'ffmpeg'
  if (process.platform === 'darwin' && commandExists('afconvert')) return 'afconvert'
  return null
}

function collectAudioFixtureCandidates(): string[] {
  if (AUDIO_FIXTURE_OVERRIDE) {
    return [path.resolve(process.cwd(), AUDIO_FIXTURE_OVERRIDE)]
  }

  const scanDirs = AUDIO_FIXTURE_DIR_OVERRIDE
    ? [path.resolve(process.cwd(), AUDIO_FIXTURE_DIR_OVERRIDE)]
    : AUDIO_FIXTURE_SCAN_DIRS

  const files = new Set<string>()
  for (const scanDir of scanDirs) {
    if (!fs.existsSync(scanDir)) continue
    for (const entry of fs.readdirSync(scanDir, { withFileTypes: true })) {
      if (!entry.isFile()) continue
      if (entry.name.startsWith('.')) continue
      files.add(path.resolve(scanDir, entry.name))
    }
  }

  return [...files].sort((a, b) => a.localeCompare(b))
}

function classifyAudioFixture(filePath: string): AudioFixtureType {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.wav') return 'wav'
  if (TRANSCODE_EXTENSIONS.has(ext)) return 'transcode'
  return 'unsupported'
}

function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}

function normalizeLangCode(input: string): string {
  return input.trim().replace('_', '-').toLowerCase().split('-')[0] || ''
}

function parseTargetLanguagesOverride(): string[] {
  if (!TARGET_LANGUAGES_OVERRIDE) return []
  const normalized = TARGET_LANGUAGES_OVERRIDE
    .split(',')
    .map(item => normalizeLangCode(item))
    .filter(Boolean)
  return [...new Set(normalized)]
}

function pickDefaultTargetLanguages(sourceLanguageRaw: string): string[] {
  const source = normalizeLangCode(sourceLanguageRaw)
  if (source === 'en') return ['ko']
  if (source === 'ko') return ['en']
  return ['ko', 'en']
}

const OVERRIDE_TARGET_LANGUAGES = parseTargetLanguagesOverride()

function buildTranslationPlan(sourceLanguageRaw: string): { targetLanguages: string[], ttsLanguage: string | null } {
  const sourceLanguage = normalizeLangCode(sourceLanguageRaw) || normalizeLangCode(SOURCE_LANGUAGE_HINT) || 'en'
  const candidates = OVERRIDE_TARGET_LANGUAGES.length > 0
    ? OVERRIDE_TARGET_LANGUAGES
    : pickDefaultTargetLanguages(sourceLanguage)

  const targetLanguages = candidates.filter(language => normalizeLangCode(language) !== sourceLanguage)
  const uniqueTargets = [...new Set(targetLanguages)]

  if (uniqueTargets.length === 0) {
    return { targetLanguages: [], ttsLanguage: null }
  }

  const ttsOverride = TTS_LANGUAGE_OVERRIDE ? normalizeLangCode(TTS_LANGUAGE_OVERRIDE) : ''
  const ttsLanguage = ttsOverride && uniqueTargets.includes(ttsOverride)
    ? ttsOverride
    : uniqueTargets[0]

  return {
    targetLanguages: uniqueTargets,
    ttsLanguage,
  }
}

function extensionFromMime(mime: string): string {
  const normalized = mime.trim().toLowerCase()
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('aac')) return 'aac'
  return 'bin'
}

function sanitizeFileToken(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return sanitized || 'fixture'
}

function saveTtsAudioArtifact(args: {
  fixtureName: string
  ttsLanguage: string
  ttsMime: string
  ttsAudioBase64: string
}): string {
  const audioBuffer = Buffer.from(args.ttsAudioBase64, 'base64')
  if (audioBuffer.length === 0) {
    throw new Error('[live-test] empty TTS audio payload')
  }

  fs.mkdirSync(TTS_OUTPUT_DIR, { recursive: true })
  const extension = extensionFromMime(args.ttsMime)
  const fileName = [
    new Date().toISOString().replace(/[:.]/g, '-'),
    sanitizeFileToken(args.fixtureName),
    sanitizeFileToken(args.ttsLanguage || 'unknown'),
  ].join('__') + `.${extension}`
  const outputPath = path.join(TTS_OUTPUT_DIR, fileName)
  fs.writeFileSync(outputPath, audioBuffer)
  return outputPath
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

function transcodeAudioToPcmWav(inputPath: string, outputPath: string): void {
  if (!AUDIO_TRANSCODER) {
    throw new Error([
      '[live-test] no audio transcoder found for non-wav fixture.',
      '- install ffmpeg (recommended), or use PCM16 mono WAV fixtures.',
    ].join('\n'))
  }

  if (AUDIO_TRANSCODER === 'ffmpeg') {
    const result = spawnSync(
      'ffmpeg',
      ['-v', 'error', '-y', '-i', inputPath, '-ar', '16000', '-ac', '1', '-sample_fmt', 's16', outputPath],
      { encoding: 'utf8' },
    )
    if (result.status !== 0) {
      throw new Error([
        '[live-test] ffmpeg transcode failed',
        `- input: ${inputPath}`,
        `- stderr: ${(result.stderr || '').trim() || '(empty)'}`,
      ].join('\n'))
    }
    return
  }

  const afconvert = spawnSync(
    'afconvert',
    ['-f', 'WAVE', '-d', 'LEI16@16000', '-c', '1', inputPath, outputPath],
    { encoding: 'utf8' },
  )
  if (afconvert.status !== 0) {
    throw new Error([
      '[live-test] afconvert transcode failed',
      `- input: ${inputPath}`,
      `- stderr: ${(afconvert.stderr || '').trim() || '(empty)'}`,
    ].join('\n'))
  }
}

function loadFixtureAsPcm16MonoWav(filePath: string): Pcm16MonoWav {
  const fixtureType = classifyAudioFixture(filePath)
  if (fixtureType === 'unsupported') {
    throw new Error(`[live-test] unsupported fixture extension: ${path.extname(filePath).toLowerCase() || '(none)'}`)
  }

  if (fixtureType === 'wav') {
    return parsePcm16MonoWav(filePath)
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mingle-live-audio-'))
  const convertedWavPath = path.join(tempDir, 'converted.wav')

  try {
    transcodeAudioToPcmWav(filePath, convertedWavPath)
    return parsePcm16MonoWav(convertedWavPath)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
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

async function streamAudioFixtureToStt(fixture: Pcm16MonoWav): Promise<FinalTurn> {
  const chunks = splitPcmIntoChunks(fixture.pcm, fixture.sampleRate, STREAM_CHUNK_MS)
  if (chunks.length === 0) {
    throw new Error('[live-test] audio fixture has no PCM frames')
  }

  const ws = new WebSocket(STT_WS_URL)

  await waitForOpen(ws, WS_CONNECT_TIMEOUT_MS)
  ws.send(JSON.stringify({
    sample_rate: fixture.sampleRate,
    languages: [SOURCE_LANGUAGE_HINT],
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
      pending_language: SOURCE_LANGUAGE_HINT,
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

async function runFinalizeApiCheck(finalTurn: FinalTurn, fixtureName: string): Promise<void> {
    const plan = buildTranslationPlan(finalTurn.language)
    if (plan.targetLanguages.length === 0) {
      throw new Error('[live-test] target language plan is empty; check language settings.')
    }

    const requestBody = {
      text: finalTurn.text,
      sourceLanguage: finalTurn.language,
      targetLanguages: plan.targetLanguages,
      currentTurnPreviousState: {
        sourceLanguage: finalTurn.language,
        sourceText: finalTurn.text,
        translations: Object.fromEntries(
          plan.targetLanguages.map(language => [language, FALLBACK_TRANSLATION]),
        ),
      },
      ...(plan.ttsLanguage ? { tts: { enabled: true, language: plan.ttsLanguage } } : {}),
    }

    const { status, json, rawText } = await fetchJsonWithTimeout(
      `${API_BASE_URL}/api/${API_NAMESPACE}/translate/finalize`,
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
      const nonEmptyTranslations = plan.targetLanguages
        .map(language => {
          const value = translations?.[language]
          return typeof value === 'string' ? value.trim() : ''
        })
        .filter(Boolean)
      expect(nonEmptyTranslations.length).toBeGreaterThan(0)

      console.info([
        '[live-test][gemini]',
        `fixture=${fixtureName}`,
        `sourceLanguage=${finalTurn.language}`,
        `targets=${plan.targetLanguages.join(',')}`,
        `translations=${JSON.stringify(translations)}`,
      ].join(' '))

      const ttsAudioBase64 = typeof json.ttsAudioBase64 === 'string' ? json.ttsAudioBase64 : ''
      const ttsAudioMime = typeof json.ttsAudioMime === 'string' ? json.ttsAudioMime : 'application/octet-stream'
      const ttsLanguage = typeof json.ttsLanguage === 'string'
        ? normalizeLangCode(json.ttsLanguage)
        : (plan.ttsLanguage || 'unknown')

      if (ttsAudioBase64) {
        const savedPath = saveTtsAudioArtifact({
          fixtureName,
          ttsLanguage,
          ttsMime: ttsAudioMime,
          ttsAudioBase64,
        })
        console.info([
          '[live-test][tts]',
          `fixture=${fixtureName}`,
          `language=${ttsLanguage}`,
          `mime=${ttsAudioMime}`,
          `saved=${savedPath}`,
        ].join(' '))
      } else {
        console.info([
          '[live-test][tts]',
          `fixture=${fixtureName}`,
          'not_returned',
        ].join(' '))
      }
      return
    }

    const error = typeof json.error === 'string' ? json.error : ''
    console.warn([
      '[live-test][gemini]',
      `fixture=${fixtureName}`,
      `status=${status}`,
      `error=${error || 'unknown'}`,
      `body=${rawText.slice(0, 500)}`,
    ].join(' '))
    expect(error).toBe('empty_translation_response')
    expect(rawText.length).toBeGreaterThan(0)
}

describeWithFixtureCandidates('local live integration: stt websocket + finalize api', () => {
  let processedValidFixtureCount = 0
  const scanDirs = AUDIO_FIXTURE_DIR_OVERRIDE
    ? [path.resolve(process.cwd(), AUDIO_FIXTURE_DIR_OVERRIDE)]
    : AUDIO_FIXTURE_SCAN_DIRS

  for (const fixturePath of AUDIO_FIXTURE_CANDIDATES) {
    const fixtureName = path.basename(fixturePath)
    it(`runs live flow for fixture: ${fixtureName}`, async () => {
      const fixtureType = classifyAudioFixture(fixturePath)
      if (fixtureType === 'unsupported') {
        console.warn(`[live-test][skip] unsupported extension: ${fixturePath}`)
        return
      }

      let fixture: Pcm16MonoWav
      try {
        fixture = loadFixtureAsPcm16MonoWav(fixturePath)
      } catch (error) {
        console.warn([
          `[live-test][skip] invalid fixture: ${fixturePath}`,
          formatError(error),
        ].join('\n'))
        return
      }

      if (fixtureType === 'transcode') {
        console.info(`[live-test] transcoded fixture via ${AUDIO_TRANSCODER}: ${fixturePath}`)
      }

      processedValidFixtureCount += 1

      const finalTurn = await streamAudioFixtureToStt(fixture)
      expect(finalTurn.text.length).toBeGreaterThan(0)
      expect(finalTurn.language.length).toBeGreaterThan(0)

      console.info([
        '[live-test][soniox]',
        `fixture=${fixtureName}`,
        `language=${finalTurn.language}`,
        `text=${JSON.stringify(finalTurn.text)}`,
      ].join(' '))

      if (EXPECTED_PHRASE) {
        const actual = normalizeText(finalTurn.text)
        const expected = normalizeText(EXPECTED_PHRASE)
        expect(actual).toContain(expected)
      }

      await runFinalizeApiCheck(finalTurn, fixtureName)
    }, LIVE_TEST_TIMEOUT_MS)
  }

  afterAll(() => {
    if (AUDIO_FIXTURE_CANDIDATES.length === 0) return
    if (processedValidFixtureCount > 0) return
    throw new Error([
      '[live-test] no valid audio fixture was processed.',
      `- scanned dirs: ${scanDirs.join(', ')}`,
      '- unsupported/invalid files are skipped; add at least one valid fixture.',
    ].join('\n'))
  })
})

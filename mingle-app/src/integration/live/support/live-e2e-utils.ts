import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { WebSocket as NodeWebSocket } from 'ws'

if (typeof globalThis.WebSocket === 'undefined') {
  ;(globalThis as unknown as { WebSocket: typeof WebSocket }).WebSocket =
    NodeWebSocket as unknown as typeof WebSocket
}

export type JsonObject = Record<string, unknown>

export type FinalTurn = {
  text: string
  language: string
  source: 'transcript' | 'stop_recording_ack'
}

export type Pcm16MonoWav = {
  sampleRate: number
  pcm: Buffer
}

export type AudioFixtureType = 'wav' | 'transcode' | 'unsupported'
export type AudioTranscoder = 'ffmpeg' | 'afconvert'

export type LiveE2EEnv = {
  liveTestTimeoutMs: number
  wsConnectTimeoutMs: number
  wsReadyTimeoutMs: number
  sttFinalTimeoutMs: number
  apiTimeoutMs: number
  streamChunkMs: number
  streamSendDelayMs: number
  apiBaseUrl: string
  sttWsUrl: string
  sttModel: string
  sourceLanguageHint: string
  targetLanguagesOverride: string | null
  ttsLanguageOverride: string | null
  fallbackTranslation: string
  expectedPhrase: string
  audioFixtureOverride: string | null
  audioFixtureDirOverride: string | null
  audioFixtureScanDirs: string[]
  ttsOutputDir: string
  audioTranscoder: AudioTranscoder | null
}

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

export function readEnvString(name: string, fallback: string): string {
  const value = process.env[name]
  if (!value) return fallback
  const trimmed = value.trim()
  return trimmed || fallback
}

export function readEnvOptionalString(name: string): string | null {
  const value = process.env[name]
  if (!value) return null
  const trimmed = value.trim()
  return trimmed || null
}

export function readEnvInt(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number.parseInt(value, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback
  return parsed
}

export function readEnvBool(name: string, fallback = false): boolean {
  const value = process.env[name]
  if (!value) return fallback
  const normalized = value.trim().toLowerCase()
  if (!normalized) return fallback
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on'
}

export function commandExists(command: string): boolean {
  const result = spawnSync('which', [command], { stdio: 'ignore' })
  return result.status === 0
}

export function detectAudioTranscoder(): AudioTranscoder | null {
  if (commandExists('ffmpeg')) return 'ffmpeg'
  if (process.platform === 'darwin' && commandExists('afconvert')) return 'afconvert'
  return null
}

export function readLiveE2EEnv(): LiveE2EEnv {
  const streamChunkMs = readEnvInt('MINGLE_TEST_STREAM_CHUNK_MS', 40)
  return {
    liveTestTimeoutMs: readEnvInt('MINGLE_TEST_TIMEOUT_MS', 90_000),
    wsConnectTimeoutMs: readEnvInt('MINGLE_TEST_WS_CONNECT_TIMEOUT_MS', 10_000),
    wsReadyTimeoutMs: readEnvInt('MINGLE_TEST_WS_READY_TIMEOUT_MS', 20_000),
    sttFinalTimeoutMs: readEnvInt('MINGLE_TEST_STT_FINAL_TIMEOUT_MS', 60_000),
    apiTimeoutMs: readEnvInt('MINGLE_TEST_API_TIMEOUT_MS', 30_000),
    streamChunkMs,
    streamSendDelayMs: readEnvInt('MINGLE_TEST_STREAM_SEND_DELAY_MS', streamChunkMs),
    apiBaseUrl: readEnvString('MINGLE_TEST_API_BASE_URL', 'http://127.0.0.1:3000'),
    sttWsUrl: readEnvString('MINGLE_TEST_WS_URL', 'ws://127.0.0.1:3001'),
    sttModel: readEnvString('MINGLE_TEST_STT_MODEL', 'soniox'),
    sourceLanguageHint: readEnvString('MINGLE_TEST_SOURCE_LANGUAGE', 'en'),
    targetLanguagesOverride: readEnvOptionalString('MINGLE_TEST_TARGET_LANGUAGES'),
    ttsLanguageOverride: readEnvOptionalString('MINGLE_TEST_TTS_LANGUAGE'),
    expectedPhrase: readEnvString('MINGLE_TEST_EXPECTED_PHRASE', ''),
    fallbackTranslation: readEnvString('MINGLE_TEST_FALLBACK_TRANSLATION', '테스트 폴백 번역'),
    audioFixtureOverride: readEnvOptionalString('MINGLE_TEST_AUDIO_FIXTURE'),
    audioFixtureDirOverride: readEnvOptionalString('MINGLE_TEST_AUDIO_FIXTURE_DIR'),
    audioFixtureScanDirs: [
      path.resolve(process.cwd(), 'test-fixtures/audio/fixtures'),
      path.resolve(process.cwd(), 'test-fixtures/audio/local'),
    ],
    ttsOutputDir: readEnvString(
      'MINGLE_TEST_TTS_OUTPUT_DIR',
      path.resolve(process.cwd(), 'test-fixtures/audio/local/tts-output'),
    ),
    audioTranscoder: detectAudioTranscoder(),
  }
}

export function formatError(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message
  }
  return String(error)
}

export function normalizeLangCode(input: string): string {
  return input.trim().replace('_', '-').toLowerCase().split('-')[0] || ''
}

export function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseTargetLanguagesOverride(targetLanguagesOverride: string | null): string[] {
  if (!targetLanguagesOverride) return []
  const normalized = targetLanguagesOverride
    .split(',')
    .map(item => normalizeLangCode(item))
    .filter(Boolean)
  return [...new Set(normalized)]
}

export function pickDefaultTargetLanguages(sourceLanguageRaw: string): string[] {
  const source = normalizeLangCode(sourceLanguageRaw)
  if (source === 'en') return ['ko']
  if (source === 'ko') return ['en']
  return ['ko', 'en']
}

export function buildTranslationPlan(args: {
  sourceLanguageRaw: string
  sourceLanguageHint: string
  targetLanguagesOverride: string | null
  ttsLanguageOverride: string | null
}): { sourceLanguage: string, targetLanguages: string[], ttsLanguage: string | null } {
  const sourceLanguage = normalizeLangCode(args.sourceLanguageRaw)
    || normalizeLangCode(args.sourceLanguageHint)
    || 'en'

  const overrideTargets = parseTargetLanguagesOverride(args.targetLanguagesOverride)
  const candidates = overrideTargets.length > 0
    ? overrideTargets
    : pickDefaultTargetLanguages(sourceLanguage)

  const targetLanguages = candidates.filter(language => normalizeLangCode(language) !== sourceLanguage)
  const uniqueTargets = [...new Set(targetLanguages)]

  if (uniqueTargets.length === 0) {
    return { sourceLanguage, targetLanguages: [], ttsLanguage: null }
  }

  const ttsOverride = args.ttsLanguageOverride ? normalizeLangCode(args.ttsLanguageOverride) : ''
  const ttsLanguage = ttsOverride && uniqueTargets.includes(ttsOverride)
    ? ttsOverride
    : uniqueTargets[0]

  return {
    sourceLanguage,
    targetLanguages: uniqueTargets,
    ttsLanguage,
  }
}

export function extensionFromMime(mime: string): string {
  const normalized = mime.trim().toLowerCase()
  if (normalized.includes('wav')) return 'wav'
  if (normalized.includes('mpeg') || normalized.includes('mp3')) return 'mp3'
  if (normalized.includes('ogg')) return 'ogg'
  if (normalized.includes('aac')) return 'aac'
  return 'bin'
}

export function sanitizeFileToken(input: string): string {
  const sanitized = input.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
  return sanitized || 'fixture'
}

export function asRecord(value: unknown): JsonObject | null {
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) return null
  return value as JsonObject
}

export function collectAudioFixtureCandidates(args: {
  audioFixtureOverride: string | null
  audioFixtureDirOverride: string | null
  audioFixtureScanDirs: string[]
}): string[] {
  if (args.audioFixtureOverride) {
    return [path.resolve(process.cwd(), args.audioFixtureOverride)]
  }

  const scanDirs = args.audioFixtureDirOverride
    ? [path.resolve(process.cwd(), args.audioFixtureDirOverride)]
    : args.audioFixtureScanDirs

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

export function classifyAudioFixture(filePath: string): AudioFixtureType {
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.wav') return 'wav'
  if (TRANSCODE_EXTENSIONS.has(ext)) return 'transcode'
  return 'unsupported'
}

export function parsePcm16MonoWav(filePath: string): Pcm16MonoWav {
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

function transcodeAudioToPcmWav(inputPath: string, outputPath: string, transcoder: AudioTranscoder): void {
  if (transcoder === 'ffmpeg') {
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

export function loadFixtureAsPcm16MonoWav(filePath: string, transcoder: AudioTranscoder | null): Pcm16MonoWav {
  const fixtureType = classifyAudioFixture(filePath)
  if (fixtureType === 'unsupported') {
    throw new Error(`[live-test] unsupported fixture extension: ${path.extname(filePath).toLowerCase() || '(none)'}`)
  }

  if (fixtureType === 'wav') {
    return parsePcm16MonoWav(filePath)
  }

  if (!transcoder) {
    throw new Error([
      '[live-test] no audio transcoder found for non-wav fixture.',
      '- install ffmpeg (recommended), or use PCM16 mono WAV fixtures.',
    ].join('\n'))
  }

  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mingle-live-audio-'))
  const convertedWavPath = path.join(tempDir, 'converted.wav')

  try {
    transcodeAudioToPcmWav(filePath, convertedWavPath, transcoder)
    return parsePcm16MonoWav(convertedWavPath)
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true })
  }
}

export function wavDurationMs(fixture: Pcm16MonoWav): number {
  const bytesPerSample = 2
  if (fixture.sampleRate <= 0) return 0
  return Math.round((fixture.pcm.length / (fixture.sampleRate * bytesPerSample)) * 1000)
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

function waitForOpen(ws: WebSocket, wsUrl: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error(`[live-test] websocket open timeout (${timeoutMs}ms): ${wsUrl}`))
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
      reject(new Error(`[live-test] websocket connection error: ${wsUrl}`))
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
    return { text, language: language || 'unknown', source: 'transcript' }
  }

  if (type === 'stop_recording_ack') {
    const data = asRecord(message.data)
    const finalTurn = asRecord(data?.final_turn)
    const text = typeof finalTurn?.text === 'string' ? finalTurn.text.trim() : ''
    const language = typeof finalTurn?.language === 'string' ? finalTurn.language.trim() : ''
    if (!text) return null
    return { text, language: language || 'unknown', source: 'stop_recording_ack' }
  }

  return null
}

function extractTranscriptCandidate(message: JsonObject): { text: string, language: string } | null {
  const type = typeof message.type === 'string' ? message.type : ''
  if (type !== 'transcript') return null
  const data = asRecord(message.data)
  const utterance = asRecord(data?.utterance)
  const text = typeof utterance?.text === 'string' ? utterance.text.trim() : ''
  const language = typeof utterance?.language === 'string' ? utterance.language.trim() : ''
  if (!text) return null
  return { text, language: language || 'unknown' }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function waitForFinalTurn(args: {
  ws: WebSocket
  timeoutMs: number
  observedMessageTypes: string[]
  onFinalObserved: (finalTurn: FinalTurn) => void
  allowLocalFallbackOnClose?: boolean
}): Promise<FinalTurn> {
  const { ws, timeoutMs, observedMessageTypes, onFinalObserved, allowLocalFallbackOnClose = false } = args
  return new Promise((resolve, reject) => {
    let stopAckObserved = false
    let latestTranscriptCandidate: { text: string, language: string } | null = null

    const timeoutId = setTimeout(() => {
      cleanup()
      reject(new Error([
        `[live-test] did not receive final transcript within ${timeoutMs}ms`,
        `- observed message types: ${observedMessageTypes.join(', ') || '(none)'}`,
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
      observedMessageTypes.push(type)

      if (type === 'stop_recording_ack') {
        stopAckObserved = true
      }
      const candidate = extractTranscriptCandidate(message)
      if (candidate) {
        latestTranscriptCandidate = candidate
      }

      const finalTurn = extractFinalTurn(message)
      if (!finalTurn) return

      onFinalObserved(finalTurn)
      cleanup()
      resolve(finalTurn)
    }

    const onClose = (event: CloseEvent) => {
      if (allowLocalFallbackOnClose && stopAckObserved && latestTranscriptCandidate) {
        const fallbackFinal: FinalTurn = {
          text: latestTranscriptCandidate.text,
          language: latestTranscriptCandidate.language,
          source: 'stop_recording_ack',
        }
        onFinalObserved(fallbackFinal)
        cleanup()
        resolve(fallbackFinal)
        return
      }

      cleanup()
      reject(new Error([
        '[live-test] websocket closed before final transcript',
        `- code=${event.code} reason=${event.reason || 'none'}`,
        `- observed message types: ${observedMessageTypes.join(', ') || '(none)'}`,
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

export type StreamAudioToSttResult = {
  finalTurn: FinalTurn
  observedMessageTypes: string[]
  streamedChunkCount: number
  totalChunkCount: number
  elapsedMs: number
  finalLatencyAfterStopMs: number
}

export async function streamAudioFixtureToStt(args: {
  fixture: Pcm16MonoWav
  sttWsUrl: string
  sourceLanguageHint: string
  sttModel: string
  streamChunkMs: number
  streamSendDelayMs: number
  wsConnectTimeoutMs: number
  wsReadyTimeoutMs: number
  sttFinalTimeoutMs: number
  stopAfterMs?: number
  wsInitOverrides?: Record<string, unknown>
  allowLocalFallbackOnClose?: boolean
}): Promise<StreamAudioToSttResult> {
  const chunks = splitPcmIntoChunks(args.fixture.pcm, args.fixture.sampleRate, args.streamChunkMs)
  if (chunks.length === 0) {
    throw new Error('[live-test] audio fixture has no PCM frames')
  }

  const ws = new WebSocket(args.sttWsUrl)
  const observedMessageTypes: string[] = []
  const startedAt = Date.now()
  let stopSentAt = 0
  let finalObservedAt = 0

  await waitForOpen(ws, args.sttWsUrl, args.wsConnectTimeoutMs)
  ws.send(JSON.stringify({
    sample_rate: args.fixture.sampleRate,
    languages: [args.sourceLanguageHint],
    stt_model: args.sttModel,
    lang_hints_strict: true,
    ...(args.wsInitOverrides || {}),
  }))
  await waitForReady(ws, args.wsReadyTimeoutMs)

  const finalTurnPromise = waitForFinalTurn({
    ws,
    timeoutMs: args.sttFinalTimeoutMs,
    observedMessageTypes,
    onFinalObserved: () => {
      finalObservedAt = Date.now()
    },
    allowLocalFallbackOnClose: args.allowLocalFallbackOnClose,
  })

  const maxChunks = args.stopAfterMs
    ? Math.max(1, Math.ceil(args.stopAfterMs / args.streamChunkMs))
    : chunks.length
  let streamedChunkCount = 0

  for (const chunk of chunks) {
    if (streamedChunkCount >= maxChunks) break

    ws.send(JSON.stringify({
      type: 'audio_chunk',
      data: {
        chunk: chunk.toString('base64'),
      },
    }))
    streamedChunkCount += 1
    await sleep(args.streamSendDelayMs)
  }

  ws.send(JSON.stringify({
    type: 'stop_recording',
    data: {
      pending_text: '',
      pending_language: args.sourceLanguageHint,
    },
  }))
  stopSentAt = Date.now()

  try {
    const finalTurn = await finalTurnPromise
    const elapsedMs = Date.now() - startedAt
    const finalLatencyAfterStopMs = finalObservedAt > 0 && stopSentAt > 0
      ? Math.max(0, finalObservedAt - stopSentAt)
      : elapsedMs

    return {
      finalTurn,
      observedMessageTypes,
      streamedChunkCount,
      totalChunkCount: chunks.length,
      elapsedMs,
      finalLatencyAfterStopMs,
    }
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

export async function fetchJsonWithTimeout(
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

export function saveTtsAudioArtifact(args: {
  fixtureName: string
  ttsLanguage: string
  ttsMime: string
  ttsAudioBase64: string
  outputDir: string
}): string {
  const audioBuffer = Buffer.from(args.ttsAudioBase64, 'base64')
  if (audioBuffer.length === 0) {
    throw new Error('[live-test] empty TTS audio payload')
  }

  fs.mkdirSync(args.outputDir, { recursive: true })
  const extension = extensionFromMime(args.ttsMime)
  const fileName = [
    new Date().toISOString().replace(/[:.]/g, '-'),
    sanitizeFileToken(args.fixtureName),
    sanitizeFileToken(args.ttsLanguage || 'unknown'),
  ].join('__') + `.${extension}`
  const outputPath = path.join(args.outputDir, fileName)
  fs.writeFileSync(outputPath, audioBuffer)
  return outputPath
}

export type FinalizeApiCheckResult = {
  status: number
  json: JsonObject
  rawText: string
  plan: {
    sourceLanguage: string
    targetLanguages: string[]
    ttsLanguage: string | null
  }
  nonEmptyTranslations: string[]
  translations: Record<string, string>
  ttsReturned: boolean
  ttsSavedPath: string | null
  usedFallbackFromPreviousState: boolean
}

export async function callFinalizeApi(args: {
  finalTurn: { text: string, language: string }
  fixtureName: string
  env: LiveE2EEnv
  targetLanguagesOverride?: string[]
  ttsLanguageOverride?: string | null
  fallbackTranslationOverride?: string
  emitLogs?: boolean
  testFaultMode?: string
}): Promise<FinalizeApiCheckResult> {
  const plan = buildTranslationPlan({
    sourceLanguageRaw: args.finalTurn.language,
    sourceLanguageHint: args.env.sourceLanguageHint,
    targetLanguagesOverride: args.targetLanguagesOverride
      ? args.targetLanguagesOverride.join(',')
      : args.env.targetLanguagesOverride,
    ttsLanguageOverride: args.ttsLanguageOverride ?? args.env.ttsLanguageOverride,
  })

  if (plan.targetLanguages.length === 0) {
    throw new Error('[live-test] target language plan is empty; check language settings.')
  }

  const fallbackTranslation = args.fallbackTranslationOverride ?? args.env.fallbackTranslation
  const requestBody: Record<string, unknown> = {
    text: args.finalTurn.text,
    sourceLanguage: args.finalTurn.language,
    targetLanguages: plan.targetLanguages,
    currentTurnPreviousState: {
      sourceLanguage: args.finalTurn.language,
      sourceText: args.finalTurn.text,
      translations: Object.fromEntries(
        plan.targetLanguages.map(language => [language, fallbackTranslation]),
      ),
    },
    ...(plan.ttsLanguage ? { tts: { enabled: true, language: plan.ttsLanguage } } : {}),
  }

  if (args.testFaultMode) {
    requestBody.__testFaultMode = args.testFaultMode
  }

  const { status, json, rawText } = await fetchJsonWithTimeout(
    `${args.env.apiBaseUrl}/api/translate/finalize`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(args.testFaultMode ? { 'x-mingle-live-test': '1' } : {}),
      },
      body: JSON.stringify(requestBody),
    },
    args.env.apiTimeoutMs,
  )

  if (status === 500 && json.error === 'No translation API key configured') {
    throw new Error([
      '[live-test] GEMINI_API_KEY is missing in the running API server environment.',
      '- set GEMINI_API_KEY in the API server env and run pnpm test again.',
    ].join('\n'))
  }

  const emitLogs = args.emitLogs ?? true
  const translationsRecord = asRecord(json.translations)
  const translations: Record<string, string> = {}
  if (translationsRecord) {
    for (const [key, value] of Object.entries(translationsRecord)) {
      if (typeof value === 'string') {
        translations[key] = value
      }
    }
  }

  const nonEmptyTranslations = plan.targetLanguages
    .map(language => {
      const value = translations[language]
      return typeof value === 'string' ? value.trim() : ''
    })
    .filter(Boolean)

  if (emitLogs) {
    if (status === 200) {
      console.info([
        '[live-test][gemini]',
        `fixture=${args.fixtureName}`,
        `sourceLanguage=${args.finalTurn.language}`,
        `targets=${plan.targetLanguages.join(',')}`,
        `translations=${JSON.stringify(translations)}`,
      ].join(' '))
    } else {
      const error = typeof json.error === 'string' ? json.error : 'unknown'
      console.warn([
        '[live-test][gemini]',
        `fixture=${args.fixtureName}`,
        `status=${status}`,
        `error=${error}`,
        `body=${rawText.slice(0, 500)}`,
      ].join(' '))
    }
  }

  const ttsAudioBase64 = typeof json.ttsAudioBase64 === 'string' ? json.ttsAudioBase64 : ''
  const ttsAudioMime = typeof json.ttsAudioMime === 'string' ? json.ttsAudioMime : 'application/octet-stream'
  const ttsLanguage = typeof json.ttsLanguage === 'string'
    ? normalizeLangCode(json.ttsLanguage)
    : (plan.ttsLanguage || 'unknown')

  let ttsSavedPath: string | null = null
  if (ttsAudioBase64) {
    ttsSavedPath = saveTtsAudioArtifact({
      fixtureName: args.fixtureName,
      ttsLanguage,
      ttsMime: ttsAudioMime,
      ttsAudioBase64,
      outputDir: args.env.ttsOutputDir,
    })

    if (emitLogs) {
      console.info([
        '[live-test][tts]',
        `fixture=${args.fixtureName}`,
        `language=${ttsLanguage}`,
        `mime=${ttsAudioMime}`,
        `saved=${ttsSavedPath}`,
      ].join(' '))
    }
  } else if (emitLogs) {
    console.info([
      '[live-test][tts]',
      `fixture=${args.fixtureName}`,
      'not_returned',
    ].join(' '))
  }

  return {
    status,
    json,
    rawText,
    plan,
    nonEmptyTranslations,
    translations,
    ttsReturned: Boolean(ttsAudioBase64),
    ttsSavedPath,
    usedFallbackFromPreviousState: json.usedFallbackFromPreviousState === true,
  }
}

export function probeAudioDurationMs(audioFilePath: string): number | null {
  if (!commandExists('ffprobe')) return null
  const probe = spawnSync(
    'ffprobe',
    [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      audioFilePath,
    ],
    { encoding: 'utf8' },
  )
  if (probe.status !== 0) return null
  const value = Number.parseFloat((probe.stdout || '').trim())
  if (!Number.isFinite(value) || value <= 0) return null
  return Math.round(value * 1000)
}

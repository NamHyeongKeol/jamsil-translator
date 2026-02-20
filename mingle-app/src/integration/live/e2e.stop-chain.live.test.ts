import { describe, expect, it } from 'vitest'
import {
  callFinalizeApi,
  normalizeText,
  readEnvInt,
  readLiveE2EEnv,
  streamAudioFixtureToStt,
} from './support/live-e2e-utils'
import { pickShortestFixture, scanFixtures } from './support/live-fixture-utils'

const env = readLiveE2EEnv()
const scanResult = scanFixtures(env)
const MAX_FINAL_LATENCY_AFTER_STOP_MS = readEnvInt('MINGLE_TEST_MAX_FINAL_LATENCY_AFTER_STOP_MS', 15_000)
const STOP_CHAIN_AFTER_MS = readEnvInt('MINGLE_TEST_E2E_STOP_CHAIN_AFTER_MS', 4_000)

describe.sequential('e2e regression: stop chain integrity', () => {
  it('discovers fixtures for stop-chain e2e', () => {
    if (scanResult.candidates.length > 0) return
    throw new Error([
      '[live-test] no fixture file found.',
      `- scanned dirs: ${scanResult.scanDirs.join(', ')}`,
      '- add fixture files or set MINGLE_TEST_AUDIO_FIXTURE.',
    ].join('\n'))
  })

  it('keeps final -> translation -> tts chain on early stop', async () => {
    const fixtureEntry = pickShortestFixture(scanResult)
    const stopAfterMs = Math.min(
      Math.max(900, fixtureEntry.durationMs - 250),
      Math.max(900, STOP_CHAIN_AFTER_MS),
    )

    const stt = await streamAudioFixtureToStt({
      fixture: fixtureEntry.fixture,
      sttWsUrl: env.sttWsUrl,
      sourceLanguageHint: env.sourceLanguageHint,
      sttModel: env.sttModel,
      streamChunkMs: env.streamChunkMs,
      streamSendDelayMs: env.streamSendDelayMs,
      wsConnectTimeoutMs: env.wsConnectTimeoutMs,
      wsReadyTimeoutMs: env.wsReadyTimeoutMs,
      sttFinalTimeoutMs: env.sttFinalTimeoutMs,
      stopAfterMs,
      allowLocalFallbackOnClose: true,
    })

    expect(stt.finalTurn.text.length).toBeGreaterThan(0)
    expect(stt.finalTurn.language.length).toBeGreaterThan(0)
    expect(stt.finalLatencyAfterStopMs).toBeLessThanOrEqual(MAX_FINAL_LATENCY_AFTER_STOP_MS)

    console.info([
      '[live-test][soniox]',
      `fixture=${fixtureEntry.fixtureName}`,
      `language=${stt.finalTurn.language}`,
      `source=${stt.finalTurn.source}`,
      `stopAfterMs=${stopAfterMs}`,
      `finalLatencyAfterStopMs=${stt.finalLatencyAfterStopMs}`,
      `text=${JSON.stringify(stt.finalTurn.text)}`,
    ].join(' '))

    if (env.expectedPhrase) {
      const actual = normalizeText(stt.finalTurn.text)
      const expected = normalizeText(env.expectedPhrase)
      expect(actual).toContain(expected)
    }

    const finalize = await callFinalizeApi({
      finalTurn: stt.finalTurn,
      fixtureName: fixtureEntry.fixtureName,
      env,
    })

    expect([200, 502]).toContain(finalize.status)
    if (finalize.status === 200) {
      expect(finalize.nonEmptyTranslations.length).toBeGreaterThan(0)
    } else {
      const error = typeof finalize.json.error === 'string' ? finalize.json.error : ''
      expect(error).toBe('empty_translation_response')
    }
  }, env.liveTestTimeoutMs)
})

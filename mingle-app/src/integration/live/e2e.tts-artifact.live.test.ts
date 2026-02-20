import fs from 'node:fs'
import { describe, expect, it } from 'vitest'
import {
  callFinalizeApi,
  probeAudioDurationMs,
  readLiveE2EEnv,
  streamAudioFixtureToStt,
} from './support/live-e2e-utils'
import { pickShortestFixture, scanFixtures } from './support/live-fixture-utils'

const REQUIRE_TTS = process.env.MINGLE_TEST_REQUIRE_TTS === '1'
const env = readLiveE2EEnv()
const scanResult = scanFixtures(env)

describe.sequential('e2e regression: tts artifact integrity', () => {
  it('stores non-empty tts artifact when finalize returns audio', async () => {
    const fixtureEntry = pickShortestFixture(scanResult)
    const stopAfterMs = Math.min(
      Math.max(1_400, fixtureEntry.durationMs - 300),
      3_500,
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

    const finalize = await callFinalizeApi({
      finalTurn: stt.finalTurn,
      fixtureName: fixtureEntry.fixtureName,
      env,
    })

    expect([200, 502]).toContain(finalize.status)

    if (finalize.status !== 200 || !finalize.ttsReturned || !finalize.ttsSavedPath) {
      if (REQUIRE_TTS) {
        throw new Error([
          '[live-test] TTS artifact is required but was not returned.',
          `- status: ${finalize.status}`,
          `- fixture: ${fixtureEntry.fixtureName}`,
        ].join('\n'))
      }
      console.warn('[live-test][tts-artifact] tts was not returned; skipping strict artifact checks')
      return
    }

    expect(fs.existsSync(finalize.ttsSavedPath)).toBe(true)
    const stat = fs.statSync(finalize.ttsSavedPath)
    expect(stat.size).toBeGreaterThan(0)

    const durationMs = probeAudioDurationMs(finalize.ttsSavedPath)
    if (durationMs !== null) {
      expect(durationMs).toBeGreaterThan(0)
    }

    console.info([
      '[live-test][tts-artifact]',
      `fixture=${fixtureEntry.fixtureName}`,
      `path=${finalize.ttsSavedPath}`,
      `bytes=${stat.size}`,
      `durationMs=${durationMs ?? 'unknown'}`,
    ].join(' '))
  }, env.liveTestTimeoutMs)
})

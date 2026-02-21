import { describe, expect, it } from 'vitest'
import {
  callFinalizeApi,
  readEnvInt,
  readLiveE2EEnv,
  streamAudioFixtureToStt,
} from './support/live-e2e-utils'
import { pickShortestFixture, scanFixtures } from './support/live-fixture-utils'

const env = readLiveE2EEnv()
const scanResult = scanFixtures(env)
const describeWithFixtureCandidates = scanResult.candidates.length > 0 ? describe.sequential : describe.skip
const EXPECT_STOP_ACK_ONLY = process.env.MINGLE_TEST_EXPECT_STOP_ACK_ONLY === '1'
const ACK_FALLBACK_AFTER_MS = readEnvInt('MINGLE_TEST_E2E_ACK_FALLBACK_AFTER_MS', 3_000)

describeWithFixtureCandidates('e2e regression: stop ack fallback path', () => {
  it('returns a final turn even when stop is sent very early', async () => {
    const fixtureEntry = pickShortestFixture(scanResult)
    const stopAfterMs = Math.min(
      Math.max(1_200, fixtureEntry.durationMs - 300),
      Math.max(1_200, ACK_FALLBACK_AFTER_MS),
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

    if (EXPECT_STOP_ACK_ONLY) {
      expect(stt.finalTurn.source).toBe('stop_recording_ack')
    }

    console.info([
      '[live-test][stop-ack]',
      `fixture=${fixtureEntry.fixtureName}`,
      `stopAfterMs=${stopAfterMs}`,
      `source=${stt.finalTurn.source}`,
      `text=${JSON.stringify(stt.finalTurn.text)}`,
    ].join(' '))

    const finalize = await callFinalizeApi({
      finalTurn: stt.finalTurn,
      fixtureName: fixtureEntry.fixtureName,
      env,
    })

    expect([200, 502]).toContain(finalize.status)
  }, env.liveTestTimeoutMs)
})

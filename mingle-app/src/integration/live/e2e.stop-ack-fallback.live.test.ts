import { describe, expect, it } from 'vitest'
import {
  callFinalizeApi,
  readEnvBool,
  readLiveE2EEnv,
  streamAudioFixtureToStt,
} from './support/live-e2e-utils'
import { pickShortestFixture, scanFixtures } from './support/live-fixture-utils'

const ENABLED = readEnvBool('MINGLE_TEST_E2E_ACK_FALLBACK', false)
const EXPECT_STOP_ACK_ONLY = readEnvBool('MINGLE_TEST_EXPECT_STOP_ACK_ONLY', false)

const describeIfEnabled = ENABLED ? describe.sequential : describe.skip
const env = readLiveE2EEnv()
const scanResult = scanFixtures(env)

describeIfEnabled('e2e regression: stop ack fallback path', () => {
  it('returns a final turn even when stop is sent very early', async () => {
    const fixtureEntry = pickShortestFixture(scanResult)

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
      stopAfterMs: 250,
    })

    expect(stt.finalTurn.text.length).toBeGreaterThan(0)
    expect(stt.finalTurn.language.length).toBeGreaterThan(0)

    if (EXPECT_STOP_ACK_ONLY) {
      expect(stt.finalTurn.source).toBe('stop_recording_ack')
    }

    console.info([
      '[live-test][stop-ack]',
      `fixture=${fixtureEntry.fixtureName}`,
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

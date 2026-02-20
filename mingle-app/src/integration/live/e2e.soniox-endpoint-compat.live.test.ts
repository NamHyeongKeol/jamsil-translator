import { describe, expect, it } from 'vitest'
import {
  readEnvBool,
  readLiveE2EEnv,
  streamAudioFixtureToStt,
} from './support/live-e2e-utils'
import { pickShortestFixture, scanFixtures } from './support/live-fixture-utils'

const ENABLED = readEnvBool('MINGLE_TEST_E2E_SONIOX_ENDPOINT_COMPAT', readEnvBool('MINGLE_TEST_E2E_FULL', false))
const describeIfEnabled = ENABLED ? describe.sequential : describe.skip
const env = readLiveE2EEnv()
const scanResult = scanFixtures(env)

describeIfEnabled('e2e regression: soniox endpoint compatibility', () => {
  it('does not close immediately when endpoint detection is disabled', async () => {
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
      stopAfterMs: 350,
      wsInitOverrides: {
        enable_endpoint_detection: false,
      },
    })

    expect(stt.finalTurn.text.length).toBeGreaterThan(0)
    expect(stt.finalTurn.language.length).toBeGreaterThan(0)
    expect(stt.observedMessageTypes.length).toBeGreaterThan(0)

    console.info([
      '[live-test][soniox-endpoint-compat]',
      `fixture=${fixtureEntry.fixtureName}`,
      `source=${stt.finalTurn.source}`,
      `observed=${stt.observedMessageTypes.join(',')}`,
    ].join(' '))
  }, env.liveTestTimeoutMs)
})

import { describe, expect, it } from 'vitest'
import {
  readEnvInt,
  readLiveE2EEnv,
  streamAudioFixtureToStt,
} from './support/live-e2e-utils'
import { scanFixtures, type ValidFixture } from './support/live-fixture-utils'

const env = readLiveE2EEnv()
const scanResult = scanFixtures(env)
const MAX_FINAL_LATENCY_AFTER_STOP_MS = readEnvInt('MINGLE_TEST_MAX_FINAL_LATENCY_AFTER_STOP_MS', 15_000)

function pickCoverageFixtures(): ValidFixture[] {
  if (scanResult.validFixtures.length === 0) {
    throw new Error([
      '[live-test] no valid audio fixture was processed.',
      `- scanned dirs: ${scanResult.scanDirs.join(', ')}`,
      '- unsupported/invalid files are skipped; add at least one valid fixture.',
    ].join('\n'))
  }

  if (scanResult.validFixtures.length === 1) {
    return [scanResult.validFixtures[0]]
  }

  const first = scanResult.validFixtures[0]
  const last = scanResult.validFixtures[scanResult.validFixtures.length - 1]
  return [first, last]
}

describe.sequential('e2e regression: soniox segmentation latency', () => {
  for (const fixtureEntry of pickCoverageFixtures()) {
    it(`keeps finalize latency bounded for ${fixtureEntry.fixtureName}`, async () => {
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
      })

      expect(stt.streamedChunkCount).toBe(stt.totalChunkCount)
      expect(stt.finalTurn.text.trim().length).toBeGreaterThan(0)
      expect(stt.finalLatencyAfterStopMs).toBeLessThanOrEqual(MAX_FINAL_LATENCY_AFTER_STOP_MS)

      console.info([
        '[live-test][soniox-segmentation]',
        `fixture=${fixtureEntry.fixtureName}`,
        `durationMs=${fixtureEntry.durationMs}`,
        `finalLatencyAfterStopMs=${stt.finalLatencyAfterStopMs}`,
        `source=${stt.finalTurn.source}`,
      ].join(' '))
    }, env.liveTestTimeoutMs)
  }
})

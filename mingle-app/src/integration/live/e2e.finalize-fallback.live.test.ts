import { describe, expect, it } from 'vitest'
import {
  callFinalizeApi,
  readEnvBool,
  readLiveE2EEnv,
} from './support/live-e2e-utils'

const ENABLED = readEnvBool('MINGLE_TEST_E2E_FINALIZE_FAULTS', false)
const describeIfEnabled = ENABLED ? describe.sequential : describe.skip

const env = readLiveE2EEnv()
const fallbackValue = 'fallback_from_e2e_test'

describeIfEnabled('e2e regression: finalize fallback behavior', () => {
  it('falls back to previous state when provider returns empty', async () => {
    const result = await callFinalizeApi({
      finalTurn: {
        text: 'hello from e2e finalize fallback',
        language: 'en',
      },
      fixtureName: 'finalize-fault-provider-empty',
      env,
      targetLanguagesOverride: ['ko'],
      ttsLanguageOverride: null,
      fallbackTranslationOverride: fallbackValue,
      emitLogs: true,
      testFaultMode: 'provider_empty',
    })

    expect(result.status).toBe(200)
    expect(result.usedFallbackFromPreviousState).toBe(true)
    expect(result.translations.ko).toBe(fallbackValue)
  }, env.liveTestTimeoutMs)

  it('falls back when provider misses requested targets', async () => {
    const result = await callFinalizeApi({
      finalTurn: {
        text: 'bonjour fallback check',
        language: 'fr',
      },
      fixtureName: 'finalize-fault-target-miss',
      env,
      targetLanguagesOverride: ['ko', 'en'],
      ttsLanguageOverride: null,
      fallbackTranslationOverride: fallbackValue,
      emitLogs: true,
      testFaultMode: 'target_miss',
    })

    expect(result.status).toBe(200)
    expect(result.usedFallbackFromPreviousState).toBe(true)
    expect(result.translations.ko).toBe(fallbackValue)
    expect(result.translations.en).toBe(fallbackValue)
  }, env.liveTestTimeoutMs)
})

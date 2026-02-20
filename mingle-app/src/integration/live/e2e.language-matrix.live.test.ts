import { describe, expect, it } from 'vitest'
import {
  callFinalizeApi,
  readEnvBool,
  readLiveE2EEnv,
} from './support/live-e2e-utils'

const ENABLED = readEnvBool('MINGLE_TEST_E2E_LANGUAGE_MATRIX', readEnvBool('MINGLE_TEST_E2E_FULL', false))
const describeIfEnabled = ENABLED ? describe.sequential : describe.skip
const env = readLiveE2EEnv()

describeIfEnabled('e2e regression: language matrix targets', () => {
  const cases = [
    {
      name: 'en -> ko',
      finalTurn: { text: 'hello everyone this is a test', language: 'en' },
      expectedTargets: ['ko'],
      ttsLanguage: 'ko',
    },
    {
      name: 'ko -> en',
      finalTurn: { text: '안녕하세요. 이것은 테스트입니다.', language: 'ko' },
      expectedTargets: ['en'],
      ttsLanguage: 'en',
    },
    {
      name: 'third language -> ko,en',
      finalTurn: { text: 'こんにちは。これはテストです。', language: 'ja' },
      expectedTargets: ['ko', 'en'],
      ttsLanguage: 'ko',
    },
  ]

  for (const testCase of cases) {
    it(`uses expected target languages for ${testCase.name}`, async () => {
      const result = await callFinalizeApi({
        finalTurn: testCase.finalTurn,
        fixtureName: `language-matrix-${testCase.name.replace(/\s+/g, '-')}`,
        env,
        ttsLanguageOverride: testCase.ttsLanguage,
      })

      expect(result.plan.targetLanguages).toEqual(testCase.expectedTargets)
      expect([200, 502]).toContain(result.status)

      if (result.status === 200) {
        expect(result.nonEmptyTranslations.length).toBeGreaterThan(0)
      } else {
        const error = typeof result.json.error === 'string' ? result.json.error : ''
        expect(error).toBe('empty_translation_response')
      }
    }, env.liveTestTimeoutMs)
  }
})

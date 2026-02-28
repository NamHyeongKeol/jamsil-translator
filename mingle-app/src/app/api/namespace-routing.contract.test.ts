import { describe, expect, it } from 'vitest'

import { POST as postLegacyLogClientEvent } from '@/app/api/log/client-event/route'
import { POST as postLegacyTranslateFinalize } from '@/app/api/translate/finalize/route'
import { POST as postLegacyTtsInworld } from '@/app/api/tts/inworld/route'
import { POST as postLegacyClientVersionPolicy } from '@/app/api/client/version-policy/route'
import { POST as postAndroidV100ClientVersionPolicy } from '@/app/api/android/v1.0.0/client/version-policy/route'
import { POST as postIosV100ClientVersionPolicy } from '@/app/api/ios/v1.0.0/client/version-policy/route'
import { POST as postIosV100LogClientEvent } from '@/app/api/ios/v1.0.0/log/client-event/route'
import { POST as postIosV100TranslateFinalize } from '@/app/api/ios/v1.0.0/translate/finalize/route'
import { POST as postIosV100TtsInworld } from '@/app/api/ios/v1.0.0/tts/inworld/route'
import { postAndroidClientVersionPolicyForAndroidV1_0_0 } from '@/server/api/controllers/android/v1.0.0/client-version-policy-controller'
import { postIosClientVersionPolicyForIosV1_0_0 } from '@/server/api/controllers/ios/v1.0.0/client-version-policy-controller'
import { postLogClientEventForIosV1_0_0 } from '@/server/api/controllers/ios/v1.0.0/log-client-event-controller'
import { postTranslateFinalizeForIosV1_0_0 } from '@/server/api/controllers/ios/v1.0.0/translate-finalize-controller'
import { postTtsInworldForIosV1_0_0 } from '@/server/api/controllers/ios/v1.0.0/tts-inworld-controller'
import { postClientVersionPolicyForLegacy } from '@/server/api/controllers/legacy/client-version-policy-controller'
import { postIosClientVersionPolicyForLegacy } from '@/server/api/controllers/legacy/ios-client-version-policy-controller'
import { postLogClientEventForLegacy } from '@/server/api/controllers/legacy/log-client-event-controller'
import { postTranslateFinalizeForLegacy } from '@/server/api/controllers/legacy/translate-finalize-controller'
import { postTtsInworldForLegacy } from '@/server/api/controllers/legacy/tts-inworld-controller'

describe('mingle-app namespace route wiring', () => {
  it('maps legacy routes to legacy controllers', () => {
    expect(postLegacyTranslateFinalize).toBe(postTranslateFinalizeForLegacy)
    expect(postLegacyTtsInworld).toBe(postTtsInworldForLegacy)
    expect(postLegacyLogClientEvent).toBe(postLogClientEventForLegacy)
    expect(postLegacyClientVersionPolicy).toBe(postClientVersionPolicyForLegacy)
  })

  it('maps /android/v1.0.0 routes to Android v1.0.0 controllers', () => {
    expect(postAndroidV100ClientVersionPolicy).toBe(postAndroidClientVersionPolicyForAndroidV1_0_0)
  })

  it('maps /ios/v1.0.0 routes to iOS v1.0.0 controllers', () => {
    expect(postIosV100TranslateFinalize).toBe(postTranslateFinalizeForIosV1_0_0)
    expect(postIosV100TtsInworld).toBe(postTtsInworldForIosV1_0_0)
    expect(postIosV100LogClientEvent).toBe(postLogClientEventForIosV1_0_0)
    expect(postIosV100ClientVersionPolicy).toBe(postIosClientVersionPolicyForIosV1_0_0)
  })

  it('keeps iOS v1.0.0 controller code identical to legacy controllers', () => {
    expect(postTranslateFinalizeForIosV1_0_0).toBe(postTranslateFinalizeForLegacy)
    expect(postTtsInworldForIosV1_0_0).toBe(postTtsInworldForLegacy)
    expect(postLogClientEventForIosV1_0_0).toBe(postLogClientEventForLegacy)
    expect(postIosClientVersionPolicyForIosV1_0_0).toBe(postIosClientVersionPolicyForLegacy)
  })
})

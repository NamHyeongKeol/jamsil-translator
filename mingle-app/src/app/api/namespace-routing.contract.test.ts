import { describe, expect, it } from 'vitest'

import { POST as postLegacyLogClientEvent } from '@/app/api/log/client-event/route'
import { POST as postLegacyTranslateFinalize } from '@/app/api/translate/finalize/route'
import { POST as postLegacyTtsInworld } from '@/app/api/tts/inworld/route'
import { POST as postMobileAndroidLogClientEvent } from '@/app/api/mobile/android/v1/log/client-event/route'
import { POST as postMobileAndroidTranslateFinalize } from '@/app/api/mobile/android/v1/translate/finalize/route'
import { POST as postMobileAndroidTtsInworld } from '@/app/api/mobile/android/v1/tts/inworld/route'
import { POST as postMobileIosLogClientEvent } from '@/app/api/mobile/ios/v1/log/client-event/route'
import { POST as postMobileIosTranslateFinalize } from '@/app/api/mobile/ios/v1/translate/finalize/route'
import { POST as postMobileIosTtsInworld } from '@/app/api/mobile/ios/v1/tts/inworld/route'
import { POST as postWebV1LogClientEvent } from '@/app/api/web/app/v1/log/client-event/route'
import { POST as postWebV1TranslateFinalize } from '@/app/api/web/app/v1/translate/finalize/route'
import { POST as postWebV1TtsInworld } from '@/app/api/web/app/v1/tts/inworld/route'
import { postLogClientEventForMobileAndroidV1 } from '@/server/api/controllers/mobile/android/v1/log-client-event-controller'
import { postTranslateFinalizeForMobileAndroidV1 } from '@/server/api/controllers/mobile/android/v1/translate-finalize-controller'
import { postTtsInworldForMobileAndroidV1 } from '@/server/api/controllers/mobile/android/v1/tts-inworld-controller'
import { postLogClientEventForMobileIosV1 } from '@/server/api/controllers/mobile/ios/v1/log-client-event-controller'
import { postTranslateFinalizeForMobileIosV1 } from '@/server/api/controllers/mobile/ios/v1/translate-finalize-controller'
import { postTtsInworldForMobileIosV1 } from '@/server/api/controllers/mobile/ios/v1/tts-inworld-controller'
import { postLogClientEventForWebAppV1 } from '@/server/api/controllers/web/app/v1/log-client-event-controller'
import { postTranslateFinalizeForWebAppV1 } from '@/server/api/controllers/web/app/v1/translate-finalize-controller'
import { postTtsInworldForWebAppV1 } from '@/server/api/controllers/web/app/v1/tts-inworld-controller'

describe('mingle-app namespace route wiring', () => {
  it('maps web and legacy translate finalize routes to web/app/v1 controller', () => {
    expect(postLegacyTranslateFinalize).toBe(postTranslateFinalizeForWebAppV1)
    expect(postWebV1TranslateFinalize).toBe(postTranslateFinalizeForWebAppV1)
  })

  it('maps web and legacy tts routes to web/app/v1 controller', () => {
    expect(postLegacyTtsInworld).toBe(postTtsInworldForWebAppV1)
    expect(postWebV1TtsInworld).toBe(postTtsInworldForWebAppV1)
  })

  it('maps web and legacy client-event routes to web/app/v1 controller', () => {
    expect(postLegacyLogClientEvent).toBe(postLogClientEventForWebAppV1)
    expect(postWebV1LogClientEvent).toBe(postLogClientEventForWebAppV1)
  })

  it('maps iOS v1 routes to iOS controllers', () => {
    expect(postMobileIosTranslateFinalize).toBe(postTranslateFinalizeForMobileIosV1)
    expect(postMobileIosTtsInworld).toBe(postTtsInworldForMobileIosV1)
    expect(postMobileIosLogClientEvent).toBe(postLogClientEventForMobileIosV1)
  })

  it('maps Android v1 routes to Android controllers', () => {
    expect(postMobileAndroidTranslateFinalize).toBe(postTranslateFinalizeForMobileAndroidV1)
    expect(postMobileAndroidTtsInworld).toBe(postTtsInworldForMobileAndroidV1)
    expect(postMobileAndroidLogClientEvent).toBe(postLogClientEventForMobileAndroidV1)
  })
})

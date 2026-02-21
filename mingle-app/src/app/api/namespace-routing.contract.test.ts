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
  it('rejects legacy translate finalize endpoint without namespace/version', async () => {
    const response = await postLegacyTranslateFinalize()

    expect(response.status).toBe(410)
    expect(response.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/app/v1/translate/finalize')
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: 'api_version_required',
      replacement: '/api/web/app/v1/translate/finalize',
    })
  })

  it('maps /web/app/v1 translate finalize route to web/app/v1 controller', () => {
    expect(postWebV1TranslateFinalize).toBe(postTranslateFinalizeForWebAppV1)
  })

  it('rejects legacy tts endpoint without namespace/version', async () => {
    const response = await postLegacyTtsInworld()

    expect(response.status).toBe(410)
    expect(response.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/app/v1/tts/inworld')
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: 'api_version_required',
      replacement: '/api/web/app/v1/tts/inworld',
    })
  })

  it('maps /web/app/v1 tts route to web/app/v1 controller', () => {
    expect(postWebV1TtsInworld).toBe(postTtsInworldForWebAppV1)
  })

  it('rejects legacy client-event endpoint without namespace/version', async () => {
    const response = await postLegacyLogClientEvent()

    expect(response.status).toBe(410)
    expect(response.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/app/v1/log/client-event')
    const payload = await response.json()
    expect(payload).toMatchObject({
      error: 'api_version_required',
      replacement: '/api/web/app/v1/log/client-event',
    })
  })

  it('maps /web/app/v1 client-event route to web/app/v1 controller', () => {
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

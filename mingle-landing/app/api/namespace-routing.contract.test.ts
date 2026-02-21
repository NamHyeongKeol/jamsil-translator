import { describe, expect, it } from 'vitest'

import { GET as getLegacyClicks } from '@/app/api/clicks/route'
import { POST as postLegacyLogClick } from '@/app/api/log-click/route'
import { POST as postLegacyLogConversation } from '@/app/api/log-conversation/route'
import { POST as postLegacyLogEvent } from '@/app/api/log-event/route'
import { POST as postLegacyLogVisit } from '@/app/api/log-visit/route'
import { POST as postLegacySubscribe } from '@/app/api/subscribe/route'
import { GET as getLegacySubscribers } from '@/app/api/subscribers/route'
import { POST as postLegacyTranslateFinalize } from '@/app/api/translate/finalize/route'
import { POST as postLegacyTtsInworld } from '@/app/api/tts/inworld/route'
import { GET as getV1Clicks } from '@/app/api/web/landing/v1/clicks/route'
import { POST as postV1LogClick } from '@/app/api/web/landing/v1/log-click/route'
import { POST as postV1LogConversation } from '@/app/api/web/landing/v1/log-conversation/route'
import { POST as postV1LogEvent } from '@/app/api/web/landing/v1/log-event/route'
import { POST as postV1LogVisit } from '@/app/api/web/landing/v1/log-visit/route'
import { POST as postV1Subscribe } from '@/app/api/web/landing/v1/subscribe/route'
import { GET as getV1Subscribers } from '@/app/api/web/landing/v1/subscribers/route'
import { POST as postV1TranslateFinalize } from '@/app/api/web/landing/v1/translate/finalize/route'
import { POST as postV1TtsInworld } from '@/app/api/web/landing/v1/tts/inworld/route'
import { getClicksForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/clicks-controller'
import { postLogClickForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/log-click-controller'
import { postLogConversationForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/log-conversation-controller'
import { postLogEventForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/log-event-controller'
import { postLogVisitForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/log-visit-controller'
import { postSubscribeForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/subscribe-controller'
import { getSubscribersForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/subscribers-controller'
import { postTranslateFinalizeForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/translate-finalize-controller'
import { postTtsInworldForWebLandingV1 } from '@/server/api/controllers/web/landing/v1/tts-inworld-controller'

describe('mingle-landing namespace route wiring', () => {
  it('rejects legacy click routes without namespace/version', async () => {
    const postResponse = await postLegacyLogClick()
    const getResponse = await getLegacyClicks()

    expect(postResponse.status).toBe(410)
    expect(postResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/log-click')
    expect(getResponse.status).toBe(410)
    expect(getResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/clicks')
  })

  it('maps /web/landing/v1 click routes to v1 controller', () => {
    expect(postV1LogClick).toBe(postLogClickForWebLandingV1)
    expect(getV1Clicks).toBe(getClicksForWebLandingV1)
  })

  it('rejects legacy subscriber routes without namespace/version', async () => {
    const postResponse = await postLegacySubscribe()
    const getResponse = await getLegacySubscribers()

    expect(postResponse.status).toBe(410)
    expect(postResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/subscribe')
    expect(getResponse.status).toBe(410)
    expect(getResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/subscribers')
  })

  it('maps /web/landing/v1 subscriber routes to v1 controller', () => {
    expect(postV1Subscribe).toBe(postSubscribeForWebLandingV1)
    expect(getV1Subscribers).toBe(getSubscribersForWebLandingV1)
  })

  it('rejects legacy conversation event routes without namespace/version', async () => {
    const conversationResponse = await postLegacyLogConversation()
    const eventResponse = await postLegacyLogEvent()
    const visitResponse = await postLegacyLogVisit()

    expect(conversationResponse.status).toBe(410)
    expect(conversationResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/log-conversation')
    expect(eventResponse.status).toBe(410)
    expect(eventResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/log-event')
    expect(visitResponse.status).toBe(410)
    expect(visitResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/log-visit')
  })

  it('maps /web/landing/v1 conversation event routes to v1 controller', () => {
    expect(postV1LogConversation).toBe(postLogConversationForWebLandingV1)
    expect(postV1LogEvent).toBe(postLogEventForWebLandingV1)
    expect(postV1LogVisit).toBe(postLogVisitForWebLandingV1)
  })

  it('rejects legacy translate/tts routes without namespace/version', async () => {
    const translateResponse = await postLegacyTranslateFinalize()
    const ttsResponse = await postLegacyTtsInworld()

    expect(translateResponse.status).toBe(410)
    expect(translateResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/translate/finalize')
    expect(ttsResponse.status).toBe(410)
    expect(ttsResponse.headers.get('X-Mingle-Api-Replacement')).toBe('/api/web/landing/v1/tts/inworld')
  })

  it('maps /web/landing/v1 translate/tts routes to v1 controller', () => {
    expect(postV1TranslateFinalize).toBe(postTranslateFinalizeForWebLandingV1)
    expect(postV1TtsInworld).toBe(postTtsInworldForWebLandingV1)
  })
})

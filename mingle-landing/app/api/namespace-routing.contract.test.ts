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
  it('maps legacy and /web/landing/v1 click routes to v1 controller', () => {
    expect(postLegacyLogClick).toBe(postLogClickForWebLandingV1)
    expect(postV1LogClick).toBe(postLogClickForWebLandingV1)
    expect(getLegacyClicks).toBe(getClicksForWebLandingV1)
    expect(getV1Clicks).toBe(getClicksForWebLandingV1)
  })

  it('maps legacy and /web/landing/v1 subscriber routes to v1 controller', () => {
    expect(postLegacySubscribe).toBe(postSubscribeForWebLandingV1)
    expect(postV1Subscribe).toBe(postSubscribeForWebLandingV1)
    expect(getLegacySubscribers).toBe(getSubscribersForWebLandingV1)
    expect(getV1Subscribers).toBe(getSubscribersForWebLandingV1)
  })

  it('maps legacy and /web/landing/v1 conversation event routes to v1 controller', () => {
    expect(postLegacyLogConversation).toBe(postLogConversationForWebLandingV1)
    expect(postV1LogConversation).toBe(postLogConversationForWebLandingV1)
    expect(postLegacyLogEvent).toBe(postLogEventForWebLandingV1)
    expect(postV1LogEvent).toBe(postLogEventForWebLandingV1)
    expect(postLegacyLogVisit).toBe(postLogVisitForWebLandingV1)
    expect(postV1LogVisit).toBe(postLogVisitForWebLandingV1)
  })

  it('maps legacy and /web/landing/v1 translate/tts routes to v1 controller', () => {
    expect(postLegacyTranslateFinalize).toBe(postTranslateFinalizeForWebLandingV1)
    expect(postV1TranslateFinalize).toBe(postTranslateFinalizeForWebLandingV1)
    expect(postLegacyTtsInworld).toBe(postTtsInworldForWebLandingV1)
    expect(postV1TtsInworld).toBe(postTtsInworldForWebLandingV1)
  })
})

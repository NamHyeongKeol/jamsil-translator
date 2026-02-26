import { legacyApiGoneResponse } from '@/server/api/versioning/legacy-route'

export async function POST() {
  return legacyApiGoneResponse('/api/web/landing/v1/log-event')
}

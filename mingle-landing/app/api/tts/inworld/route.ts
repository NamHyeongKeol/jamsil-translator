import { legacyApiGoneResponse } from '@/server/api/versioning/legacy-route'

export const runtime = 'nodejs'

export async function POST() {
  return legacyApiGoneResponse('/api/web/landing/v1/tts/inworld')
}

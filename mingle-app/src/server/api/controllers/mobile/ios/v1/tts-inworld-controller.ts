import { NextRequest } from 'next/server'
import { handleTtsInworldV1 } from '@/server/api/handlers/v1/tts-inworld-handler'
import { withApiNamespaceHeaders } from '@/server/api/versioning/headers'

export const runtime = 'nodejs'

const API_NAMESPACE = {
  surface: 'mobile',
  platform: 'ios',
  version: 'v1',
} as const

export async function postTtsInworldForMobileIosV1(request: NextRequest) {
  const response = await handleTtsInworldV1(request)
  return withApiNamespaceHeaders(response, API_NAMESPACE)
}

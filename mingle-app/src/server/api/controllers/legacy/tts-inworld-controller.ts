import { NextRequest } from 'next/server'
import { handleTtsInworldV1 } from '@/server/api/handlers/v1/tts-inworld-handler'

export const runtime = 'nodejs'

export async function postTtsInworldForLegacy(request: NextRequest) {
  return handleTtsInworldV1(request)
}

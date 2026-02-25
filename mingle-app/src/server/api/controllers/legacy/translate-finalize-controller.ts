import { NextRequest } from 'next/server'
import { handleTranslateFinalizeV1 } from '@/server/api/handlers/v1/translate-finalize-handler'

export const runtime = 'nodejs'

export async function postTranslateFinalizeForLegacy(request: NextRequest) {
  return handleTranslateFinalizeV1(request)
}

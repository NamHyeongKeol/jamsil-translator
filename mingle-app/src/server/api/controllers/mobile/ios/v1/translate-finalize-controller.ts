import { NextRequest } from 'next/server'
import { handleTranslateFinalizeV1 } from '@/server/api/handlers/v1/translate-finalize-handler'
import { withApiNamespaceHeaders } from '@/server/api/versioning/headers'

export const runtime = 'nodejs'

const API_NAMESPACE = {
  surface: 'mobile',
  platform: 'ios',
  version: 'v1',
} as const

export async function postTranslateFinalizeForMobileIosV1(request: NextRequest) {
  const response = await handleTranslateFinalizeV1(request)
  return withApiNamespaceHeaders(response, API_NAMESPACE)
}

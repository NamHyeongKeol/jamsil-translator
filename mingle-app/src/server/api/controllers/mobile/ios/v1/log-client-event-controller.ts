import { NextRequest } from 'next/server'
import { handleLogClientEventV1 } from '@/server/api/handlers/v1/log-client-event-handler'
import { withApiNamespaceHeaders } from '@/server/api/versioning/headers'

export const runtime = 'nodejs'

const API_NAMESPACE = {
  surface: 'mobile',
  platform: 'ios',
  version: 'v1',
} as const

export async function postLogClientEventForMobileIosV1(request: NextRequest) {
  const response = await handleLogClientEventV1(request)
  return withApiNamespaceHeaders(response, API_NAMESPACE)
}

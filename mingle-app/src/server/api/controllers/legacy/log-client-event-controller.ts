import { NextRequest } from 'next/server'
import { handleLogClientEventV1 } from '@/server/api/handlers/v1/log-client-event-handler'

export const runtime = 'nodejs'

export async function postLogClientEventForLegacy(request: NextRequest) {
  return handleLogClientEventV1(request)
}

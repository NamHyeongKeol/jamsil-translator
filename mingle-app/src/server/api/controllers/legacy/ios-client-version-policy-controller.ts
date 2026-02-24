import { NextRequest } from 'next/server'
import { handleIosClientVersionPolicy } from '@/server/api/handlers/client-version-policy-handler'

export const runtime = 'nodejs'

export async function postIosClientVersionPolicyForLegacy(request: NextRequest) {
  return handleIosClientVersionPolicy(request)
}

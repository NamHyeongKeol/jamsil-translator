import { NextRequest } from 'next/server'
import { handleClientVersionPolicy } from '@/server/api/handlers/client-version-policy-handler'

export const runtime = 'nodejs'

export async function postAndroidClientVersionPolicyForAndroidV1_0_0(
  request: NextRequest,
) {
  return handleClientVersionPolicy(request, { platformOverride: 'android' })
}

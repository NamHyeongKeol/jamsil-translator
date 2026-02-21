import { legacyApiGoneResponse } from '@/server/api/versioning/legacy-route'

export async function GET() {
  return legacyApiGoneResponse('/api/web/landing/v1/subscribers')
}

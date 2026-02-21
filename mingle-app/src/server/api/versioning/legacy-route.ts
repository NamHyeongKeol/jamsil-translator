import { NextResponse } from 'next/server'

export function legacyApiGoneResponse(replacementPath: string): NextResponse {
  const response = NextResponse.json(
    {
      error: 'api_version_required',
      message: 'Use a versioned API namespace URL.',
      replacement: replacementPath,
    },
    { status: 410 },
  )
  response.headers.set('X-Mingle-Api-Deprecated', 'true')
  response.headers.set('X-Mingle-Api-Replacement', replacementPath)
  return response
}

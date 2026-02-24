import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_ENV = {
  minSupported: process.env.IOS_CLIENT_MIN_SUPPORTED_VERSION,
  recommendBelow: process.env.IOS_CLIENT_RECOMMENDED_BELOW_VERSION,
  latest: process.env.IOS_CLIENT_LATEST_VERSION,
  updateUrl: process.env.IOS_APPSTORE_URL,
}

function makeRequest(version: string): Request {
  return new Request('http://localhost:3000/api/client/version-policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientVersion: version, clientBuild: '123' }),
  })
}

async function loadLegacyRoutePost() {
  vi.resetModules()
  const mod = await import('@/app/api/client/version-policy/route')
  return mod.POST
}

describe('/api/client/version-policy route', () => {
  beforeEach(() => {
    process.env.IOS_CLIENT_MIN_SUPPORTED_VERSION = '1.0.0'
    process.env.IOS_CLIENT_RECOMMENDED_BELOW_VERSION = '1.2.0'
    process.env.IOS_CLIENT_LATEST_VERSION = '1.3.0'
    process.env.IOS_APPSTORE_URL = 'https://apps.apple.com/app/id1234567890'
  })

  afterEach(() => {
    if (typeof ORIGINAL_ENV.minSupported === 'string') {
      process.env.IOS_CLIENT_MIN_SUPPORTED_VERSION = ORIGINAL_ENV.minSupported
    } else {
      delete process.env.IOS_CLIENT_MIN_SUPPORTED_VERSION
    }

    if (typeof ORIGINAL_ENV.recommendBelow === 'string') {
      process.env.IOS_CLIENT_RECOMMENDED_BELOW_VERSION = ORIGINAL_ENV.recommendBelow
    } else {
      delete process.env.IOS_CLIENT_RECOMMENDED_BELOW_VERSION
    }

    if (typeof ORIGINAL_ENV.latest === 'string') {
      process.env.IOS_CLIENT_LATEST_VERSION = ORIGINAL_ENV.latest
    } else {
      delete process.env.IOS_CLIENT_LATEST_VERSION
    }

    if (typeof ORIGINAL_ENV.updateUrl === 'string') {
      process.env.IOS_APPSTORE_URL = ORIGINAL_ENV.updateUrl
    } else {
      delete process.env.IOS_APPSTORE_URL
    }
  })

  it('returns force_update when client version is below supported minimum', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('0.9.9') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('force_update')
    expect(json.minSupportedVersion).toBe('1.0.0')
    expect(json.latestVersion).toBe('1.3.0')
    expect(json.updateUrl).toBe('https://apps.apple.com/app/id1234567890')
  })

  it('returns recommend_update when client version is supported but below recommended threshold', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.1.5') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('recommend_update')
    expect(json.recommendedBelowVersion).toBe('1.2.0')
  })

  it('returns none when client version is already up to date enough', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.3.0') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('none')
    expect(json.message).toBe('')
  })

  it('returns force_update when client version format is invalid', async () => {
    const POST = await loadLegacyRoutePost()
    const response = await POST(makeRequest('1.0') as never)
    const json = await response.json()

    expect(response.status).toBe(200)
    expect(json.action).toBe('force_update')
  })
})


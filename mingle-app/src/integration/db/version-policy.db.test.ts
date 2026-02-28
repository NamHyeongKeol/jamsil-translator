import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { prisma } from '@/lib/prisma'
import { POST as postAndroidVersionPolicy } from '@/app/api/android/v1.0.0/client/version-policy/route'
import { POST as postLegacyVersionPolicy } from '@/app/api/client/version-policy/route'
import { POST as postIosVersionPolicy } from '@/app/api/ios/v1.0.0/client/version-policy/route'

const DB_INTEGRATION_ENABLED = process.env.MINGLE_DB_INTEGRATION === '1'
const describeDb = DB_INTEGRATION_ENABLED ? describe : describe.skip

type VersionPolicyRoute = (request: Request) => Promise<Response>

function makeRequest(args: {
  clientVersion: string
  clientBuild?: string
  locale?: string
  platform?: 'ios' | 'android'
}): Request {
  return new Request('http://localhost:3000/api/client/version-policy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      clientVersion: args.clientVersion,
      clientBuild: args.clientBuild || 'itest-build',
      locale: args.locale || 'en',
      platform: args.platform || 'ios',
    }),
  })
}

async function callPolicyRoute(route: VersionPolicyRoute, args: Parameters<typeof makeRequest>[0]) {
  const response = await route(makeRequest(args) as never)
  const json = await response.json() as Record<string, unknown>
  return { response, json }
}

async function seedVersionPolicyFixture() {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "app"."app_client_versions", "app"."app_client_version_policies" RESTART IDENTITY CASCADE;',
  )

  const now = Date.now()
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000)

  await prisma.appClientVersion.createMany({
    data: [
      { id: 'it_cv_ios_1_0_0', platform: 'ios', version: '1.0.0', major: 1, minor: 0, patch: 0 },
      { id: 'it_cv_ios_1_2_0', platform: 'ios', version: '1.2.0', major: 1, minor: 2, patch: 0 },
      { id: 'it_cv_ios_1_4_0', platform: 'ios', version: '1.4.0', major: 1, minor: 4, patch: 0 },
      { id: 'it_cv_android_2_0_0', platform: 'android', version: '2.0.0', major: 2, minor: 0, patch: 0 },
      { id: 'it_cv_android_2_1_0', platform: 'android', version: '2.1.0', major: 2, minor: 1, patch: 0 },
    ],
  })

  await prisma.appClientVersionPolicy.createMany({
    data: [
      {
        id: 'it_cp_ios_current',
        platform: 'ios',
        effectiveFrom: oneDayAgo,
        minSupportedVersion: '1.1.0',
        recommendedBelowVersion: '1.3.0',
        latestVersion: '1.4.0',
        updateUrl: 'https://apps.apple.com/app/id1234567890',
        note: '[itest] ios current policy',
        createdAt: oneDayAgo,
        updatedAt: oneDayAgo,
      },
      {
        id: 'it_cp_android_current',
        platform: 'android',
        effectiveFrom: oneDayAgo,
        minSupportedVersion: '2.0.0',
        recommendedBelowVersion: '2.1.0',
        latestVersion: '2.2.0',
        updateUrl: 'https://play.google.com/store/apps/details?id=com.minglelabs.mingle',
        note: '[itest] android current policy',
        createdAt: oneDayAgo,
        updatedAt: oneDayAgo,
      },
    ],
  })
}

describeDb('client version policy DB integration', () => {
  beforeEach(async () => {
    await seedVersionPolicyFixture()
  })

  afterAll(async () => {
    await prisma.$disconnect()
  })

  it('rejects malformed semver values via DB CHECK constraints', async () => {
    await expect(
      prisma.$executeRawUnsafe(`
        INSERT INTO "app"."app_client_version_policies" (
          "id",
          "platform",
          "effective_from",
          "min_supported_version",
          "recommended_below_version",
          "latest_version",
          "update_url",
          "note",
          "created_at",
          "updated_at"
        ) VALUES (
          'it_invalid_semver_policy',
          'ios',
          NOW(),
          '1.2',
          '1.3.0',
          '1.4.0',
          NULL,
          '[itest] invalid semver should fail',
          NOW(),
          NOW()
        );
      `),
    ).rejects.toThrow()

    const insertedCount = await prisma.appClientVersionPolicy.count({
      where: { id: 'it_invalid_semver_policy' },
    })
    expect(insertedCount).toBe(0)
  })

  it('chooses the newest policy by effective_from then created_at', async () => {
    const effectiveFrom = new Date(Date.now() - 60 * 1000)
    const createdAtOlder = new Date(Date.now() - 50 * 1000)
    const createdAtNewer = new Date(Date.now() - 10 * 1000)

    await prisma.appClientVersionPolicy.createMany({
      data: [
        {
          id: 'it_cp_ios_tie_older',
          platform: 'ios',
          effectiveFrom,
          minSupportedVersion: '1.0.0',
          recommendedBelowVersion: '1.2.0',
          latestVersion: '1.2.0',
          note: '[itest] tie older',
          createdAt: createdAtOlder,
          updatedAt: createdAtOlder,
        },
        {
          id: 'it_cp_ios_tie_newer',
          platform: 'ios',
          effectiveFrom,
          minSupportedVersion: '1.2.0',
          recommendedBelowVersion: '1.4.0',
          latestVersion: '1.5.0',
          note: '[itest] tie newer',
          createdAt: createdAtNewer,
          updatedAt: createdAtNewer,
        },
      ],
    })

    const { json } = await callPolicyRoute(postLegacyVersionPolicy, {
      clientVersion: '1.1.5',
      platform: 'ios',
    })

    expect(json.action).toBe('force_update')
    expect(json.minSupportedVersion).toBe('1.2.0')
    expect(json.latestVersion).toBe('1.5.0')
  })

  it('returns force/recommend/none for iOS client versions against DB policy rows', async () => {
    const force = await callPolicyRoute(postIosVersionPolicy, {
      clientVersion: '1.0.9',
      platform: 'ios',
    })
    expect(force.json.action).toBe('force_update')

    const recommend = await callPolicyRoute(postIosVersionPolicy, {
      clientVersion: '1.2.0',
      platform: 'ios',
    })
    expect(recommend.json.action).toBe('recommend_update')

    const none = await callPolicyRoute(postIosVersionPolicy, {
      clientVersion: '1.3.0',
      platform: 'ios',
    })
    expect(none.json.action).toBe('none')
  })

  it('falls back to iOS policy row when Android policy is missing', async () => {
    await prisma.appClientVersionPolicy.deleteMany({ where: { platform: 'android' } })

    const { json } = await callPolicyRoute(postAndroidVersionPolicy, {
      clientVersion: '1.2.0',
      platform: 'android',
    })

    expect(json.platform).toBe('android')
    expect(json.policyPlatform).toBe('ios')
    expect(json.action).toBe('recommend_update')
  })

  it('keeps one version-catalog row on duplicate inserts (insert-if-not-exists behavior)', async () => {
    await callPolicyRoute(postLegacyVersionPolicy, {
      clientVersion: '2.0.5',
      platform: 'android',
    })
    await callPolicyRoute(postLegacyVersionPolicy, {
      clientVersion: '2.0.5',
      platform: 'android',
    })

    const rowCount = await prisma.appClientVersion.count({
      where: {
        platform: 'android',
        version: '2.0.5',
      },
    })
    expect(rowCount).toBe(1)
  })

  it('fails closed to force_update when no active iOS policy rows exist', async () => {
    await prisma.appClientVersionPolicy.deleteMany({ where: { platform: 'ios' } })

    const { json } = await callPolicyRoute(postIosVersionPolicy, {
      clientVersion: '9.9.9',
      platform: 'ios',
    })

    expect(json.action).toBe('force_update')
    expect(json.minSupportedVersion).toBe('1.0.0')
    expect(json.latestVersion).toBe('1.0.0')
  })
})

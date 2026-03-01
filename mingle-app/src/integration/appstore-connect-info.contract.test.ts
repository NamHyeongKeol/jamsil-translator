import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

type ScreenshotCopy = {
  line1?: unknown
  line2?: unknown
}

type MetadataEntry = {
  promotionalText?: unknown
  description?: unknown
  keywords?: unknown
  supportUrl?: unknown
  marketingUrl?: unknown
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function isNonEmptyKeywords(value: unknown): boolean {
  if (isNonEmptyString(value)) {
    return true
  }

  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => isNonEmptyString(item))
  )
}

function normalizeUploadLocale(uploadLocaleDirName: string): string {
  const normalized = uploadLocaleDirName.trim().toLowerCase()
  if (normalized === 'en-us') {
    return 'en'
  }
  return normalized
}

const appStoreInfoRoot = path.resolve(
  process.cwd(),
  'rn/appstore-connect-info',
)
const appStoreInfoJsonPath = path.join(
  appStoreInfoRoot,
  'appstore-connect-info.i18n.json',
)
const uploadRoot = path.join(appStoreInfoRoot, 'upload')
const payload = JSON.parse(
  fs.readFileSync(appStoreInfoJsonPath, 'utf8'),
) as {
  meta?: {
    shots?: unknown
    locales?: unknown
  }
  ios?: {
    submission?: {
      version?: unknown
      screenshots?: Record<string, ScreenshotCopy[]>
      appStoreInfo?: {
        defaultMetadataLocale?: unknown
        metadata?: Record<string, MetadataEntry>
      }
      copyright?: unknown
    }
    generalInfo?: {
      appInfo?: {
        title?: Record<string, unknown>
        subtitle?: Record<string, unknown>
      }
    }
  }
}

describe('appstore-connect-info contract', () => {
  it('includes required sections for App Store Connect sync', () => {
    const shots = payload.meta?.shots
    const locales = payload.meta?.locales
    const submission = payload.ios?.submission
    const appInfo = payload.ios?.generalInfo?.appInfo

    expect(Number.isInteger(shots)).toBe(true)
    expect((shots as number) > 0).toBe(true)
    expect(Array.isArray(locales)).toBe(true)
    expect((locales as unknown[]).length).toBeGreaterThan(0)
    expect(isNonEmptyString(submission?.version)).toBe(true)
    expect(isNonEmptyString(submission?.copyright)).toBe(true)
    expect(submission?.screenshots).toBeDefined()
    expect(submission?.appStoreInfo?.metadata).toBeDefined()
    expect(isNonEmptyString(submission?.appStoreInfo?.defaultMetadataLocale)).toBe(
      true,
    )
    expect(appInfo?.title).toBeDefined()
    expect(appInfo?.subtitle).toBeDefined()
  })

  it('has screenshot copy keys for every locale and shot', () => {
    const locales = payload.meta?.locales as string[]
    const totalShots = payload.meta?.shots as number
    const screenshots = payload.ios?.submission?.screenshots ?? {}

    for (const locale of locales) {
      const localeShots = screenshots[locale]
      expect(localeShots, `missing screenshot copy for locale: ${locale}`).toBeDefined()
      expect(
        localeShots?.length,
        `unexpected screenshot count for locale: ${locale}`,
      ).toBe(totalShots)

      localeShots?.forEach((shot, index) => {
        const shotNumber = index + 1
        expect(
          isNonEmptyString(shot?.line1),
          `missing line1 for ${locale} shot ${shotNumber}`,
        ).toBe(true)
        expect(
          isNonEmptyString(shot?.line2),
          `missing line2 for ${locale} shot ${shotNumber}`,
        ).toBe(true)
      })
    }
  })

  it('has title and subtitle for every declared locale', () => {
    const locales = payload.meta?.locales as string[]
    const titles = payload.ios?.generalInfo?.appInfo?.title ?? {}
    const subtitles = payload.ios?.generalInfo?.appInfo?.subtitle ?? {}

    for (const locale of locales) {
      expect(isNonEmptyString(titles[locale]), `missing app title for locale: ${locale}`).toBe(
        true,
      )
      expect(
        isNonEmptyString(subtitles[locale]),
        `missing app subtitle for locale: ${locale}`,
      ).toBe(true)
    }
  })

  it('keeps metadata fields complete for default and upload locales', () => {
    const metadataByLocale = payload.ios?.submission?.appStoreInfo?.metadata ?? {}
    const defaultMetadataLocale = payload.ios?.submission?.appStoreInfo
      ?.defaultMetadataLocale as string
    const uploadLocales = fs
      .readdirSync(uploadRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => normalizeUploadLocale(entry.name))

    expect(metadataByLocale[defaultMetadataLocale]).toBeDefined()

    for (const locale of Object.keys(metadataByLocale)) {
      const metadata = metadataByLocale[locale]
      expect(
        isNonEmptyString(metadata.promotionalText),
        `missing promotionalText for metadata locale: ${locale}`,
      ).toBe(true)
      expect(
        isNonEmptyString(metadata.description),
        `missing description for metadata locale: ${locale}`,
      ).toBe(true)
      expect(
        isNonEmptyKeywords(metadata.keywords),
        `missing keywords for metadata locale: ${locale}`,
      ).toBe(true)
      expect(
        isNonEmptyString(metadata.supportUrl),
        `missing supportUrl for metadata locale: ${locale}`,
      ).toBe(true)
      expect(
        isNonEmptyString(metadata.marketingUrl),
        `missing marketingUrl for metadata locale: ${locale}`,
      ).toBe(true)
    }

    for (const uploadLocale of uploadLocales) {
      const effectiveMetadata =
        metadataByLocale[uploadLocale] ?? metadataByLocale[defaultMetadataLocale]
      expect(
        effectiveMetadata,
        `missing metadata for upload locale: ${uploadLocale} and default fallback`,
      ).toBeDefined()
    }
  })

  it('ensures upload media is enough for App Store locale packages', () => {
    const totalShots = payload.meta?.shots as number
    const screenshots = payload.ios?.submission?.screenshots ?? {}
    const uploadLocaleDirs = fs
      .readdirSync(uploadRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()

    expect(uploadLocaleDirs.length).toBeGreaterThan(0)

    for (const uploadLocale of uploadLocaleDirs) {
      const mappedLocale = normalizeUploadLocale(uploadLocale)
      expect(
        screenshots[mappedLocale],
        `missing screenshot text for upload locale: ${uploadLocale} (mapped: ${mappedLocale})`,
      ).toBeDefined()

      const files = fs
        .readdirSync(path.join(uploadRoot, uploadLocale), { withFileTypes: true })
        .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
        .map((entry) => entry.name)

      const mediaFiles = files.filter((fileName) =>
        /\.(png|jpg|jpeg|mp4|mov)$/i.test(fileName),
      )
      const videoFiles = mediaFiles.filter((fileName) => /\.(mp4|mov)$/i.test(fileName))
      const imageFiles = mediaFiles.filter((fileName) => /\.(png|jpg|jpeg)$/i.test(fileName))

      expect(
        mediaFiles.length,
        `insufficient media count for upload locale: ${uploadLocale}`,
      ).toBeGreaterThanOrEqual(totalShots)
      expect(videoFiles.length, `missing app preview video for locale: ${uploadLocale}`).toBeGreaterThanOrEqual(1)
      expect(
        imageFiles.length,
        `insufficient screenshot image count for locale: ${uploadLocale}`,
      ).toBeGreaterThanOrEqual(totalShots - 1)

      const shotIndexes = new Set(
        mediaFiles
          .map((fileName) => fileName.match(/^(\d{2})-/)?.[1])
          .filter((value): value is string => Boolean(value)),
      )

      for (let index = 1; index <= totalShots; index += 1) {
        const key = String(index).padStart(2, '0')
        expect(
          shotIndexes.has(key),
          `missing shot index ${key} for upload locale: ${uploadLocale}`,
        ).toBe(true)
      }
    }
  })
})

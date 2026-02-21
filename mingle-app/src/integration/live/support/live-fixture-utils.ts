import path from 'node:path'
import {
  type LiveE2EEnv,
  type Pcm16MonoWav,
  classifyAudioFixture,
  collectAudioFixtureCandidates,
  formatError,
  loadFixtureAsPcm16MonoWav,
  wavDurationMs,
} from './live-e2e-utils'

export type ValidFixture = {
  fixturePath: string
  fixtureName: string
  fixtureType: 'wav' | 'transcode'
  fixture: Pcm16MonoWav
  durationMs: number
}

export type ScanResult = {
  scanDirs: string[]
  candidates: string[]
  validFixtures: ValidFixture[]
}

export function scanFixtures(env: LiveE2EEnv): ScanResult {
  const scanDirs = env.audioFixtureDirOverride
    ? [path.resolve(process.cwd(), env.audioFixtureDirOverride)]
    : env.audioFixtureScanDirs

  const candidates = collectAudioFixtureCandidates({
    audioFixtureOverride: env.audioFixtureOverride,
    audioFixtureDirOverride: env.audioFixtureDirOverride,
    audioFixtureScanDirs: env.audioFixtureScanDirs,
  })

  const validFixtures: ValidFixture[] = []
  for (const fixturePath of candidates) {
    const fixtureType = classifyAudioFixture(fixturePath)
    if (fixtureType === 'unsupported') {
      console.warn(`[live-test][skip] unsupported extension: ${fixturePath}`)
      continue
    }

    try {
      const fixture = loadFixtureAsPcm16MonoWav(fixturePath, env.audioTranscoder)
      if (fixtureType === 'transcode') {
        console.info(`[live-test] transcoded fixture via ${env.audioTranscoder}: ${fixturePath}`)
      }
      validFixtures.push({
        fixturePath,
        fixtureName: path.basename(fixturePath),
        fixtureType,
        fixture,
        durationMs: wavDurationMs(fixture),
      })
    } catch (error) {
      console.warn([
        `[live-test][skip] invalid fixture: ${fixturePath}`,
        formatError(error),
      ].join('\n'))
    }
  }

  validFixtures.sort((a, b) => a.durationMs - b.durationMs)

  return {
    scanDirs,
    candidates,
    validFixtures,
  }
}

export function pickShortestFixture(scanResult: ScanResult): ValidFixture {
  if (scanResult.validFixtures.length === 0) {
    throw new Error([
      '[live-test] no valid audio fixture was processed.',
      `- scanned dirs: ${scanResult.scanDirs.join(', ')}`,
      '- unsupported/invalid files are skipped; add at least one valid fixture.',
    ].join('\n'))
  }

  return scanResult.validFixtures[0]
}

export function pickFixturesUpTo(scanResult: ScanResult, count: number): ValidFixture[] {
  if (scanResult.validFixtures.length === 0) {
    throw new Error([
      '[live-test] no valid audio fixture was processed.',
      `- scanned dirs: ${scanResult.scanDirs.join(', ')}`,
      '- unsupported/invalid files are skipped; add at least one valid fixture.',
    ].join('\n'))
  }

  return scanResult.validFixtures.slice(0, Math.max(1, count))
}

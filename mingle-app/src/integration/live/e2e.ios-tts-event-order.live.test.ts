import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { readEnvBool, readLiveE2EEnv, readEnvOptionalString } from './support/live-e2e-utils'

type TtsEvent = {
  playbackId: string
  eventType: string
  ts: number
}

function parseEventLine(line: string): TtsEvent | null {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>
    const playbackId = typeof parsed.playbackId === 'string' ? parsed.playbackId.trim() : ''
    const eventType = typeof parsed.eventType === 'string' ? parsed.eventType.trim() : ''
    const tsRaw = parsed.ts
    const ts = typeof tsRaw === 'number' ? tsRaw : Number.parseInt(String(tsRaw || ''), 10)

    if (!playbackId || !eventType || !Number.isFinite(ts)) return null
    return { playbackId, eventType, ts }
  } catch {
    return null
  }
}

const ENABLED = readEnvBool('MINGLE_TEST_IOS_TTS_EVENT_E2E', false)
const describeIfEnabled = ENABLED ? describe.sequential : describe.skip
const env = readLiveE2EEnv()

describeIfEnabled('e2e regression: ios tts event ordering', () => {
  it('keeps playbackId event ordering consistent', () => {
    const logPathRaw = readEnvOptionalString('MINGLE_TEST_IOS_TTS_EVENT_LOG_PATH')
    if (!logPathRaw) {
      throw new Error('[ios-e2e] MINGLE_TEST_IOS_TTS_EVENT_LOG_PATH is required')
    }

    const logPath = path.resolve(process.cwd(), logPathRaw)
    expect(fs.existsSync(logPath)).toBe(true)

    const lines = fs.readFileSync(logPath, 'utf8')
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(Boolean)

    expect(lines.length).toBeGreaterThan(0)

    const events = lines
      .map(parseEventLine)
      .filter((event): event is TtsEvent => event !== null)

    expect(events.length).toBeGreaterThan(0)

    const byPlaybackId = new Map<string, TtsEvent[]>()
    for (const event of events) {
      const list = byPlaybackId.get(event.playbackId)
      if (list) {
        list.push(event)
      } else {
        byPlaybackId.set(event.playbackId, [event])
      }
    }

    expect(byPlaybackId.size).toBeGreaterThan(0)

    for (const [playbackId, playbackEvents] of byPlaybackId.entries()) {
      playbackEvents.sort((a, b) => a.ts - b.ts)

      const startIndex = playbackEvents.findIndex(event => event.eventType === 'start')
      expect(startIndex).toBeGreaterThanOrEqual(0)

      const terminalIndex = playbackEvents.findIndex(
        event => event.eventType === 'end' || event.eventType === 'error' || event.eventType === 'stop',
      )
      expect(terminalIndex).toBeGreaterThanOrEqual(0)
      expect(terminalIndex).toBeGreaterThanOrEqual(startIndex)

      const trailingEvents = playbackEvents.slice(terminalIndex + 1)
      const invalidTrailing = trailingEvents.filter(event => !['debug', 'metric'].includes(event.eventType))
      expect(invalidTrailing.length, `playbackId=${playbackId}`).toBe(0)
    }
  }, env.liveTestTimeoutMs)
})

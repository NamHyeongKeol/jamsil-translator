import { describe, expect, it } from 'vitest'
import {
  compareUtteranceOrder,
  evaluateFrontAudioWait,
  insertByUtteranceOrder,
  parseUtteranceOrder,
} from './tts-queue-utils'

describe('tts-queue-utils', () => {
  it('parses utterance order from canonical id', () => {
    expect(parseUtteranceOrder('u-1700000000000-7')).toEqual({
      createdAtMs: 1700000000000,
      serial: 7,
    })
    expect(parseUtteranceOrder('bad-id')).toBeNull()
  })

  it('compares utterance ids by createdAt then serial', () => {
    expect(compareUtteranceOrder('u-100-1', 'u-101-1')).toBeLessThan(0)
    expect(compareUtteranceOrder('u-100-1', 'u-100-2')).toBeLessThan(0)
    expect(compareUtteranceOrder('u-100-2', 'u-100-1')).toBeGreaterThan(0)
  })

  it('keeps queue sorted when inserting out of order', () => {
    const queue: Array<{ utteranceId: string; tag: string }> = []
    insertByUtteranceOrder(queue, { utteranceId: 'u-100-2', tag: 'second' })
    insertByUtteranceOrder(queue, { utteranceId: 'u-100-1', tag: 'first' })
    insertByUtteranceOrder(queue, { utteranceId: 'u-099-9', tag: 'older' })

    expect(queue.map(item => item.utteranceId)).toEqual([
      'u-099-9',
      'u-100-1',
      'u-100-2',
    ])
  })

  it('starts timeout window when an item first becomes front', () => {
    // Item could be reserved long ago, but timeout should not consume
    // that non-front time. First front evaluation must start at "now".
    const state = evaluateFrontAudioWait({
      frontWaitStartedAtMs: null,
      nowMs: 20000,
      timeoutMs: 9000,
    })

    expect(state.frontWaitStartedAtMs).toBe(20000)
    expect(state.elapsedMs).toBe(0)
    expect(state.remainingMs).toBe(9000)
    expect(state.shouldTimeout).toBe(false)
  })

  it('times out only after front wait exceeds timeout', () => {
    const beforeTimeout = evaluateFrontAudioWait({
      frontWaitStartedAtMs: 1000,
      nowMs: 9950,
      timeoutMs: 9000,
    })
    expect(beforeTimeout.shouldTimeout).toBe(false)
    expect(beforeTimeout.remainingMs).toBe(50)

    const timedOut = evaluateFrontAudioWait({
      frontWaitStartedAtMs: 1000,
      nowMs: 10050,
      timeoutMs: 9000,
    })
    expect(timedOut.shouldTimeout).toBe(true)
    expect(timedOut.elapsedMs).toBe(9050)
    expect(timedOut.remainingMs).toBe(0)
  })
})

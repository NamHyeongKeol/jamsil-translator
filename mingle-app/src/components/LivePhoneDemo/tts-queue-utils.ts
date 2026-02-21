const UTTERANCE_ID_ORDER_PATTERN = /^u-(\d+)-(\d+)$/

export type ParsedUtteranceOrder = {
  createdAtMs: number
  serial: number
}

export function parseUtteranceOrder(utteranceId: string): ParsedUtteranceOrder | null {
  const match = UTTERANCE_ID_ORDER_PATTERN.exec(utteranceId.trim())
  if (!match) return null
  const createdAtMs = Number.parseInt(match[1], 10)
  const serial = Number.parseInt(match[2], 10)
  if (!Number.isFinite(createdAtMs) || !Number.isFinite(serial)) return null
  return { createdAtMs, serial }
}

export function compareUtteranceOrder(aUtteranceId: string, bUtteranceId: string): number {
  const a = parseUtteranceOrder(aUtteranceId)
  const b = parseUtteranceOrder(bUtteranceId)
  if (a && b) {
    if (a.createdAtMs !== b.createdAtMs) return a.createdAtMs - b.createdAtMs
    if (a.serial !== b.serial) return a.serial - b.serial
    return aUtteranceId.localeCompare(bUtteranceId)
  }
  if (a) return -1
  if (b) return 1
  return aUtteranceId.localeCompare(bUtteranceId)
}

export function insertByUtteranceOrder<T extends { utteranceId: string }>(queue: T[], item: T) {
  const insertAt = queue.findIndex(candidate => compareUtteranceOrder(item.utteranceId, candidate.utteranceId) < 0)
  if (insertAt < 0) {
    queue.push(item)
    return
  }
  queue.splice(insertAt, 0, item)
}

export type FrontAudioWaitState = {
  frontWaitStartedAtMs: number
  elapsedMs: number
  remainingMs: number
  shouldTimeout: boolean
}

export function evaluateFrontAudioWait(args: {
  frontWaitStartedAtMs: number | null
  nowMs: number
  timeoutMs: number
}): FrontAudioWaitState {
  const nowMs = Number.isFinite(args.nowMs) ? Math.floor(args.nowMs) : Date.now()
  const timeoutMs = Number.isFinite(args.timeoutMs) ? Math.max(0, Math.floor(args.timeoutMs)) : 0
  const frontWaitStartedAtMs = (
    Number.isFinite(args.frontWaitStartedAtMs ?? NaN)
      ? Math.floor(args.frontWaitStartedAtMs as number)
      : nowMs
  )
  const elapsedMs = Math.max(0, nowMs - frontWaitStartedAtMs)
  const remainingMs = Math.max(0, timeoutMs - elapsedMs)
  return {
    frontWaitStartedAtMs,
    elapsedMs,
    remainingMs,
    shouldTimeout: elapsedMs >= timeoutMs,
  }
}

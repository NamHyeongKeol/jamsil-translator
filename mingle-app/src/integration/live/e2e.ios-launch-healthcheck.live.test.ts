import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { readEnvBool, readLiveE2EEnv } from './support/live-e2e-utils'

const ENABLED = readEnvBool('MINGLE_TEST_IOS_HEALTHCHECK', false)
const describeIfEnabled = ENABLED ? describe.sequential : describe.skip

const env = readLiveE2EEnv()
const scriptPath = path.resolve(process.cwd(), 'scripts/e2e-ios-launch-healthcheck.sh')

describeIfEnabled('e2e regression: ios launch healthcheck', () => {
  it('launches app via devicectl (or xctrace fallback)', () => {
    const run = spawnSync('bash', [scriptPath], {
      cwd: process.cwd(),
      env: process.env,
      encoding: 'utf8',
    })

    const output = [
      (run.stdout || '').trim(),
      (run.stderr || '').trim(),
    ].filter(Boolean).join('\n')

    expect(run.status).toBe(0)

    if (output) {
      console.info(`[ios-e2e]\n${output}`)
    }
  }, env.liveTestTimeoutMs)
})

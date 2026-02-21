import { describe, expect, it } from 'vitest'

import {
  normalizeApiNamespace,
  resolveExpectedApiNamespace,
  validateRnApiNamespace,
} from '../../rn/src/apiNamespace'

describe('RN api namespace validation contract', () => {
  it('normalizes leading and trailing slashes', () => {
    expect(normalizeApiNamespace(' /mobile/ios/v1/ ')).toBe('mobile/ios/v1')
  })

  it('returns expected namespace by runtime os', () => {
    expect(resolveExpectedApiNamespace('ios')).toBe('mobile/ios/v1')
    expect(resolveExpectedApiNamespace('android')).toBe('mobile/android/v1')
    expect(resolveExpectedApiNamespace('web')).toBe('')
  })

  it('accepts only matching iOS namespace', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'ios',
      configuredApiNamespace: 'mobile/ios/v1',
    })

    expect(result.expectedApiNamespace).toBe('mobile/ios/v1')
    expect(result.validatedApiNamespace).toBe('mobile/ios/v1')
  })

  it('rejects mismatched namespace for android', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'android',
      configuredApiNamespace: 'mobile/ios/v1',
    })

    expect(result.expectedApiNamespace).toBe('mobile/android/v1')
    expect(result.validatedApiNamespace).toBe('')
  })

  it('rejects empty namespace', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'ios',
      configuredApiNamespace: '  ',
    })

    expect(result.validatedApiNamespace).toBe('')
  })
})

import { describe, expect, it } from 'vitest'

import {
  normalizeApiNamespace,
  resolveExpectedApiNamespace,
  validateRnApiNamespace,
} from '../../rn/src/apiNamespace'

describe('RN api namespace validation contract', () => {
  it('normalizes leading and trailing slashes', () => {
    expect(normalizeApiNamespace(' /ios/v1.0.0/ ')).toBe('ios/v1.0.0')
  })

  it('returns expected namespace by runtime os', () => {
    expect(resolveExpectedApiNamespace('ios')).toBe('ios/v1.0.0')
    expect(resolveExpectedApiNamespace('android')).toBe('')
    expect(resolveExpectedApiNamespace('web')).toBe('')
  })

  it('accepts only matching iOS namespace', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'ios',
      configuredApiNamespace: 'ios/v1.0.0',
    })

    expect(result.expectedApiNamespace).toBe('ios/v1.0.0')
    expect(result.validatedApiNamespace).toBe('ios/v1.0.0')
  })

  it('rejects namespace when runtime does not define a versioned namespace', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'android',
      configuredApiNamespace: 'ios/v1.0.0',
    })

    expect(result.expectedApiNamespace).toBe('')
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

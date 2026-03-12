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
    expect(resolveExpectedApiNamespace('android')).toBe('android/v1.0.0')
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

  it('accepts only matching Android namespace', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'android',
      configuredApiNamespace: 'android/v1.0.0',
    })

    expect(result.expectedApiNamespace).toBe('android/v1.0.0')
    expect(result.validatedApiNamespace).toBe('android/v1.0.0')
  })

  it('rejects mismatched namespace for Android runtime', () => {
    const result = validateRnApiNamespace({
      runtimeOs: 'android',
      configuredApiNamespace: 'ios/v1.0.0',
    })

    expect(result.expectedApiNamespace).toBe('android/v1.0.0')
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

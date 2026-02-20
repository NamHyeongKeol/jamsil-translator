import { describe, expect, it } from 'vitest'
import {
  normalizeLang,
  sanitizeJsonObject,
  sanitizeText,
  sanitizeTranslations,
} from './sanitize'

describe('client-event sanitize utils', () => {
  it('sanitizes text with trim and max length', () => {
    expect(sanitizeText('  hello  ', 5)).toBe('hello')
    expect(sanitizeText('   ')).toBeNull()
    expect(sanitizeText(123)).toBeNull()
  })

  it('normalizes language to base code with unknown fallback', () => {
    expect(normalizeLang(' KO-KR ')).toBe('ko')
    expect(normalizeLang('en_US')).toBe('en')
    expect(normalizeLang(123)).toBe('unknown')
  })

  it('sanitizes translations and strips marker tokens', () => {
    const longText = `x${'a'.repeat(22000)}`
    const sanitized = sanitizeTranslations({
      'ko-KR': ' 안녕하세요 <fin> ',
      en: '<end>Hello',
      xx: 'custom',
      invalid: 123,
      ja: longText,
    })

    expect(sanitized.ko).toBe('안녕하세요')
    expect(sanitized.en).toBe('Hello')
    expect(sanitized.xx).toBe('custom')
    expect(sanitized.ja.length).toBe(20000)
  })

  it('returns serializable json object and rejects invalid inputs', () => {
    expect(sanitizeJsonObject({ a: 1, b: { c: true } })).toEqual({ a: 1, b: { c: true } })
    expect(sanitizeJsonObject(['array'])).toBeNull()
    expect(sanitizeJsonObject({ value: BigInt(1) })).toBeNull()
  })
})

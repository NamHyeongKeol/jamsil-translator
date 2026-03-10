import { describe, expect, it } from 'vitest'

import {
  DEFAULT_STT_LANGUAGES,
  STT_LANGUAGE_CODES,
  STT_LANGUAGE_NAME_MAP,
  STT_LANGUAGE_OPTIONS,
} from '@/lib/stt-languages'

describe('STT language catalog', () => {
  it('contains the full 60-language STT list', () => {
    expect(STT_LANGUAGE_CODES).toEqual([
      'af', 'sq', 'ar', 'az', 'eu', 'be', 'bn', 'bs', 'bg', 'ca',
      'zh', 'hr', 'cs', 'da', 'nl', 'en', 'et', 'fi', 'fr', 'gl',
      'de', 'el', 'gu', 'he', 'hi', 'hu', 'id', 'it', 'ja', 'kn',
      'kk', 'ko', 'lv', 'lt', 'mk', 'ms', 'ml', 'mr', 'no', 'fa',
      'pl', 'pt', 'pa', 'ro', 'ru', 'sr', 'sk', 'sl', 'es', 'sw',
      'sv', 'tl', 'ta', 'te', 'th', 'tr', 'uk', 'ur', 'vi', 'cy',
    ])
  })

  it('keeps unique codes and names for server prompt metadata', () => {
    expect(new Set(STT_LANGUAGE_CODES).size).toBe(60)
    expect(STT_LANGUAGE_OPTIONS).toHaveLength(60)
    expect(STT_LANGUAGE_NAME_MAP.ko).toBe('Korean')
    expect(STT_LANGUAGE_NAME_MAP.cy).toBe('Welsh')
  })

  it('preserves the default starter languages', () => {
    expect(DEFAULT_STT_LANGUAGES).toEqual(['en', 'ko', 'ja'])
  })
})

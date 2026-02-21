import { describe, expect, it } from 'vitest'
import {
  NATIVE_UI_EVENT,
  NATIVE_UI_QUERY_KEY,
  isNativeUiBridgeEnabledFromSearch,
  parseNativeUiScrollToTopDetail,
  shouldEnableIosTopTapFallback,
} from './live-phone-demo.native-ui.logic'

describe('live-phone-demo native ui bridge logic', () => {
  it('exposes native ui event name constant', () => {
    expect(NATIVE_UI_EVENT).toBe('mingle:native-ui')
  })

  it('exposes native ui query key constant', () => {
    expect(NATIVE_UI_QUERY_KEY).toBe('nativeUi')
  })

  it('parses valid scroll_to_top payload', () => {
    const parsed = parseNativeUiScrollToTopDetail({
      type: 'scroll_to_top',
      source: 'ios_status_bar_overlay',
    })

    expect(parsed).toEqual({
      type: 'scroll_to_top',
      source: 'ios_status_bar_overlay',
    })
  })

  it('normalizes empty source to unknown', () => {
    const parsed = parseNativeUiScrollToTopDetail({
      type: 'scroll_to_top',
      source: '   ',
    })

    expect(parsed).toEqual({
      type: 'scroll_to_top',
      source: 'unknown',
    })
  })

  it('returns null for non-object payloads', () => {
    expect(parseNativeUiScrollToTopDetail(null)).toBeNull()
    expect(parseNativeUiScrollToTopDetail('scroll_to_top')).toBeNull()
    expect(parseNativeUiScrollToTopDetail(1)).toBeNull()
  })

  it('returns null for unsupported type', () => {
    expect(parseNativeUiScrollToTopDetail({
      type: 'unknown_event',
      source: 'ios_status_bar_overlay',
    })).toBeNull()
  })

  it('enables native ui bridge when query has nativeUi=1', () => {
    expect(isNativeUiBridgeEnabledFromSearch('?nativeUi=1')).toBe(true)
  })

  it('enables native ui bridge when query has nativeUi=true (case-insensitive)', () => {
    expect(isNativeUiBridgeEnabledFromSearch('?nativeUi=TRUE')).toBe(true)
  })

  it('disables native ui bridge when query is absent or malformed', () => {
    expect(isNativeUiBridgeEnabledFromSearch('')).toBe(false)
    expect(isNativeUiBridgeEnabledFromSearch('?foo=bar')).toBe(false)
    expect(isNativeUiBridgeEnabledFromSearch('%')).toBe(false)
  })

  describe('shouldEnableIosTopTapFallback', () => {
    it('enables fallback for iOS platform regardless of bridge flag', () => {
      expect(shouldEnableIosTopTapFallback({
        isLikelyIosPlatform: true,
        isNativeApp: true,
        isNativeUiBridgeEnabled: false,
      })).toBe(true)
    })

    it('enables fallback when native bridge mode is on even if iOS detection fails', () => {
      expect(shouldEnableIosTopTapFallback({
        isLikelyIosPlatform: false,
        isNativeApp: true,
        isNativeUiBridgeEnabled: true,
      })).toBe(true)
    })

    it('disables fallback for non-native non-iOS contexts', () => {
      expect(shouldEnableIosTopTapFallback({
        isLikelyIosPlatform: false,
        isNativeApp: false,
        isNativeUiBridgeEnabled: false,
      })).toBe(false)
    })
  })
})

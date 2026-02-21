import { describe, expect, it } from 'vitest'
import {
  AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
  deriveScrollAutoFollowState,
  deriveScrollUiVisibility,
  isLikelyIOSNavigator,
} from './live-phone-demo.scroll.logic'

describe('live-phone-demo scroll/platform logic', () => {
  describe('isLikelyIOSNavigator', () => {
    it('returns true for iPhone user agent', () => {
      expect(isLikelyIOSNavigator({
        userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)',
        platform: 'iPhone',
        maxTouchPoints: 5,
      })).toBe(true)
    })

    it('returns true for iPadOS Safari desktop-class UA on touch MacIntel', () => {
      expect(isLikelyIOSNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
        platform: 'MacIntel',
        maxTouchPoints: 5,
      })).toBe(true)
    })

    it('returns false for real macOS desktop without touch points', () => {
      expect(isLikelyIOSNavigator({
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0)',
        platform: 'MacIntel',
        maxTouchPoints: 0,
      })).toBe(false)
    })

    it('returns false for Android devices', () => {
      expect(isLikelyIOSNavigator({
        userAgent: 'Mozilla/5.0 (Linux; Android 15; Pixel 9)',
        platform: 'Linux armv8l',
        maxTouchPoints: 5,
      })).toBe(false)
    })
  })

  describe('deriveScrollAutoFollowState', () => {
    it('suppresses auto-follow when user manually scrolls away from bottom', () => {
      const state = deriveScrollAutoFollowState({
        distanceToBottom: AUTO_SCROLL_BOTTOM_THRESHOLD_PX + 1,
        fromUserScroll: true,
        suppressAutoScroll: false,
        isPaginating: false,
        isLoadingOlder: false,
      })

      expect(state.isNearBottom).toBe(false)
      expect(state.suppressAutoScroll).toBe(true)
      expect(state.shouldAutoScroll).toBe(false)
    })

    it('re-enables auto-follow when user returns near bottom', () => {
      const state = deriveScrollAutoFollowState({
        distanceToBottom: AUTO_SCROLL_BOTTOM_THRESHOLD_PX - 1,
        fromUserScroll: true,
        suppressAutoScroll: true,
        isPaginating: false,
        isLoadingOlder: false,
      })

      expect(state.isNearBottom).toBe(true)
      expect(state.suppressAutoScroll).toBe(false)
      expect(state.shouldAutoScroll).toBe(true)
    })

    it('treats threshold boundary as near bottom', () => {
      const state = deriveScrollAutoFollowState({
        distanceToBottom: AUTO_SCROLL_BOTTOM_THRESHOLD_PX,
        fromUserScroll: false,
        suppressAutoScroll: false,
        isPaginating: false,
        isLoadingOlder: false,
      })

      expect(state.isNearBottom).toBe(true)
      expect(state.shouldAutoScroll).toBe(true)
    })

    it('keeps auto-follow off while paginating older utterances', () => {
      const state = deriveScrollAutoFollowState({
        distanceToBottom: 10,
        fromUserScroll: false,
        suppressAutoScroll: false,
        isPaginating: true,
        isLoadingOlder: false,
      })

      expect(state.shouldAutoScroll).toBe(false)
    })

    it('keeps auto-follow off while loading older utterances', () => {
      const state = deriveScrollAutoFollowState({
        distanceToBottom: 10,
        fromUserScroll: false,
        suppressAutoScroll: false,
        isPaginating: false,
        isLoadingOlder: true,
      })

      expect(state.shouldAutoScroll).toBe(false)
    })

    it('keeps suppression after top-safe-area tap equivalent state', () => {
      const state = deriveScrollAutoFollowState({
        distanceToBottom: AUTO_SCROLL_BOTTOM_THRESHOLD_PX + 600,
        fromUserScroll: true,
        suppressAutoScroll: true,
        isPaginating: false,
        isLoadingOlder: false,
      })

      expect(state.suppressAutoScroll).toBe(true)
      expect(state.shouldAutoScroll).toBe(false)
    })
  })

  describe('deriveScrollUiVisibility', () => {
    it('hides overlay during pure auto-follow momentum scroll', () => {
      const ui = deriveScrollUiVisibility({
        fromUserScroll: false,
        shouldAutoScroll: true,
      })

      expect(ui.visible).toBe(false)
      expect(ui.scheduleHideTimer).toBe(false)
    })

    it('keeps overlay visible during momentum scroll when auto-follow is suppressed', () => {
      const ui = deriveScrollUiVisibility({
        fromUserScroll: false,
        shouldAutoScroll: false,
      })

      expect(ui.visible).toBe(true)
      expect(ui.scheduleHideTimer).toBe(true)
    })

    it('keeps overlay visible for explicit user scroll events', () => {
      const ui = deriveScrollUiVisibility({
        fromUserScroll: true,
        shouldAutoScroll: true,
      })

      expect(ui.visible).toBe(true)
      expect(ui.scheduleHideTimer).toBe(true)
    })
  })
})

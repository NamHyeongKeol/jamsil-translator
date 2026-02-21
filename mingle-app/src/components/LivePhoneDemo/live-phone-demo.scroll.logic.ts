export const AUTO_SCROLL_BOTTOM_THRESHOLD_PX = 200

export interface NavigatorLikeForIosCheck {
  userAgent?: string
  platform?: string
  maxTouchPoints?: number
}

export function isLikelyIOSNavigator(navigatorLike: NavigatorLikeForIosCheck): boolean {
  const ua = navigatorLike.userAgent || ''
  const platform = navigatorLike.platform || ''
  const maxTouchPoints = typeof navigatorLike.maxTouchPoints === 'number'
    ? navigatorLike.maxTouchPoints
    : 0
  return /iPad|iPhone|iPod/.test(ua) || (platform === 'MacIntel' && maxTouchPoints > 1)
}

export interface DeriveScrollAutoFollowStateInput {
  distanceToBottom: number
  fromUserScroll: boolean
  suppressAutoScroll: boolean
  isPaginating: boolean
  isLoadingOlder: boolean
  nearBottomThresholdPx?: number
}

export interface DeriveScrollAutoFollowStateResult {
  isNearBottom: boolean
  suppressAutoScroll: boolean
  shouldAutoScroll: boolean
}

export function deriveScrollAutoFollowState(
  input: DeriveScrollAutoFollowStateInput,
): DeriveScrollAutoFollowStateResult {
  const threshold = input.nearBottomThresholdPx ?? AUTO_SCROLL_BOTTOM_THRESHOLD_PX
  const safeDistance = Number.isFinite(input.distanceToBottom)
    ? Math.max(0, input.distanceToBottom)
    : Number.POSITIVE_INFINITY
  const isNearBottom = safeDistance <= threshold

  // When user explicitly scrolls, manual scroll intent should win.
  // Auto-follow is re-enabled only when user returns near the bottom.
  const nextSuppressAutoScroll = input.fromUserScroll
    ? !isNearBottom
    : input.suppressAutoScroll

  const shouldAutoScroll = (
    isNearBottom
    && !nextSuppressAutoScroll
    && !input.isPaginating
    && !input.isLoadingOlder
  )

  return {
    isNearBottom,
    suppressAutoScroll: nextSuppressAutoScroll,
    shouldAutoScroll,
  }
}

export interface DeriveScrollUiVisibilityInput {
  fromUserScroll: boolean
  shouldAutoScroll: boolean
}

export interface DeriveScrollUiVisibilityResult {
  visible: boolean
  scheduleHideTimer: boolean
}

export function deriveScrollUiVisibility(
  input: DeriveScrollUiVisibilityInput,
): DeriveScrollUiVisibilityResult {
  // During pure auto-follow scrolls, keep overlay hidden.
  if (!input.fromUserScroll && input.shouldAutoScroll) {
    return { visible: false, scheduleHideTimer: false }
  }

  // User scroll or non-auto-follow momentum: keep visible for a short window.
  return { visible: true, scheduleHideTimer: true }
}

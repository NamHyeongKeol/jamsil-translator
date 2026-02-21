import { buildLandingApiPath } from '@/lib/api-contract'

// Collect common user/browser info for all tracking calls
export function getUserInfo() {
  return {
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    platform: navigator.platform,
    language: navigator.language,
    referrer: document.referrer || null,
    pathname: window.location.pathname,
    fullUrl: window.location.href,
    queryParams: window.location.search || null,
  }
}

// Log button click with user info
export async function logButtonClick(buttonType: string) {
  try {
    await fetch(buildLandingApiPath('/log-click'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        buttonType,
        ...getUserInfo(),
      }),
    })
  } catch (error) {
    // Silently fail - don't block user interaction
    console.error('Failed to log click:', error)
  }
}

// Log page visit with user info
export async function logVisit(pageLanguage: string) {
  try {
    await fetch(buildLandingApiPath('/log-visit'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...getUserInfo(),
        pageLanguage,
      }),
    })
  } catch (error) {
    console.error('Failed to log visit:', error)
  }
}

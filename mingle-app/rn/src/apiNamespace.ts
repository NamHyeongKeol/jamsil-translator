export const EXPECTED_API_NAMESPACE_BY_OS = {
  ios: 'mobile/ios/v1',
  android: 'mobile/android/v1',
} as const

export function normalizeApiNamespace(raw: string): string {
  return raw.trim().replace(/^\/+/, '').replace(/\/+$/, '')
}

export function resolveExpectedApiNamespace(runtimeOs: string): string {
  if (runtimeOs === 'ios') return EXPECTED_API_NAMESPACE_BY_OS.ios
  if (runtimeOs === 'android') return EXPECTED_API_NAMESPACE_BY_OS.android
  return ''
}

export function validateRnApiNamespace(params: {
  runtimeOs: string
  configuredApiNamespace: string
}): {
  expectedApiNamespace: string
  configuredApiNamespace: string
  validatedApiNamespace: string
} {
  const expectedApiNamespace = resolveExpectedApiNamespace(params.runtimeOs)
  const configuredApiNamespace = normalizeApiNamespace(params.configuredApiNamespace)
  const validatedApiNamespace =
    expectedApiNamespace &&
    configuredApiNamespace &&
    configuredApiNamespace === expectedApiNamespace
      ? configuredApiNamespace
      : ''

  return {
    expectedApiNamespace,
    configuredApiNamespace,
    validatedApiNamespace,
  }
}

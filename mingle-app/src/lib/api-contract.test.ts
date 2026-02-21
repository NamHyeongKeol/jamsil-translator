import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const ORIGINAL_API_NAMESPACE = process.env.NEXT_PUBLIC_API_NAMESPACE

function stubWindowSearch(search: string): void {
  vi.stubGlobal('window', {
    location: { search },
  } as unknown as Window & typeof globalThis)
}

async function loadApiContractModule() {
  vi.resetModules()
  return import('./api-contract')
}

describe('api-contract namespace guard', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
    delete process.env.NEXT_PUBLIC_API_NAMESPACE
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    if (typeof ORIGINAL_API_NAMESPACE === 'string') {
      process.env.NEXT_PUBLIC_API_NAMESPACE = ORIGINAL_API_NAMESPACE
    } else {
      delete process.env.NEXT_PUBLIC_API_NAMESPACE
    }
  })

  it('uses default namespace when nothing is configured', async () => {
    const contract = await loadApiContractModule()

    expect(contract.clientApiNamespace).toBe('web/app/v1')
    expect(contract.buildClientApiPath('/translate/finalize')).toBe('/api/web/app/v1/translate/finalize')
  })

  it('accepts only allowed env namespace values', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'mobile/ios/v1'
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('mobile/ios/v1')
  })

  it('ignores invalid env namespace values', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'web/app/v9'
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('web/app/v1')
  })

  it('allows query override only when value is allow-listed', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'web/app/v1'
    stubWindowSearch('?apiNamespace=mobile%2Fandroid%2Fv1')
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('mobile/android/v1')
  })

  it('ignores invalid query override values', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'mobile/ios/v1'
    stubWindowSearch('?apiNs=unknown%2Fnamespace')
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('mobile/ios/v1')
  })
})

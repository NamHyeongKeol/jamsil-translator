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

    expect(contract.clientApiNamespace).toBe('')
    expect(contract.buildClientApiPath('/translate/finalize')).toBe('/api/translate/finalize')
  })

  it('accepts only allowed env namespace values', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'ios/v1.0.0'
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('ios/v1.0.0')
  })

  it('ignores invalid env namespace values', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'ios/v9.0.0'
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('')
  })

  it('allows query override only when value is allow-listed', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = ''
    stubWindowSearch('?apiNamespace=ios%2Fv1.0.0')
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('ios/v1.0.0')
  })

  it('ignores invalid query override values', async () => {
    process.env.NEXT_PUBLIC_API_NAMESPACE = 'ios/v1.0.0'
    stubWindowSearch('?apiNs=unknown%2Fnamespace')
    const contract = await loadApiContractModule()
    expect(contract.clientApiNamespace).toBe('ios/v1.0.0')
  })
})

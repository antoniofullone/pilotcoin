import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fetchBtcPrice } from '../lib/price'

const BINANCE_PRICE = 65432.10
const KRAKEN_PRICE = 65430.50

function makeBinanceResponse(price: number) {
  return { price: price.toString() }
}

function makeKrakenResponse(price: number) {
  return { result: { XXBTZUSD: { c: [price.toString()] } } }
}

function mockFetch(responses: Array<{ ok: boolean; body?: unknown; throws?: boolean }>) {
  let callCount = 0
  return vi.fn(async (_url: string) => {
    const response = responses[callCount++] ?? responses[responses.length - 1]
    if (response.throws) throw new Error('Network error')
    return {
      ok: response.ok,
      status: response.ok ? 200 : 500,
      json: async () => response.body,
    }
  })
}

beforeEach(() => {
  vi.restoreAllMocks()
})

describe('fetchBtcPrice', () => {
  it('returns Binance price when Binance succeeds', async () => {
    vi.stubGlobal('fetch', mockFetch([
      { ok: true, body: makeBinanceResponse(BINANCE_PRICE) },
    ]))

    const result = await fetchBtcPrice()
    expect(result.price).toBe(BINANCE_PRICE)
    expect(result.source).toBe('binance')
  })

  it('falls back to Kraken when Binance fails', async () => {
    vi.stubGlobal('fetch', mockFetch([
      { ok: false },
      { ok: true, body: makeKrakenResponse(KRAKEN_PRICE) },
    ]))

    const result = await fetchBtcPrice()
    expect(result.price).toBe(KRAKEN_PRICE)
    expect(result.source).toBe('kraken')
  })

  it('throws when both sources fail', async () => {
    vi.stubGlobal('fetch', mockFetch([
      { ok: false },
      { ok: false },
    ]))

    await expect(fetchBtcPrice()).rejects.toThrow()
  })

  it('tries Kraken first when preferredSource is kraken', async () => {
    const fetchMock = mockFetch([
      { ok: true, body: makeKrakenResponse(KRAKEN_PRICE) },
    ])
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchBtcPrice('kraken')
    expect(result.price).toBe(KRAKEN_PRICE)
    expect(result.source).toBe('kraken')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // Verify it hit Kraken URL first
    expect((fetchMock.mock.calls[0][0] as string)).toContain('kraken')
  })

  it('falls back to Binance when preferred Kraken source fails', async () => {
    vi.stubGlobal('fetch', mockFetch([
      { ok: false }, // Kraken fails
      { ok: true, body: makeBinanceResponse(BINANCE_PRICE) }, // Binance succeeds
    ]))

    const result = await fetchBtcPrice('kraken')
    expect(result.price).toBe(BINANCE_PRICE)
    expect(result.source).toBe('binance')
  })
})

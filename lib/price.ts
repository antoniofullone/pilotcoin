import type { PriceFetch, PriceSource } from './types'

const BINANCE_URL =
  'https://api.binance.com/api/v3/ticker/price?symbol=BTCUSDT'
const KRAKEN_URL =
  'https://api.kraken.com/0/public/Ticker?pair=XBTUSD'
const FETCH_TIMEOUT_MS = 5000

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, { signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

async function fetchFromBinance(): Promise<number> {
  const res = await fetchWithTimeout(BINANCE_URL)
  if (!res.ok) throw new Error(`Binance error: ${res.status}`)
  const data = await res.json()
  const price = parseFloat(data.price)
  if (!isFinite(price) || price <= 0) throw new Error('Binance returned invalid price')
  return price
}

async function fetchFromKraken(): Promise<number> {
  const res = await fetchWithTimeout(KRAKEN_URL)
  if (!res.ok) throw new Error(`Kraken error: ${res.status}`)
  const data = await res.json()
  const price = parseFloat(data.result?.XXBTZUSD?.c?.[0])
  if (!isFinite(price) || price <= 0) throw new Error('Kraken returned invalid price')
  return price
}

/**
 * Fetch the current BTC/USD price.
 *
 * preferredSource: if specified, tries that source first (used for resolution
 * to ensure the same data source is used for entry and exit prices).
 *
 * Throws if both sources fail.
 *
 *   Source fallback logic:
 *
 *   preferredSource=binance: Binance ──fail──> Kraken ──fail──> throw
 *   preferredSource=kraken:  Kraken ──fail──> Binance ──fail──> throw
 *   preferredSource=none:    Binance ──fail──> Kraken ──fail──> throw
 */
export async function fetchBtcPrice(
  preferredSource?: PriceSource
): Promise<PriceFetch> {
  const order: PriceSource[] =
    preferredSource === 'kraken'
      ? ['kraken', 'binance']
      : ['binance', 'kraken']

  const fetchers: Record<PriceSource, () => Promise<number>> = {
    binance: fetchFromBinance,
    kraken: fetchFromKraken,
  }

  let lastError: unknown

  for (const source of order) {
    try {
      const price = await fetchers[source]()
      return { price, source }
    } catch (err) {
      lastError = err
    }
  }

  throw new Error(
    `All price sources failed. Last error: ${lastError instanceof Error ? lastError.message : String(lastError)}`
  )
}

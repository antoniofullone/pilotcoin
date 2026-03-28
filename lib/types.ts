export type Direction = 'up' | 'down'
export type PriceSource = 'binance' | 'kraken'
export type Outcome = 'correct' | 'incorrect'

export interface ActiveGuess {
  direction: Direction
  priceAtGuess: number
  guessedAt: string // ISO 8601
  priceSource: PriceSource
}

export interface Player {
  playerId: string
  score: number
  createdAt: string // ISO 8601
  activeGuess: ActiveGuess | null
}

export interface ResolutionResult {
  outcome: Outcome
  pointsDelta: 1 | -1
  priceAtResolution: number
  guessedAt: string // ISO 8601 — used by client to deduplicate flash notifications
}

export interface PriceFetch {
  price: number
  source: PriceSource
}

export interface GameState {
  price: number | null
  priceSource: PriceSource | null
  score: number
  activeGuess: ActiveGuess | null
  lastResolution: ResolutionResult | null
}

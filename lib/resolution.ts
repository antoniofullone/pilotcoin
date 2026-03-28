import type { ActiveGuess, ResolutionResult } from './types'

const RESOLUTION_DELAY_MS = 60_000

/**
 * Pure resolution function. No side effects, no I/O.
 *
 * Returns null if the guess is not yet eligible:
 *   - less than 60 seconds have passed (time gate)
 *   - price hasn't moved from entry price (price gate)
 *
 * Returns a ResolutionResult if both gates are met.
 *
 * If the price hasn't moved, the guess stays pending until it does.
 * The UI explains this to the user via the countdown-ring component.
 */
export function resolveGuess(
  guess: ActiveGuess,
  currentPrice: number,
  now: Date = new Date()
): ResolutionResult | null {
  const elapsed = now.getTime() - new Date(guess.guessedAt).getTime()

  // Time gate: at least 60 seconds must have passed
  if (elapsed < RESOLUTION_DELAY_MS) return null

  // Price gate: price must have changed
  if (currentPrice === guess.priceAtGuess) return null

  const priceWentUp = currentPrice > guess.priceAtGuess
  const correct = guess.direction === 'up' ? priceWentUp : !priceWentUp

  return {
    outcome: correct ? 'correct' : 'incorrect',
    pointsDelta: correct ? 1 : -1,
    priceAtResolution: currentPrice,
    guessedAt: guess.guessedAt,
  }
}

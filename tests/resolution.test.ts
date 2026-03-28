import { describe, it, expect } from 'vitest'
import { resolveGuess } from '../lib/resolution'
import type { ActiveGuess } from '../lib/types'

function makeGuess(overrides: Partial<ActiveGuess> = {}): ActiveGuess {
  return {
    direction: 'up',
    priceAtGuess: 65000,
    guessedAt: new Date(Date.now() - 70_000).toISOString(), // 70s ago by default
    priceSource: 'binance',
    ...overrides,
  }
}

function makeNow(offsetMs = 0): Date {
  return new Date(Date.now() + offsetMs)
}

describe('resolveGuess', () => {
  describe('time gate', () => {
    it('returns null when less than 60 seconds have passed', () => {
      const guess = makeGuess({ guessedAt: new Date(Date.now() - 30_000).toISOString() })
      expect(resolveGuess(guess, 66000, makeNow())).toBeNull()
    })

    it('returns null when exactly 59999ms have passed', () => {
      const guess = makeGuess({ guessedAt: new Date(Date.now() - 59_999).toISOString() })
      expect(resolveGuess(guess, 66000, makeNow())).toBeNull()
    })

    it('resolves when exactly 60000ms have passed', () => {
      const guess = makeGuess({ guessedAt: new Date(Date.now() - 60_000).toISOString() })
      const result = resolveGuess(guess, 66000, makeNow())
      expect(result).not.toBeNull()
    })

    it('resolves when more than 60 seconds have passed', () => {
      const guess = makeGuess({ guessedAt: new Date(Date.now() - 90_000).toISOString() })
      const result = resolveGuess(guess, 66000, makeNow())
      expect(result).not.toBeNull()
    })
  })

  describe('price gate', () => {
    it('returns null when price has not changed', () => {
      const guess = makeGuess({ priceAtGuess: 65000 })
      expect(resolveGuess(guess, 65000, makeNow())).toBeNull()
    })

    it('stays pending when price unchanged even after a long time', () => {
      const guess = makeGuess({
        priceAtGuess: 65000,
        guessedAt: new Date(Date.now() - 300_000).toISOString(), // 5 min ago
      })
      expect(resolveGuess(guess, 65000, makeNow())).toBeNull()
    })

    it('resolves when price has moved up', () => {
      const guess = makeGuess({ priceAtGuess: 65000 })
      expect(resolveGuess(guess, 65001, makeNow())).not.toBeNull()
    })

    it('resolves when price has moved down', () => {
      const guess = makeGuess({ priceAtGuess: 65000 })
      expect(resolveGuess(guess, 64999, makeNow())).not.toBeNull()
    })
  })

  describe('outcome determination', () => {
    it('guess UP + price went up → correct (+1)', () => {
      const guess = makeGuess({ direction: 'up', priceAtGuess: 65000 })
      const result = resolveGuess(guess, 65100, makeNow())
      expect(result?.outcome).toBe('correct')
      expect(result?.pointsDelta).toBe(1)
    })

    it('guess UP + price went down → incorrect (-1)', () => {
      const guess = makeGuess({ direction: 'up', priceAtGuess: 65000 })
      const result = resolveGuess(guess, 64900, makeNow())
      expect(result?.outcome).toBe('incorrect')
      expect(result?.pointsDelta).toBe(-1)
    })

    it('guess DOWN + price went down → correct (+1)', () => {
      const guess = makeGuess({ direction: 'down', priceAtGuess: 65000 })
      const result = resolveGuess(guess, 64900, makeNow())
      expect(result?.outcome).toBe('correct')
      expect(result?.pointsDelta).toBe(1)
    })

    it('guess DOWN + price went up → incorrect (-1)', () => {
      const guess = makeGuess({ direction: 'down', priceAtGuess: 65000 })
      const result = resolveGuess(guess, 65100, makeNow())
      expect(result?.outcome).toBe('incorrect')
      expect(result?.pointsDelta).toBe(-1)
    })

    it('includes priceAtResolution in the result', () => {
      const guess = makeGuess({ direction: 'up', priceAtGuess: 65000 })
      const result = resolveGuess(guess, 65500, makeNow())
      expect(result?.priceAtResolution).toBe(65500)
    })

    it('includes guessedAt in the result for client deduplication', () => {
      const guessedAt = new Date(Date.now() - 70_000).toISOString()
      const guess = makeGuess({ direction: 'up', priceAtGuess: 65000, guessedAt })
      const result = resolveGuess(guess, 65500, makeNow())
      expect(result?.guessedAt).toBe(guessedAt)
    })
  })
})

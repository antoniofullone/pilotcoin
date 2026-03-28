import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// Mock the db and price modules before importing the route handlers
vi.mock('../lib/db', () => ({
  getOrCreatePlayer: vi.fn(),
  submitGuess: vi.fn(),
  resolveAndUpdateScore: vi.fn(),
}))

vi.mock('../lib/price', () => ({
  fetchBtcPrice: vi.fn(),
}))

vi.mock('../lib/resolution', () => ({
  resolveGuess: vi.fn(),
}))

import { GET as stateGET } from '../app/api/state/route'
import { POST as guessPost } from '../app/api/guess/route'
import * as db from '../lib/db'
import * as price from '../lib/price'
import * as resolution from '../lib/resolution'
import type { Player } from '../lib/types'

const PLAYER_ID = 'test-player-uuid'

function makePlayer(overrides: Partial<Player> = {}): Player {
  return {
    playerId: PLAYER_ID,
    score: 0,
    createdAt: new Date().toISOString(),
    activeGuess: null,
    ...overrides,
  }
}

function makeRequest(method: string, headers: Record<string, string> = {}, body?: unknown) {
  return new NextRequest('http://localhost/api/state', {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body ? JSON.stringify(body) : undefined,
  })
}

beforeEach(() => {
  vi.resetAllMocks()
})

// ─────────────────────────────────────────────────────────
// GET /api/state
// ─────────────────────────────────────────────────────────

describe('GET /api/state', () => {
  it('returns score and null price gracefully when price fetch fails', async () => {
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer({ score: 5 }))
    vi.mocked(price.fetchBtcPrice).mockRejectedValue(new Error('feed down'))

    const res = await stateGET(makeRequest('GET', { 'x-player-id': PLAYER_ID }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.score).toBe(5)
    expect(body.price).toBeNull()
    expect(body.activeGuess).toBeNull()
  })

  it('creates a new player when no x-player-id is provided', async () => {
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer())
    vi.mocked(price.fetchBtcPrice).mockResolvedValue({ price: 65000, source: 'binance' })

    const res = await stateGET(makeRequest('GET'))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.score).toBe(0)
    // A new UUID was generated and echoed back
    expect(res.headers.get('x-player-id')).toBeTruthy()
  })

  it('resolves an eligible active guess inline', async () => {
    const activeGuess = {
      direction: 'up' as const,
      priceAtGuess: 65000,
      guessedAt: new Date(Date.now() - 70_000).toISOString(),
      priceSource: 'binance' as const,
    }
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer({ score: 2, activeGuess }))
    vi.mocked(price.fetchBtcPrice).mockResolvedValue({ price: 66000, source: 'binance' })
    vi.mocked(resolution.resolveGuess).mockReturnValue({
      outcome: 'correct',
      pointsDelta: 1,
      priceAtResolution: 66000,
    })
    vi.mocked(db.resolveAndUpdateScore).mockResolvedValue(undefined)

    const res = await stateGET(makeRequest('GET', { 'x-player-id': PLAYER_ID }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.score).toBe(3)
    expect(body.activeGuess).toBeNull()
    expect(body.lastResolution?.outcome).toBe('correct')
    expect(db.resolveAndUpdateScore).toHaveBeenCalledWith(PLAYER_ID, 1)
  })

  it('does not attempt resolution when no active guess', async () => {
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer())
    vi.mocked(price.fetchBtcPrice).mockResolvedValue({ price: 65000, source: 'binance' })

    await stateGET(makeRequest('GET', { 'x-player-id': PLAYER_ID }))

    expect(resolution.resolveGuess).not.toHaveBeenCalled()
  })

  it('returns a helpful error when the player table is missing', async () => {
    const error = new Error('Requested resource not found')
    error.name = 'ResourceNotFoundException'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db.getOrCreatePlayer).mockRejectedValue(error)
    vi.mocked(price.fetchBtcPrice).mockResolvedValue({ price: 65000, source: 'binance' })

    const res = await stateGET(makeRequest('GET', { 'x-player-id': PLAYER_ID }))
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('Service unavailable — please try again later.')
    consoleSpy.mockRestore()
  })
})

// ─────────────────────────────────────────────────────────
// POST /api/guess
// ─────────────────────────────────────────────────────────

describe('POST /api/guess', () => {
  it('creates a guess and returns 201', async () => {
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer())
    vi.mocked(price.fetchBtcPrice).mockResolvedValue({ price: 65000, source: 'binance' })
    vi.mocked(db.submitGuess).mockResolvedValue(undefined)

    const res = await guessPost(
      makeRequest('POST', { 'x-player-id': PLAYER_ID }, { direction: 'up' })
    )
    const body = await res.json()

    expect(res.status).toBe(201)
    expect(body.guess.direction).toBe('up')
    expect(body.guess.priceAtGuess).toBe(65000)
    expect(body.guess.priceSource).toBe('binance')
  })

  it('returns 409 when a guess is already pending', async () => {
    const activeGuess = {
      direction: 'up' as const,
      priceAtGuess: 65000,
      guessedAt: new Date().toISOString(),
      priceSource: 'binance' as const,
    }
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer({ activeGuess }))

    const res = await guessPost(
      makeRequest('POST', { 'x-player-id': PLAYER_ID }, { direction: 'down' })
    )

    expect(res.status).toBe(409)
  })

  it('returns 400 when direction is missing', async () => {
    const res = await guessPost(
      makeRequest('POST', { 'x-player-id': PLAYER_ID }, { direction: 'sideways' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 400 when x-player-id header is missing', async () => {
    const res = await guessPost(
      makeRequest('POST', {}, { direction: 'up' })
    )
    expect(res.status).toBe(400)
  })

  it('returns 503 when price feed is unavailable', async () => {
    vi.mocked(db.getOrCreatePlayer).mockResolvedValue(makePlayer())
    vi.mocked(price.fetchBtcPrice).mockRejectedValue(new Error('feed down'))

    const res = await guessPost(
      makeRequest('POST', { 'x-player-id': PLAYER_ID }, { direction: 'up' })
    )
    expect(res.status).toBe(503)
  })

  it('returns a helpful infra error when the player table is missing', async () => {
    const error = new Error('Requested resource not found')
    error.name = 'ResourceNotFoundException'
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    vi.mocked(db.getOrCreatePlayer).mockRejectedValue(error)

    const res = await guessPost(
      makeRequest('POST', { 'x-player-id': PLAYER_ID }, { direction: 'up' })
    )
    const body = await res.json()

    expect(res.status).toBe(500)
    expect(body.error).toBe('Service unavailable — please try again later.')
    consoleSpy.mockRestore()
  })
})

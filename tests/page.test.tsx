import { render, screen, waitFor, fireEvent, act } from '@testing-library/react'
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import Home from '../app/page'
import type { ActiveGuess, ResolutionResult } from '../lib/types'

// ─────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────

function makeStateBody(overrides: Record<string, unknown> = {}) {
  return {
    playerId: 'test-player',
    price: 65000,
    priceSource: 'binance',
    score: 0,
    activeGuess: null,
    lastResolution: null,
    ...overrides,
  }
}

function makeActiveGuess(overrides: Partial<ActiveGuess> = {}): ActiveGuess {
  return {
    direction: 'up',
    priceAtGuess: 65000,
    guessedAt: new Date(Date.now() - 30_000).toISOString(),
    priceSource: 'binance',
    ...overrides,
  }
}

function makeResolution(
  guessedAt: string,
  outcome: 'correct' | 'incorrect' = 'correct'
): ResolutionResult {
  return {
    outcome,
    pointsDelta: outcome === 'correct' ? 1 : -1,
    priceAtResolution: 66000,
    guessedAt,
  }
}

function makeFetchResponse(body: object, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { get: (_key: string) => 'test-player' },
  }
}

/**
 * Stub global.fetch with a sequence of responses (matched in call order).
 * Returns the mock function so callers can inspect `.mock.calls`.
 */
function stubFetch(responses: Array<{ body: object; status?: number }>) {
  let idx = 0
  const mockFn = vi.fn().mockImplementation(() => {
    const r = responses[Math.min(idx++, responses.length - 1)]
    return Promise.resolve(makeFetchResponse(r.body, r.status ?? 200))
  })
  vi.stubGlobal('fetch', mockFn)
  return mockFn
}

// ─────────────────────────────────────────────────────────
// Setup
// ─────────────────────────────────────────────────────────

beforeEach(() => {
  localStorage.setItem('btc-player-id', 'test-player')
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  localStorage.clear()
})

// ─────────────────────────────────────────────────────────
// Home — rendering states
// ─────────────────────────────────────────────────────────

describe('Home', () => {
  it('shows shimmer skeletons before initial fetch resolves', () => {
    vi.stubGlobal('fetch', vi.fn().mockReturnValue(new Promise(() => {})))

    render(<Home />)

    expect(document.querySelectorAll('.shimmer').length).toBeGreaterThan(0)
    expect(screen.queryByText(/\$65,000/)).not.toBeInTheDocument()
  })

  it('displays BTC price and enables buttons after state loads', async () => {
    stubFetch([{ body: makeStateBody() }])

    render(<Home />)

    await waitFor(() => expect(screen.getByText('$65,000.00')).toBeInTheDocument())
    expect(screen.getByLabelText(/guess bitcoin price will go up$/i)).not.toBeDisabled()
    expect(screen.getByLabelText(/guess bitcoin price will go down$/i)).not.toBeDisabled()
  })

  it('sends POST /api/guess with direction: up when ▲ Up clicked', async () => {
    const fetchMock = stubFetch([
      { body: makeStateBody() },
      { body: {}, status: 201 },
      { body: makeStateBody() },
    ])

    render(<Home />)
    await waitFor(() => screen.getByLabelText(/guess bitcoin price will go up$/i))

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/guess bitcoin price will go up$/i))
    })

    await waitFor(() => {
      const guessCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === 'string' && (url as string).includes('guess')
      )
      expect(guessCalls).toHaveLength(1)
      const body = JSON.parse((guessCalls[0][1] as RequestInit).body as string)
      expect(body.direction).toBe('up')
    })
  })

  it('sends POST /api/guess with direction: down when ▼ Down clicked', async () => {
    const fetchMock = stubFetch([
      { body: makeStateBody() },
      { body: {}, status: 201 },
      { body: makeStateBody() },
    ])

    render(<Home />)
    await waitFor(() => screen.getByLabelText(/guess bitcoin price will go down$/i))

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/guess bitcoin price will go down$/i))
    })

    await waitFor(() => {
      const guessCalls = fetchMock.mock.calls.filter(
        ([url]) => typeof url === 'string' && (url as string).includes('guess')
      )
      const body = JSON.parse((guessCalls[0][1] as RequestInit).body as string)
      expect(body.direction).toBe('down')
    })
  })

  it('shows pending state after 409 — guess was already registered', async () => {
    // After a 409, the component re-fetches state and shows the countdown ring
    stubFetch([
      { body: makeStateBody() },
      { body: { error: 'conflict' }, status: 409 },
      { body: makeStateBody({ activeGuess: makeActiveGuess() }) },
    ])

    render(<Home />)
    await waitFor(() => screen.getByLabelText(/guess bitcoin price will go up$/i))

    await act(async () => {
      fireEvent.click(screen.getByLabelText(/guess bitcoin price will go up$/i))
    })

    await waitFor(() => {
      expect(
        screen.getByLabelText(/seconds remaining until guess resolves/i)
      ).toBeInTheDocument()
    })
  })

  it('shows countdown ring and disables buttons when activeGuess exists', async () => {
    stubFetch([{ body: makeStateBody({ activeGuess: makeActiveGuess() }) }])

    render(<Home />)

    await waitFor(() => {
      expect(
        screen.getByLabelText(/seconds remaining until guess resolves/i)
      ).toBeInTheDocument()
    })
    expect(
      screen.getByLabelText(/guess bitcoin price will go up — waiting for result/i)
    ).toBeDisabled()
    expect(
      screen.getByLabelText(/guess bitcoin price will go down — waiting for result/i)
    ).toBeDisabled()
  })

  it('shows "+1 ✔" flash banner for a correct resolution', async () => {
    const guessedAt = new Date(Date.now() - 70_000).toISOString()
    stubFetch([
      { body: makeStateBody({ score: 1, lastResolution: makeResolution(guessedAt, 'correct') }) },
    ])

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('+1 ✔')
    })
    expect(screen.getByLabelText(/score: 1/i)).toBeInTheDocument()
  })

  it('shows "-1 ✗" flash banner for an incorrect resolution', async () => {
    const guessedAt = new Date(Date.now() - 70_000).toISOString()
    stubFetch([
      { body: makeStateBody({ score: -1, lastResolution: makeResolution(guessedAt, 'incorrect') }) },
    ])

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('-1 ✗')
    })
  })

  it('flash only appears once even when the same guessedAt is returned twice', async () => {
    const guessedAt = new Date(Date.now() - 70_000).toISOString()
    const resolution = makeResolution(guessedAt, 'correct')

    // Return the same resolution on every poll. The dedup ref ensures flash
    // is only triggered once regardless of how many times the same guessedAt arrives.
    stubFetch([
      { body: makeStateBody({ score: 1, lastResolution: resolution }) },
      { body: makeStateBody({ score: 1, lastResolution: resolution }) },
    ])

    render(<Home />)

    // Wait until the flash appears — dedup allows exactly one flash panel
    await waitFor(() => {
      const flashPanels = screen.queryAllByRole('status').filter(el =>
        el.textContent?.includes('+1')
      )
      expect(flashPanels).toHaveLength(1)
    })

    // Immediately assert: still exactly one — a second flash was never created.
    // (The flash auto-dismisses after 4s; we assert before that window closes.)
    const flashPanels = screen.queryAllByRole('status').filter(el =>
      el.textContent?.includes('+1')
    )
    expect(flashPanels).toHaveLength(1)
  })

  it('shows error banner when fetch throws a network error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')))

    render(<Home />)

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Failed to fetch')
    })
  })
})

// ─────────────────────────────────────────────────────────
// CountdownRing — tested through Home's pending state
// ─────────────────────────────────────────────────────────

describe('CountdownRing (via Home pending state)', () => {
  it('displays remaining seconds derived from guessedAt', async () => {
    const guessedAt = new Date(Date.now() - 30_000).toISOString()
    stubFetch([{ body: makeStateBody({ activeGuess: makeActiveGuess({ guessedAt }) }) }])

    render(<Home />)

    await waitFor(() => {
      const ring = screen.getByLabelText(/seconds remaining until guess resolves/i)
      // Parse seconds from the aria-label e.g. "30 seconds remaining until guess resolves"
      const label = ring.getAttribute('aria-label') ?? ''
      const seconds = parseInt(label, 10)
      expect(seconds).toBeGreaterThanOrEqual(28)
      expect(seconds).toBeLessThanOrEqual(32)
    })
  })

  it('triggers fetchState when countdown reaches 0', async () => {
    vi.useFakeTimers()

    // guessedAt 60s ago → countdown immediately at 0
    const guessedAt = new Date(Date.now() - 60_000).toISOString()
    const fetchMock = stubFetch([
      { body: makeStateBody({ activeGuess: makeActiveGuess({ guessedAt }) }) }, // initial
      { body: makeStateBody() }, // triggered by onExpired
    ])

    render(<Home />)

    await act(async () => { await Promise.resolve() })
    await act(async () => {
      vi.advanceTimersByTime(1100) // trigger setInterval tick in CountdownRing
      await Promise.resolve()
    })

    const stateCalls = fetchMock.mock.calls.filter(
      ([url]) => typeof url === 'string' && (url as string).includes('state')
    )
    expect(stateCalls.length).toBeGreaterThanOrEqual(2)

    vi.useRealTimers()
  })
})

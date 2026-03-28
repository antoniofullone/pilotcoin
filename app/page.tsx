'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { GameState, Direction } from '@/lib/types'

const POLL_INTERVAL_MS = 5000

type ErrorResponse = { error?: string }
type FlashState = {
  outcome: 'correct' | 'incorrect'
  delta: number
  priceAtGuess: number
  priceAtResolution: number
  streak: number
  exiting: boolean
}

function streakMessage(streak: number): string {
  if (streak === 2) return 'Two in a row!'
  if (streak === 3) return 'On fire! 🔥'
  if (streak === 4) return 'Four straight! 🔥'
  if (streak >= 5) return 'Unstoppable! ⚡'
  return 'Nice call!'
}

function wrongMessage(prevStreak: number): string {
  if (prevStreak >= 3) return 'Streak broken.'
  if (prevStreak === 2) return 'So close.'
  return 'Next time.'
}

function getOrCreatePlayerId(): string {
  if (typeof window === 'undefined') return ''
  try {
    const stored = localStorage.getItem('btc-player-id')
    if (stored) return stored
    const id = crypto.randomUUID()
    localStorage.setItem('btc-player-id', id)
    return id
  } catch {
    return crypto.randomUUID()
  }
}

function formatPrice(price: number | null): string {
  if (price === null) return '—'
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

function formatDelta(from: number, to: number): string {
  const diff = to - from
  const sign = diff >= 0 ? '+' : ''
  return `${sign}${formatPrice(diff)}`
}

// SVG countdown ring
function CountdownRing({
  guessedAt,
  onExpired,
}: {
  guessedAt: string
  onExpired: () => void
}) {
  const [remaining, setRemaining] = useState(60)
  const firedRef = useRef(false)

  useEffect(() => {
    firedRef.current = false
    const start = new Date(guessedAt).getTime()
    const update = () => {
      const elapsed = Math.floor((Date.now() - start) / 1000)
      const rem = Math.max(0, 60 - elapsed)
      setRemaining(rem)
      if (rem === 0 && !firedRef.current) {
        firedRef.current = true
        onExpired()
      }
    }
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [guessedAt, onExpired])

  const radius = 28
  const circumference = 2 * Math.PI * radius
  const progress = remaining / 60
  const strokeDashoffset = circumference * (1 - progress)

  const isResolving = remaining === 0

  return (
    <div className="flex flex-col items-center gap-2">
      <div className="relative w-16 h-16" aria-label={`${remaining} seconds remaining until guess resolves`}>
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          {/* Track */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke="var(--bg-elevated)"
            strokeWidth="4"
          />
          {/* Progress */}
          <circle
            cx="32" cy="32" r={radius}
            fill="none"
            stroke={remaining > 10 ? 'var(--color-up)' : 'var(--color-warn)'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{ transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s ease' }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {isResolving ? (
            <span className="text-[10px] text-[var(--text-muted)] font-mono animate-pulse">…</span>
          ) : (
            <span className="text-sm font-mono font-bold tabular-nums text-[var(--text-primary)]">
              {remaining}
            </span>
          )}
        </div>
      </div>
      <p className="text-xs text-[var(--text-muted)]">
        {isResolving ? 'resolving…' : 'seconds left'}
      </p>
    </div>
  )
}

// Loading shimmer skeleton
function Skeleton({ className }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className ?? ''}`} />
}

export default function Home() {
  const [state, setState] = useState<GameState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [lockedIn, setLockedIn] = useState<Direction | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<FlashState | null>(null)
  const [scoreAnimation, setScoreAnimation] = useState<'pulse-up' | 'shake' | null>(null)
  const [streak, setStreak] = useState(0)
  const playerIdRef = useRef<string>('')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mountedRef = useRef(true)
  // Track last seen resolution by guessedAt timestamp to avoid re-triggering on every poll
  const lastResolutionGuessedAtRef = useRef<string | null>(null)
  // Capture priceAtGuess before activeGuess is cleared on resolution
  const lastActiveGuessPriceRef = useRef<number | null>(null)

  const fetchState = useCallback(async () => {
    const playerId = playerIdRef.current
    if (!playerId) return

    try {
      const res = await fetch('/api/state', {
        headers: { 'x-player-id': playerId },
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ErrorResponse | null
        throw new Error(body?.error ?? `State fetch failed: ${res.status}`)
      }
      const data = await res.json() as GameState

      if (!mountedRef.current) return

      const echoedId = res.headers.get('x-player-id')
      if (echoedId && echoedId !== playerId) {
        try { localStorage.setItem('btc-player-id', echoedId) } catch { /* ignore */ }
        playerIdRef.current = echoedId
      }

      // Capture entry price while activeGuess is still present
      if (data.activeGuess) {
        lastActiveGuessPriceRef.current = data.activeGuess.priceAtGuess
      }

      // Only trigger flash once per unique resolution (deduplicated by guessedAt timestamp)
      if (
        data.lastResolution &&
        data.lastResolution.guessedAt !== lastResolutionGuessedAtRef.current
      ) {
        lastResolutionGuessedAtRef.current = data.lastResolution.guessedAt
        const isCorrect = data.lastResolution.outcome === 'correct'
        setStreak(prev => {
          const next = isCorrect ? prev + 1 : 0
          setFlash({
            outcome: data.lastResolution!.outcome,
            delta: data.lastResolution!.pointsDelta,
            priceAtGuess: lastActiveGuessPriceRef.current ?? data.lastResolution!.priceAtResolution,
            priceAtResolution: data.lastResolution!.priceAtResolution,
            streak: isCorrect ? next : prev,
            exiting: false,
          })
          return next
        })
        setScoreAnimation(isCorrect ? 'pulse-up' : 'shake')
        setTimeout(() => {
          setFlash(f => f ? { ...f, exiting: true } : null)
          setTimeout(() => setFlash(null), 300)
        }, 4000)
        setTimeout(() => setScoreAnimation(null), 700)
      }

      setState(data)
      setError(null)
    } catch (err) {
      if (!mountedRef.current) return
      setError(
        err instanceof Error ? err.message : 'Connection error — retrying…'
      )
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    playerIdRef.current = getOrCreatePlayerId()
    if (!playerIdRef.current) {
      setError('Storage unavailable — your score won\'t persist.')
    }
    fetchState()

    const schedule = () => {
      pollRef.current = setTimeout(async () => {
        await fetchState()
        schedule()
      }, POLL_INTERVAL_MS)
    }
    schedule()

    return () => {
      mountedRef.current = false
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [fetchState])

  const handleGuess = async (direction: Direction) => {
    if (submitting || state?.activeGuess) return
    setSubmitting(true)
    setLockedIn(direction)
    setError(null)
    try {
      const res = await fetch('/api/guess', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-player-id': playerIdRef.current,
        },
        body: JSON.stringify({ direction }),
      })
      if (res.status === 409) {
        setError('A guess is already pending.')
        await fetchState()
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setError((body as { error?: string }).error ?? 'Failed to submit — try again.')
        return
      }
      await fetchState()
    } finally {
      setSubmitting(false)
      setTimeout(() => setLockedIn(null), 500)
    }
  }

  const handleCountdownExpired = useCallback(() => {
    fetchState()
  }, [fetchState])

  const isPending = !!state?.activeGuess
  const priceUnavailable = state !== null && state.price === null
  const canGuess = !isPending && !submitting && state !== null && !priceUnavailable
  const isLoading = state === null && !error

  return (
    <main className="min-h-screen flex flex-col items-stretch p-4 sm:p-8">
      <div className="w-full max-w-md mx-auto flex flex-col flex-1 gap-0">

        {/* Zone 1: Top Rail */}
        <header className="flex items-center justify-between py-4 border-b border-[var(--bg-elevated)]">
          <div className="flex items-center gap-2">
            <span className="text-xs uppercase tracking-widest font-bold text-[var(--text-muted)]">
              Pilotcoin
            </span>
            {streak >= 2 && (
              <span className="text-xs font-bold px-1.5 py-0.5 rounded-md bg-emerald-500/15 text-emerald-400 border border-emerald-500/30">
                {streak} streak
              </span>
            )}
          </div>
          <div
            aria-live="polite"
            aria-label={`Score: ${state?.score ?? 0}`}
            className="flex items-center gap-1.5"
          >
            <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest">Score</span>
            {isLoading ? (
              <Skeleton className="w-8 h-5" />
            ) : (
              <span
                key={state?.score}
                className={`text-base font-bold font-mono tabular-nums text-[var(--text-primary)] ${
                  scoreAnimation === 'pulse-up' ? 'animate-pulse-up' :
                  scoreAnimation === 'shake' ? 'animate-shake' : ''
                }`}
              >
                {state?.score ?? 0}
              </span>
            )}
          </div>
        </header>

        {/* Zone 2: Center Stage */}
        <section className="flex-1 flex flex-col items-center justify-center gap-8 py-10">

          {/* BTC Price — hero element */}
          <div className="text-center space-y-1">
            {isLoading ? (
              <>
                <Skeleton className="w-48 h-12 mx-auto" />
                <Skeleton className="w-24 h-4 mx-auto mt-2" />
              </>
            ) : (
              <>
                <div className="flex items-center justify-center gap-2">
                  <p className="text-4xl sm:text-5xl font-bold font-mono tabular-nums text-[var(--text-primary)]">
                    {formatPrice(state?.price ?? null)}
                  </p>
                  {priceUnavailable && (
                    <span className="w-2 h-2 rounded-full bg-[var(--color-warn)] animate-pulse-dot" />
                  )}
                </div>
                <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
                  BTC / USD{state?.priceSource ? ` · ${state.priceSource}` : ''}
                </p>
                {priceUnavailable && (
                  <p className="text-xs text-[var(--color-warn)] mt-1">Price feed unavailable</p>
                )}
              </>
            )}
          </div>

          {/* Action prompt */}
          {!isLoading && !isPending && (
            <p className="text-sm text-[var(--text-secondary)] text-center px-4">
              Will it go up or down in the next 60 seconds?
            </p>
          )}

          {/* Guess buttons */}
          {isLoading ? (
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Skeleton className="w-full sm:w-40 h-20" />
              <Skeleton className="w-full sm:w-40 h-20" />
            </div>
          ) : isPending ? (
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              {(['up', 'down'] as Direction[]).map((dir) => (
                <button
                  key={dir}
                  disabled
                  className="w-full sm:w-40 min-h-[80px] rounded-xl text-lg font-bold opacity-25 cursor-not-allowed bg-[var(--bg-surface)] text-[var(--text-muted)]"
                  aria-label={`Guess Bitcoin price will go ${dir} — waiting for result`}
                >
                  {dir === 'up' ? '▲ Up' : '▼ Down'}
                </button>
              ))}
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              {(['up', 'down'] as Direction[]).map((dir) => {
                const isLocking = lockedIn === dir
                return (
                  <button
                    key={dir}
                    onClick={() => handleGuess(dir)}
                    disabled={!canGuess}
                    aria-label={`Guess Bitcoin price will go ${dir}`}
                    className={`
                      w-full sm:w-40 min-h-[80px] rounded-xl text-lg font-bold
                      transition-all duration-150
                      active:scale-95
                      focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                      disabled:opacity-40 disabled:cursor-not-allowed
                      ${dir === 'up'
                        ? 'bg-emerald-600 hover:bg-emerald-500 hover:shadow-lg hover:shadow-emerald-500/20'
                        : 'bg-red-600 hover:bg-red-500 hover:shadow-lg hover:shadow-red-500/20'
                      }
                      ${isLocking ? 'scale-95 opacity-80' : ''}
                    `}
                  >
                    {isLocking ? '✓ Locked in' : dir === 'up' ? '▲ Up' : '▼ Down'}
                  </button>
                )
              })}
            </div>
          )}

          {/* Price unavailable button overlay copy */}
          {priceUnavailable && !isPending && !isLoading && (
            <p className="text-xs text-[var(--color-warn)] text-center">
              Waiting for price feed to place a guess…
            </p>
          )}

        </section>

        {/* Zone 3: Feedback Strip */}
        <footer className="border-t border-[var(--bg-elevated)] pt-4 pb-2 min-h-[120px] flex flex-col items-center justify-center gap-3">

          {/* Resolution flash — inline, not a fixed toast */}
          {flash && (
            <div
              role="status"
              aria-live="polite"
              className={`
                w-full rounded-xl px-5 py-4 text-center
                ${flash.exiting ? 'animate-fade-out' : 'animate-fade-in'}
                ${flash.outcome === 'correct'
                  ? 'bg-emerald-500/20 border border-emerald-500/50'
                  : 'bg-red-500/20 border border-red-500/50'
                }
              `}
            >
              <p className={`text-2xl font-bold mb-0.5 ${
                flash.outcome === 'correct' ? 'text-emerald-400' : 'text-red-400'
              }`}>
                {flash.outcome === 'correct' ? `+${flash.delta} ✔` : `${flash.delta} ✗`}
              </p>
              <p className={`text-sm font-medium mb-2 ${
                flash.outcome === 'correct' ? 'text-emerald-300' : 'text-red-300'
              }`}>
                {flash.outcome === 'correct'
                  ? streakMessage(flash.streak)
                  : wrongMessage(flash.streak)}
              </p>
              <p className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">
                {formatPrice(flash.priceAtGuess)} → {formatPrice(flash.priceAtResolution)}{' '}
                <span className={flash.outcome === 'correct' ? 'text-emerald-500' : 'text-red-500'}>
                  ({formatDelta(flash.priceAtGuess, flash.priceAtResolution)})
                </span>
              </p>
            </div>
          )}

          {/* Pending guess with countdown ring */}
          {isPending && state.activeGuess && (
            <div className="flex flex-col items-center gap-3 w-full">
              <CountdownRing
                guessedAt={state.activeGuess.guessedAt}
                onExpired={handleCountdownExpired}
              />
              <p className="text-sm text-[var(--text-secondary)] text-center">
                Guessed{' '}
                <span className={`font-bold font-mono ${
                  state.activeGuess.direction === 'up'
                    ? 'text-emerald-400'
                    : 'text-red-400'
                }`}>
                  {state.activeGuess.direction === 'up' ? '▲ up' : '▼ down'}
                </span>
                {' '}from{' '}
                <span className="font-mono tabular-nums">{formatPrice(state.activeGuess.priceAtGuess)}</span>
              </p>
            </div>
          )}

          {/* Error */}
          {error && (
            <p
              role="status"
              aria-live="polite"
              className="text-sm text-[var(--color-warn)] text-center"
            >
              {error}
            </p>
          )}

          {/* Idle state — no pending, no flash, no error */}
          {!isPending && !flash && !error && !isLoading && (
            <p className="text-xs text-[var(--text-muted)] text-center">
              Your score is saved across sessions.
            </p>
          )}

        </footer>
      </div>
    </main>
  )
}

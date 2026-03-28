'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { GameState, Direction } from '@/lib/types'
import { GameActionPanel } from './components/game-action-panel'
import { GameFeedbackStrip } from './components/game-feedback-strip'
import { GameHeader } from './components/game-header'
import { type FlashState } from './components/game-helpers'

const POLL_INTERVAL_MS = 5000

type ErrorResponse = { error?: string }

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
    } catch {
      setError('Connection lost — please try again.')
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
        <GameHeader
          isLoading={isLoading}
          score={state?.score ?? 0}
          streak={streak}
          scoreAnimation={scoreAnimation}
        />
        <GameActionPanel
          isLoading={isLoading}
          isPending={isPending}
          price={state?.price ?? null}
          priceSource={state?.priceSource ?? null}
          priceUnavailable={priceUnavailable}
          lockedIn={lockedIn}
          canGuess={canGuess}
          onGuess={handleGuess}
        />
        <GameFeedbackStrip
          flash={flash}
          isPending={isPending}
          activeGuess={state?.activeGuess ?? null}
          error={error}
          isLoading={isLoading}
          onCountdownExpired={handleCountdownExpired}
        />
      </div>
    </main>
  )
}

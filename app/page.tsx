'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import type { GameState, Direction } from '@/lib/types'

const POLL_INTERVAL_MS = 5000

function getOrCreatePlayerId(): string {
  if (typeof window === 'undefined') return ''
  const stored = localStorage.getItem('btc-player-id')
  if (stored) return stored
  const id = crypto.randomUUID()
  localStorage.setItem('btc-player-id', id)
  return id
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

function ElapsedTimer({ guessedAt }: { guessedAt: string }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    const start = new Date(guessedAt).getTime()
    const update = () => setElapsed(Math.floor((Date.now() - start) / 1000))
    update()
    const id = setInterval(update, 1000)
    return () => clearInterval(id)
  }, [guessedAt])

  const remaining = Math.max(0, 60 - elapsed)
  return (
    <span className="tabular-nums">
      {remaining > 0 ? `${remaining}s until eligible` : 'resolving…'}
    </span>
  )
}

export default function Home() {
  const [state, setState] = useState<GameState | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [flash, setFlash] = useState<{ outcome: 'correct' | 'incorrect'; delta: number } | null>(null)
  const playerIdRef = useRef<string>('')
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchState = useCallback(async () => {
    const playerId = playerIdRef.current
    if (!playerId) return

    try {
      const res = await fetch('/api/state', {
        headers: { 'x-player-id': playerId },
      })
      if (!res.ok) throw new Error(`State fetch failed: ${res.status}`)
      const data = await res.json()

      // Persist server-echoed player ID (for new players without a stored ID)
      const echoedId = res.headers.get('x-player-id')
      if (echoedId && echoedId !== playerId) {
        localStorage.setItem('btc-player-id', echoedId)
        playerIdRef.current = echoedId
      }

      if (data.lastResolution) {
        setFlash({ outcome: data.lastResolution.outcome, delta: data.lastResolution.pointsDelta })
        setTimeout(() => setFlash(null), 3000)
      }

      setState(data)
      setError(null)
    } catch {
      setError('Connection error — retrying…')
    }
  }, [])

  // Bootstrap player ID and start polling
  useEffect(() => {
    playerIdRef.current = getOrCreatePlayerId()
    fetchState()

    const schedule = () => {
      pollRef.current = setTimeout(async () => {
        await fetchState()
        schedule()
      }, POLL_INTERVAL_MS)
    }
    schedule()

    return () => {
      if (pollRef.current) clearTimeout(pollRef.current)
    }
  }, [fetchState])

  const handleGuess = async (direction: Direction) => {
    if (submitting || state?.activeGuess) return
    setSubmitting(true)
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
        setError((body as { error?: string }).error ?? 'Failed to submit guess.')
        return
      }
      await fetchState()
    } finally {
      setSubmitting(false)
    }
  }

  const isPending = !!state?.activeGuess
  const canGuess = !isPending && !submitting && state !== null

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 flex flex-col items-center justify-center gap-8 p-8 font-[family-name:var(--font-geist-mono)]">
      {/* Flash notification */}
      {flash && (
        <div
          className={`fixed top-6 left-1/2 -translate-x-1/2 px-6 py-3 rounded-lg text-sm font-bold ${
            flash.outcome === 'correct'
              ? 'bg-emerald-500 text-white'
              : 'bg-red-500 text-white'
          }`}
        >
          {flash.outcome === 'correct' ? `+${flash.delta} point` : `${flash.delta} point`}
          {' '}— {flash.outcome}!
        </div>
      )}

      {/* Score */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">Score</p>
        <p className="text-6xl font-bold tabular-nums">
          {state?.score ?? '—'}
        </p>
      </div>

      {/* BTC Price */}
      <div className="text-center">
        <p className="text-xs uppercase tracking-widest text-zinc-500 mb-1">
          BTC / USD {state?.priceSource ? `· ${state.priceSource}` : ''}
        </p>
        <p className="text-3xl font-semibold tabular-nums">
          {state ? formatPrice(state.price) : '…'}
        </p>
        {state?.price === null && state !== null && (
          <p className="text-xs text-amber-400 mt-1">Price feed unavailable</p>
        )}
      </div>

      {/* Guess buttons */}
      <div className="flex gap-4">
        {(['up', 'down'] as Direction[]).map((dir) => (
          <button
            key={dir}
            onClick={() => handleGuess(dir)}
            disabled={!canGuess}
            className={`w-32 h-16 rounded-lg text-lg font-bold transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-white ${
              dir === 'up'
                ? 'bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed'
                : 'bg-red-600 hover:bg-red-500 disabled:opacity-40 disabled:cursor-not-allowed'
            }`}
          >
            {dir === 'up' ? '▲ Up' : '▼ Down'}
          </button>
        ))}
      </div>

      {/* Pending guess status */}
      {isPending && state.activeGuess && (
        <div className="text-center text-sm text-zinc-400 space-y-1">
          <p>
            Guessed{' '}
            <span className={state.activeGuess.direction === 'up' ? 'text-emerald-400 font-bold' : 'text-red-400 font-bold'}>
              {state.activeGuess.direction === 'up' ? '▲ up' : '▼ down'}
            </span>{' '}
            from {formatPrice(state.activeGuess.priceAtGuess)}
          </p>
          <p className="text-zinc-500">
            <ElapsedTimer guessedAt={state.activeGuess.guessedAt} />
          </p>
        </div>
      )}

      {/* Error */}
      {error && (
        <p className="text-sm text-amber-400">{error}</p>
      )}

      {/* Loading state */}
      {state === null && !error && (
        <p className="text-sm text-zinc-500">Loading…</p>
      )}
    </main>
  )
}

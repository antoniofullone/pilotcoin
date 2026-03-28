import type { GameState } from '@/lib/types'
import { CountdownRing } from './countdown-ring'
import {
  type FlashState,
  formatDelta,
  formatPrice,
  streakMessage,
  wrongMessage,
} from './game-helpers'

export function GameFeedbackStrip({
  flash,
  isPending,
  activeGuess,
  error,
  isLoading,
  onCountdownExpired,
}: {
  flash: FlashState | null
  isPending: boolean
  activeGuess: GameState['activeGuess']
  error: string | null
  isLoading: boolean
  onCountdownExpired: () => void
}) {
  return (
    <footer className="border-t border-[var(--bg-elevated)] pt-4 pb-2 min-h-[120px] flex flex-col items-center justify-center gap-3">
      {flash && (
        <div
          role="status"
          aria-live="polite"
          className={`
            w-full rounded-xl px-5 py-4 text-center
            ${flash.exiting ? 'animate-fade-out' : 'animate-fade-in'}
            ${
              flash.outcome === 'correct'
                ? 'bg-emerald-500/20 border border-emerald-500/50'
                : 'bg-red-500/20 border border-red-500/50'
            }
          `}
        >
          <p
            className={`text-2xl font-bold mb-0.5 ${
              flash.outcome === 'correct' ? 'text-emerald-400' : 'text-red-400'
            }`}
          >
            {flash.outcome === 'correct' ? `+${flash.delta} ✔` : `${flash.delta} ✗`}
          </p>
          <p
            className={`text-sm font-medium mb-2 ${
              flash.outcome === 'correct' ? 'text-emerald-300' : 'text-red-300'
            }`}
          >
            {flash.outcome === 'correct'
              ? streakMessage(flash.streak)
              : wrongMessage(flash.streak)}
          </p>
          <p className="text-xs font-mono tabular-nums text-[var(--text-secondary)]">
            {formatPrice(flash.priceAtGuess)} → {formatPrice(flash.priceAtResolution)}{' '}
            <span
              className={
                flash.outcome === 'correct' ? 'text-emerald-500' : 'text-red-500'
              }
            >
              ({formatDelta(flash.priceAtGuess, flash.priceAtResolution)})
            </span>
          </p>
        </div>
      )}

      {isPending && activeGuess && (
        <div className="flex flex-col items-center gap-3 w-full">
          <CountdownRing
            guessedAt={activeGuess.guessedAt}
            onExpired={onCountdownExpired}
          />
          <p className="text-sm text-[var(--text-secondary)] text-center">
            Guessed{' '}
            <span
              className={`font-bold font-mono ${
                activeGuess.direction === 'up'
                  ? 'text-emerald-400'
                  : 'text-red-400'
              }`}
            >
              {activeGuess.direction === 'up' ? '▲ up' : '▼ down'}
            </span>{' '}
            from{' '}
            <span className="font-mono tabular-nums">
              {formatPrice(activeGuess.priceAtGuess)}
            </span>
          </p>
        </div>
      )}

      {error && (
        <p
          role="status"
          aria-live="polite"
          className="text-sm text-[var(--color-warn)] text-center"
        >
          {error}
        </p>
      )}

      {!isPending && !flash && !error && !isLoading && (
        <p className="text-xs text-[var(--text-muted)] text-center">
          Your score is saved across sessions.
        </p>
      )}
    </footer>
  )
}

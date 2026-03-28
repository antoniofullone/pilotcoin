import type { Direction, PriceSource } from '@/lib/types'
import { Skeleton, formatPrice } from './game-helpers'

export function GameActionPanel({
  isLoading,
  isPending,
  price,
  priceSource,
  priceUnavailable,
  lockedIn,
  canGuess,
  onGuess,
}: {
  isLoading: boolean
  isPending: boolean
  price: number | null
  priceSource: PriceSource | null
  priceUnavailable: boolean
  lockedIn: Direction | null
  canGuess: boolean
  onGuess: (direction: Direction) => void
}) {
  return (
    <section className="flex-1 flex flex-col items-center justify-center gap-8 py-10">
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
                {formatPrice(price)}
              </p>
              {priceUnavailable && (
                <span className="w-2 h-2 rounded-full bg-[var(--color-warn)] animate-pulse-dot" />
              )}
            </div>
            <p className="text-xs uppercase tracking-widest text-[var(--text-muted)]">
              BTC / USD{priceSource ? ` · ${priceSource}` : ''}
            </p>
            {priceUnavailable && (
              <p className="text-xs text-[var(--color-warn)] mt-1">
                Price feed unavailable
              </p>
            )}
          </>
        )}
      </div>

      {!isLoading && !isPending && (
        <p className="text-sm text-[var(--text-secondary)] text-center px-4">
          Will it go up or down in the next 60 seconds?
        </p>
      )}

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
                onClick={() => onGuess(dir)}
                disabled={!canGuess}
                aria-label={`Guess Bitcoin price will go ${dir}`}
                className={`
                  w-full sm:w-40 min-h-[80px] rounded-xl text-lg font-bold
                  transition-all duration-150
                  active:scale-95
                  focus:outline-none focus-visible:ring-2 focus-visible:ring-white
                  disabled:opacity-40 disabled:cursor-not-allowed
                  ${
                    dir === 'up'
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

      {priceUnavailable && !isPending && !isLoading && (
        <p className="text-xs text-[var(--color-warn)] text-center">
          Waiting for price feed to place a guess…
        </p>
      )}
    </section>
  )
}

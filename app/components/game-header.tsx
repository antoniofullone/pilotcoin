import { Skeleton } from './game-helpers'

export function GameHeader({
  isLoading,
  score,
  streak,
  scoreAnimation,
}: {
  isLoading: boolean
  score: number
  streak: number
  scoreAnimation: 'pulse-up' | 'shake' | null
}) {
  return (
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
        aria-label={`Score: ${score}`}
        className="flex items-center gap-1.5"
      >
        <span className="text-xs text-[var(--text-muted)] uppercase tracking-widest">
          Score
        </span>
        {isLoading ? (
          <Skeleton className="w-8 h-5" />
        ) : (
          <span
            key={score}
            className={`text-base font-bold font-mono tabular-nums text-[var(--text-primary)] ${
              scoreAnimation === 'pulse-up'
                ? 'animate-pulse-up'
                : scoreAnimation === 'shake'
                  ? 'animate-shake'
                  : ''
            }`}
          >
            {score}
          </span>
        )}
      </div>
    </header>
  )
}

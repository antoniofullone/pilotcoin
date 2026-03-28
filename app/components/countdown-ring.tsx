'use client'

import { useEffect, useRef, useState } from 'react'

export function CountdownRing({
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
      <div
        className="relative w-16 h-16"
        aria-label={`${remaining} seconds remaining until guess resolves`}
      >
        <svg className="w-full h-full -rotate-90" viewBox="0 0 64 64">
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke="var(--bg-elevated)"
            strokeWidth="4"
          />
          <circle
            cx="32"
            cy="32"
            r={radius}
            fill="none"
            stroke={remaining > 10 ? 'var(--color-up)' : 'var(--color-warn)'}
            strokeWidth="4"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            style={{
              transition: 'stroke-dashoffset 0.9s linear, stroke 0.3s ease',
            }}
          />
        </svg>
        <div className="absolute inset-0 flex items-center justify-center">
          {isResolving ? (
            <span className="text-[10px] text-[var(--text-muted)] font-mono animate-pulse">
              …
            </span>
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

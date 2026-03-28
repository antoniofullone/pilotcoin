export type FlashState = {
  outcome: 'correct' | 'incorrect'
  delta: number
  priceAtGuess: number
  priceAtResolution: number
  streak: number
  exiting: boolean
}

export function streakMessage(streak: number): string {
  if (streak === 2) return 'Two in a row!'
  if (streak === 3) return 'On fire! 🔥'
  if (streak === 4) return 'Four straight! 🔥'
  if (streak >= 5) return 'Unstoppable! ⚡'
  return 'Nice call!'
}

export function wrongMessage(prevStreak: number): string {
  if (prevStreak >= 3) return 'Streak broken.'
  if (prevStreak === 2) return 'So close.'
  return 'Next time.'
}

export function formatPrice(price: number | null): string {
  if (price === null) return '—'
  return price.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

export function formatDelta(from: number, to: number): string {
  const diff = to - from
  const sign = diff >= 0 ? '+' : ''
  return `${sign}${formatPrice(diff)}`
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={`shimmer rounded-lg ${className ?? ''}`} />
}

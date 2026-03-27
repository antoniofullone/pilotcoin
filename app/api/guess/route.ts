import { NextRequest, NextResponse } from 'next/server'
import { getOrCreatePlayer, submitGuess } from '@/lib/db'
import { fetchBtcPrice } from '@/lib/price'
import type { Direction } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const playerId = request.headers.get('x-player-id')
  if (!playerId) {
    return NextResponse.json(
      { error: 'Missing X-Player-Id header' },
      { status: 400 }
    )
  }

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const direction = (body as { direction?: unknown }).direction
  if (direction !== 'up' && direction !== 'down') {
    return NextResponse.json(
      { error: 'direction must be "up" or "down"' },
      { status: 400 }
    )
  }

  // Check for an existing pending guess
  const player = await getOrCreatePlayer(playerId)
  if (player.activeGuess) {
    return NextResponse.json(
      { error: 'A guess is already pending', activeGuess: player.activeGuess },
      { status: 409 }
    )
  }

  // Fetch price server-side — client cannot influence priceAtGuess
  let priceFetch
  try {
    priceFetch = await fetchBtcPrice()
  } catch {
    return NextResponse.json(
      { error: 'Price feed unavailable, try again shortly' },
      { status: 503 }
    )
  }

  const guess = {
    direction: direction as Direction,
    priceAtGuess: priceFetch.price,
    guessedAt: new Date().toISOString(),
    priceSource: priceFetch.source,
  }

  try {
    await submitGuess(playerId, guess)
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
      return NextResponse.json(
        { error: 'A guess is already pending' },
        { status: 409 }
      )
    }
    return NextResponse.json({ error: 'Failed to submit guess' }, { status: 500 })
  }

  return NextResponse.json({ guess }, { status: 201 })
}

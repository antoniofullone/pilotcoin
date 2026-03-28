import { NextRequest, NextResponse } from 'next/server'
import { getOrCreatePlayer, submitGuess } from '@/lib/db'
import { getAwsInfraErrorMessage, logAwsInfraError } from '@/lib/aws-errors'
import { fetchBtcPrice } from '@/lib/price'
import type { Direction } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  const playerId = request.cookies.get('playerId')?.value
  if (!playerId) {
    return NextResponse.json(
      { error: 'No session — reload the page' },
      { status: 401 }
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
  let player
  try {
    player = await getOrCreatePlayer(playerId)
  } catch (error) {
    logAwsInfraError('POST /api/guess player bootstrap failed', error)
    return NextResponse.json(
      { error: getAwsInfraErrorMessage(error) },
      { status: 500 }
    )
  }

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
    logAwsInfraError('POST /api/guess submit failed', err)
    return NextResponse.json(
      { error: getAwsInfraErrorMessage(err) },
      { status: 500 }
    )
  }

  return NextResponse.json({ guess }, { status: 201 })
}

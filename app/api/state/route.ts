import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getOrCreatePlayer, resolveAndUpdateScore } from '@/lib/db'
import { getAwsInfraErrorMessage, logAwsInfraError } from '@/lib/aws-errors'
import { fetchBtcPrice } from '@/lib/price'
import { resolveGuess } from '@/lib/resolution'
import type { GameState } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const playerId = request.headers.get('x-player-id') || uuidv4()

  // Fetch player state and price in parallel — price failure is non-fatal
  const [playerResult, priceResult] = await Promise.allSettled([
    getOrCreatePlayer(playerId),
    fetchBtcPrice(),
  ])

  if (playerResult.status === 'rejected') {
    logAwsInfraError('GET /api/state player bootstrap failed', playerResult.reason)
    return NextResponse.json(
      { error: getAwsInfraErrorMessage(playerResult.reason) },
      { status: 500 }
    )
  }

  const player = playerResult.value
  const priceFetch =
    priceResult.status === 'fulfilled' ? priceResult.value : null

  let lastResolution = null

  // Lazy resolution: attempt to resolve an active guess inline
  if (player.activeGuess && priceFetch) {
    const resolution = resolveGuess(
      player.activeGuess,
      priceFetch.price,
      priceFetch.price
    )

    if (resolution) {
      try {
        await resolveAndUpdateScore(playerId, resolution.pointsDelta)
        lastResolution = resolution
        // Reflect the updated score locally (avoid a second DB read)
        player.score += resolution.pointsDelta
        player.activeGuess = null
      } catch {
        // ConditionalCheckFailedException means another request already resolved it
        // Silently ignore — the next poll will return the resolved state
      }
    }
  }

  const state: GameState = {
    price: priceFetch?.price ?? null,
    priceSource: priceFetch?.source ?? null,
    score: player.score,
    activeGuess: player.activeGuess,
    lastResolution,
  }

  const response = NextResponse.json({ playerId, ...state })

  // Echo the playerId back so clients can persist a server-assigned one
  response.headers.set('x-player-id', playerId)

  return response
}

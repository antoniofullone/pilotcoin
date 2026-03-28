import { NextRequest, NextResponse } from 'next/server'
import { v4 as uuidv4 } from 'uuid'
import { getOrCreatePlayer, resolveAndUpdateScore } from '@/lib/db'
import { getAwsInfraErrorMessage, logAwsInfraError } from '@/lib/aws-errors'
import { fetchBtcPrice } from '@/lib/price'
import { resolveGuess } from '@/lib/resolution'
import type { GameState } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const cookiePlayerId = request.cookies.get('playerId')?.value
  const playerId = cookiePlayerId || uuidv4()
  const isNewPlayer = !cookiePlayerId

  // Fetch player first — we need priceSource from activeGuess to enforce same-source resolution
  const playerResult = await getOrCreatePlayer(playerId).then(
    (value) => ({ status: 'fulfilled' as const, value }),
    (reason) => ({ status: 'rejected' as const, reason })
  )

  if (playerResult.status === 'rejected') {
    logAwsInfraError('GET /api/state player bootstrap failed', playerResult.reason)
    return NextResponse.json(
      { error: getAwsInfraErrorMessage(playerResult.reason) },
      { status: 500 }
    )
  }

  const player = playerResult.value

  // Use the same price source that was used at guess time to enforce fairness
  const preferredSource = player.activeGuess?.priceSource
  const priceFetch = await fetchBtcPrice(preferredSource).catch(() => null)

  let lastResolution = null

  // Lazy resolution: attempt to resolve an active guess inline
  if (player.activeGuess && priceFetch) {
    const resolution = resolveGuess(
      player.activeGuess,
      priceFetch.price
    )

    if (resolution) {
      try {
        await resolveAndUpdateScore(playerId, resolution.pointsDelta)
        lastResolution = resolution
        // Reflect the updated score locally (avoid a second DB read)
        player.score += resolution.pointsDelta
        player.activeGuess = null
      } catch (err) {
        if (err instanceof Error && err.name === 'ConditionalCheckFailedException') {
          // Another request already resolved this guess — next poll will converge
        } else {
          logAwsInfraError('GET /api/state settlement failed', err)
        }
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

  if (isNewPlayer) {
    response.cookies.set('playerId', playerId, {
      httpOnly: true,
      sameSite: 'strict',
      path: '/',
      maxAge: 60 * 60 * 24 * 365, // 1 year
      secure: request.nextUrl.protocol === 'https:',
    })
  }

  return response
}

import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import {
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  UpdateCommand,
} from '@aws-sdk/lib-dynamodb'
import type { Player, ActiveGuess } from './types'

const TABLE_NAME = process.env.TABLE_NAME ?? 'btc-game'

const client = new DynamoDBClient({
  region: process.env.AWS_REGION ?? 'us-east-1',
})

const ddb = DynamoDBDocumentClient.from(client, {
  marshallOptions: { removeUndefinedValues: true },
})

/**
 * Fetch an existing player or create one with score=0.
 * Uses a conditional put to avoid overwriting an existing record.
 */
export async function getOrCreatePlayer(playerId: string): Promise<Player> {
  const now = new Date().toISOString()

  // Attempt to create. ConditionExpression prevents overwriting an existing player.
  try {
    await ddb.send(
      new PutCommand({
        TableName: TABLE_NAME,
        Item: {
          playerId,
          score: 0,
          createdAt: now,
          activeGuess: null,
        },
        ConditionExpression: 'attribute_not_exists(playerId)',
      })
    )
    return { playerId, score: 0, createdAt: now, activeGuess: null }
  } catch (err: unknown) {
    // Player already exists — fetch the existing record
    if (
      err instanceof Error &&
      err.name === 'ConditionalCheckFailedException'
    ) {
      return getPlayer(playerId)
    }
    throw err
  }
}

async function getPlayer(playerId: string): Promise<Player> {
  const result = await ddb.send(
    new GetCommand({ TableName: TABLE_NAME, Key: { playerId } })
  )
  if (!result.Item) throw new Error(`Player not found: ${playerId}`)
  return result.Item as Player
}

/**
 * Store an active guess on the player record.
 * Returns 409-style error if a guess is already pending.
 */
export async function submitGuess(
  playerId: string,
  guess: ActiveGuess
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { playerId },
      UpdateExpression: 'SET activeGuess = :guess',
      ConditionExpression: 'attribute_exists(playerId) AND (attribute_not_exists(activeGuess) OR activeGuess = :null)',
      ExpressionAttributeValues: {
        ':guess': guess,
        ':null': null,
      },
    })
  )
}

/**
 * Atomically clear the active guess and update the player's score.
 * ConditionExpression prevents double-resolution if two requests race.
 */
export async function resolveAndUpdateScore(
  playerId: string,
  pointsDelta: number
): Promise<void> {
  await ddb.send(
    new UpdateCommand({
      TableName: TABLE_NAME,
      Key: { playerId },
      UpdateExpression:
        'SET score = score + :delta, activeGuess = :null',
      ConditionExpression: 'attribute_exists(activeGuess) AND activeGuess <> :null',
      ExpressionAttributeValues: {
        ':delta': pointsDelta,
        ':null': null,
      },
    })
  )
}

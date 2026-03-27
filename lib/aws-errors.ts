function getConfiguredTableName(): string {
  return process.env.TABLE_NAME ?? 'btc-game'
}

function getConfiguredRegion(): string {
  return process.env.AWS_REGION ?? 'us-east-1'
}

export function getAwsInfraErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    switch (error.name) {
      case 'ResourceNotFoundException':
        return `DynamoDB table "${getConfiguredTableName()}" was not found in region "${getConfiguredRegion()}".`
      case 'UnrecognizedClientException':
      case 'InvalidSignatureException':
        return 'AWS credentials were rejected. Check your AWS credentials and region.'
      case 'CredentialsProviderError':
        return 'AWS credentials are missing or incomplete.'
      default:
        break
    }
  }

  return 'Failed to load player data.'
}

export function logAwsInfraError(context: string, error: unknown): void {
  console.error(`[${context}]`, error)
}

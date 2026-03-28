import { test, expect } from '@playwright/test'

// Intercepts all API calls so no real DynamoDB or price feed is needed.

const BASE_STATE = {
  playerId: 'e2e-player',
  price: 65000,
  priceSource: 'binance',
  score: 0,
  activeGuess: null,
  lastResolution: null,
}

test.describe('BTC Price Prediction Game', () => {
  test('page loads and shows BTC price', async ({ page }) => {
    await page.route('**/api/state', route =>
      route.fulfill({ status: 200, json: BASE_STATE })
    )

    await page.goto('/')
    await expect(page.getByText('$65,000.00')).toBeVisible()
  })

  test('Up and Down buttons are present and enabled', async ({ page }) => {
    await page.route('**/api/state', route =>
      route.fulfill({ status: 200, json: BASE_STATE })
    )

    await page.goto('/')
    await expect(page.getByLabel('Guess Bitcoin price will go up')).toBeEnabled()
    await expect(page.getByLabel('Guess Bitcoin price will go down')).toBeEnabled()
  })

  test('clicking Up shows pending state with countdown ring', async ({ page }) => {
    const activeGuess = {
      direction: 'up',
      priceAtGuess: 65000,
      guessedAt: new Date(Date.now() - 5_000).toISOString(),
      priceSource: 'binance',
    }

    let callCount = 0
    await page.route('**/api/state', route => {
      callCount++
      route.fulfill({ status: 200, json: callCount === 1 ? BASE_STATE : { ...BASE_STATE, activeGuess } })
    })
    await page.route('**/api/guess', route =>
      route.fulfill({ status: 201, json: { guess: activeGuess } })
    )

    await page.goto('/')
    await page.getByLabel('Guess Bitcoin price will go up').click()

    // Countdown ring should appear; buttons should be disabled
    await expect(page.getByLabel(/seconds remaining until guess resolves/i)).toBeVisible()
    await expect(page.getByLabel(/waiting for result/i).first()).toBeDisabled()
  })

  test('API error shows error banner', async ({ page }) => {
    await page.route('**/api/state', route =>
      route.fulfill({ status: 500, json: { error: 'Service unavailable' } })
    )

    await page.goto('/')
    await expect(page.getByText(/service unavailable/i)).toBeVisible()
  })
})

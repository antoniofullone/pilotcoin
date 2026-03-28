# BTC Price Prediction Game

A web app that lets players guess whether the Bitcoin (BTC/USD) price will be higher or lower after one minute. Correct guesses add a point. Incorrect guesses subtract one. Score persists across sessions.

**[Try the live demo](https://pilotcoin.vercel.app/)**

---

## How to Play

1. Open the app — a session cookie is set automatically.
2. See the live BTC/USD price (updated every 5 seconds).
3. Click **▲ Up** if you think the price will be higher in 60 seconds, or **▼ Down** if lower.
4. Wait. The guess resolves when both conditions are met:
   - At least 60 seconds have passed since you guessed.
   - The price has changed from your entry price.
5. Your score updates automatically. Close the browser and come back — your score is waiting.

---

## Architecture

```
Browser (React SPA)
  │
  ├── GET /api/state  (every 5 seconds)
  │     Returns: { price, score, activeGuess, lastResolution }
  │     Also: creates player on first call, resolves eligible guesses inline
  │
  └── POST /api/guess
        Body: { direction: "up" | "down" }
        Fetches BTC price server-side and stores it with the guess

AWS DynamoDB (single table: btc-game)
  └── One item per player
        { playerId, score, createdAt, activeGuess: { direction, priceAtGuess, guessedAt, priceSource } }

BTC Price
  └── Binance primary  → api.binance.com/api/v3/ticker/price?symbol=BTCUSDT
      Kraken fallback  → api.kraken.com/0/public/Ticker?pair=XBTUSD
      Same source enforced for guess entry and resolution (fairness)
```

**Session identity:** Server-issued UUID in an `httpOnly`, `Secure`, `SameSite=Strict` cookie. JavaScript can't read it (closes XSS vector), the browser sends it automatically, no localStorage involved.

**Resolution model:** Guesses resolve lazily on the next `/api/state` poll after eligibility is met. No background job required — the spec describes a condition, not a schedule.

**Atomicity:** A single DynamoDB `UpdateItem` with a condition expression atomically updates the score and clears the active guess, preventing double-resolution if two requests race.

See [`docs/architecture-decisions.md`](docs/architecture-decisions.md) for full decision rationale and [`docs/engineering-tradeoffs.md`](docs/engineering-tradeoffs.md) for deliberate simplifications.

---

## Running Locally

### Prerequisites

- Node.js 20.9+
- An AWS account with DynamoDB access
- AWS credentials configured

### Setup

```bash
git clone <repo-url>
cd pilotcoin
npm install
```

Create a `.env.local` file:

```env
AWS_ACCESS_KEY_ID=your_access_key
AWS_SECRET_ACCESS_KEY=your_secret_key
AWS_REGION=us-east-1          # or whichever region your table lives in
TABLE_NAME=btc-game
```

### Create the DynamoDB Table

```bash
aws dynamodb create-table \
  --table-name btc-game \
  --attribute-definitions AttributeName=playerId,AttributeType=S \
  --key-schema AttributeName=playerId,KeyType=HASH \
  --billing-mode PAY_PER_REQUEST \
  --region $AWS_REGION
```

Or create it in the AWS Console: DynamoDB → Create table → Partition key: `playerId` (String) → On-demand capacity.

### Start the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Running Tests

```bash
npm test
```

42 unit/component tests across 4 suites + 4 Playwright E2E tests:

```bash
npm test          # unit + component tests (vitest)
npm run test:e2e  # browser tests (playwright)
```

| Suite | What it tests |
|---|---|
| `tests/resolution.test.ts` | Pure guess resolution logic — time gate, price gate, all four direction/price combos, boundary cases |
| `tests/price.test.ts` | Binance/Kraken fallback logic — source selection, preferredSource hint, failure handling |
| `tests/api.test.ts` | API route integration — state loading, cookie session, guess submission, 409 on duplicate, input validation |
| `tests/page.test.tsx` | React component tests — loading state, price display, guess flow, countdown ring, flash dedup, error handling |
| `tests/e2e/game.spec.ts` | Playwright E2E — page load, button interaction, pending state, error banner |

---

## Deployment

### 1. Deploy to Vercel

Connect the GitHub repository to Vercel (or run `npx vercel` in the project directory). Vercel auto-detects Next.js.

Set these environment variables in the Vercel project settings:

```
AWS_ACCESS_KEY_ID=<your key>
AWS_SECRET_ACCESS_KEY=<your secret>
AWS_REGION=<your DynamoDB region>
TABLE_NAME=btc-game
```

Vercel deploys on every push to `main`.

### 2. Create the DynamoDB Table

Run the `aws dynamodb create-table` command above (one-time setup). The app uses on-demand billing — no capacity planning needed.

**IAM permissions required for the Vercel deployment user:**
- `dynamodb:GetItem`
- `dynamodb:PutItem`
- `dynamodb:UpdateItem`

---

## Known Limitations

**Offline resolution:** Guesses resolve on the next request after eligibility, not in a background process. If you close the browser with a pending guess, it stays pending until you return. This is a deliberate trade-off — the spec describes a condition-based resolution model, not a scheduled settlement. See [`docs/engineering-tradeoffs.md`](docs/engineering-tradeoffs.md).

**5-second polling:** The UI polls every 5 seconds. WebSocket or Server-Sent Events would give real-time updates with ~90% fewer requests — the right next step for production.

**No guess history:** Only the current active guess is stored. Past guesses are not persisted. Adding a `guessHistory` list attribute or a separate table is straightforward.

---

## What I'd Add With More Time

1. **IP-based rate limiting** — `proxy.ts` rate limit on `POST /api/guess` to prevent cost abuse on DynamoDB writes.
2. **Server-Sent Events for price updates** — Replace polling with a streaming response. Sub-second price updates, far fewer server calls.
3. **E2E full lifecycle test** — Playwright test covering: submit guess → wait 60s → see resolution and score update (requires real timer control or stubbed time).
4. **IaC template** — SAM or CDK for reproducible one-command backend deployment.

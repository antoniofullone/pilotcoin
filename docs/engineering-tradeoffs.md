# Engineering Trade-offs

Deliberate trade-offs made during design and implementation. For each: what I chose, what I gave up, and how to fix it.

---

## 1. Lazy resolution vs. background job

**Chose:** Guess resolution happens inline on the next `/api/state` poll.

**Gave up:** Resolution while the user is offline. Close your browser mid-guess and it won't evaluate until you come back.

**Why I'm fine with this:** The spec says "players should be able to close their browser and return back to see their score." That's about persistence, not background settlement. Nothing in the spec says "the guess settles while you're away."

**To upgrade:** Add a cron job (Vercel Cron or EventBridge) that scans for eligible pending guesses every 60 seconds. You'd want a GSI on the player table to avoid a full scan.

---

## 2. Embedded active guess vs. separate records

**Chose:** One DynamoDB item per player with `activeGuess` as an attribute.

**Gave up:** Guess history. No record of past guesses, only the active one.

**Why I'm fine with this:** The spec asks for score persistence and one-guess-at-a-time. It doesn't mention past guesses. Adding a history table means more schema, more queries, and more consistency logic for something nobody asked for.

**To upgrade:** Add a `guessHistory` list attribute, or a dedicated table with `playerId` as PK and `guessedAt` as SK. Resolution logic stays the same — just append instead of overwrite.

---

## 3. Single UpdateItem vs. TransactWriteItems

**Chose:** One `UpdateItem` with a condition expression for atomic resolution.

**Gave up:** Nothing. When score and active guess live on the same item, `UpdateItem` is already fully atomic. `TransactWriteItems` is for coordinating across items or tables, which is exactly the architecture I avoided.

The condition expression prevents double-resolution: first writer wins, second gets `ConditionalCheckFailedException`, handled gracefully.

---

## 4. UUID in localStorage vs. server-issued session

**Chose:** Client-generated UUID in `localStorage`.

**Gave up:** Tamper resistance. If someone knows your UUID, they can send it as the `X-Player-Id` header and impersonate you.

**Why I'm fine with this:** No real money, no real stakes. The UUID is v4 (random), so not guessable. The attack requires already having the UUID.

**To upgrade:** Issue the UUID server-side on first visit. Return it as an `httpOnly`, `Secure`, `SameSite=Strict` cookie. JavaScript can't read it (closes XSS vector), the browser sends it automatically. Drop the header pattern entirely.

---

## 5. 5-second polling vs. real-time push

**Chose:** Client polls `/api/state` every 5 seconds.

**Gave up:** Real-time price updates and instant resolution notification. Up to 5 seconds of lag.

**Why I'm fine with this:** For a "guess over 1 minute" game, 5-second polling is imperceptible. The gameplay is: submit, wait 60 seconds, see result. A 5-second lag on a 60-second game is ~8% timing imprecision.

**To upgrade:** Server-Sent Events for the price feed (Vercel supports streaming). WebSocket for resolution notifications (needs a persistent connection service since Vercel doesn't support native WebSockets).

---

## 6. Binance + Kraken vs. dedicated market data provider

**Chose:** Direct calls to exchange public REST APIs.

**Gave up:** Normalized data, uptime SLAs, and a single point to monitor.

**Why I'm fine with this:** Both are tier-1 exchanges with 99.9%+ uptime. No API key needed. Raw exchange data is actually more accurate than aggregated prices here — no aggregation lag.

**To upgrade:** A dedicated provider (CoinAPI, Kaiko) for SLAs and WebSocket streams. Or a price caching layer with Redis.

---

## Things I didn't build (and why)

- **Guess history UI** — Not in spec. Easy to add as a `guessHistory` attribute.
- **Leaderboard** — Not in spec. Needs a GSI on `score` or a secondary table.
- **Rate limiting** — Would add `proxy.ts` with IP-based throttling on `POST /api/guess`.
- **IaC templates** — DynamoDB setup is in the README. In a team, I'd add SAM or CDK.
- **E2E tests** — Would use Playwright. Documented as the next testing investment.

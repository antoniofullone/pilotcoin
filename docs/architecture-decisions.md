# Architecture Decisions

Key decisions made for the BTC Price Prediction Game, with the reasoning behind each. Written before implementation — thinking on paper before writing code.

---

## 1. Two API routes, not five

**Decision:** The entire backend is `GET /api/state` and `POST /api/guess`. That's it.

**Why:** The first design had five endpoints — player bootstrap, price, guess, guess-status, and a resolution cron trigger. When I traced what the client actually needs, it collapses to two things: know the current state (score, price, pending guess) and submit a guess.

`GET /api/state` handles player bootstrap, price fetching, and guess resolution in one call. Halves the request count, simplifies the client state machine, and gives you exactly one place where resolution can fire. Easier to reason about, easier to test.

---

## 2. Lazy resolution — no background job

**Decision:** Guess resolution happens inline when `/api/state` is polled. No cron job.

**Why:** The spec says a guess resolves "when the price changes and at least 60 seconds have passed." That's a condition, not a trigger. The natural implementation is: on every state read, check if the condition is met and resolve if so.

The alternative was a Vercel Cron job every 60 seconds. That adds a `CRON_SECRET`, a separate route, a global DynamoDB scan, and a deployment config file. The user experience is identical — both approaches resolve within seconds of eligibility — but the cron version has five extra moving parts for zero correctness benefit.

One real downside: if you close your browser mid-guess, it won't resolve until you return. The spec says "players should be able to close their browser and return to see their score" — it says nothing about resolution happening while offline. The guess persists and resolves the moment you come back.

---

## 3. Single DynamoDB item per player

**Decision:** One item per player. The active guess is an embedded attribute, not a separate table.

**Why:** The spec wants score persistence and one-guess-at-a-time enforcement. That's it. Separate guess records would require a second table or sort keys, a query pattern I don't need, and more consistency logic.

With a single item, resolving a guess is one `UpdateItem` call — atomically clear `activeGuess` and update `score`. No `TransactWriteItems` needed because both pieces of state live on the same item. First writer wins; concurrent attempts get a `ConditionalCheckFailedException`.

Trade-off: no audit trail of past guesses. In production I'd want that for debugging and fairness verification — straightforward to add as a `guessHistory` list attribute or a separate table when the requirement comes up.

---

## 4. Binance primary, Kraken fallback — same source at entry and exit

**Decision:** BTC/USD price from Binance. Kraken fallback if Binance is down. Store which source was used. Resolution uses the same source.

**Why Kraken specifically:** Binance has geographic restrictions in some US states. Vercel's serverless functions run in US regions. Kraken is fully licensed in the US — most reliable fallback from US compute.

**Why not CoinGecko:** CoinGecko is an aggregator. Aggregators introduce latency, rate limits, and diverge from exchange prices by $10–50 at any moment. For a binary up/down game, that spread can flip the result. Raw exchange data is more accurate here, not less.

**The fairness constraint:** If a guess was priced via Binance, resolution must use Binance too. Storing `priceSource` on the active guess and passing it as a `preferredSource` hint to the resolver prevents cross-source resolution bugs entirely.

---

## 5. UUID in localStorage for player identity

**Decision:** On first visit, generate a UUID v4, store in `localStorage`, send as `X-Player-Id` on every request.

**Why:** The spec requires no auth — just persistence across sessions. A client-generated UUID in localStorage is the simplest path. Survives browser restarts. Works offline.

**Known limitations:**
- Clearing localStorage loses the session. Documented limitation, not a bug.
- UUID spoofing: anyone who knows your UUID can impersonate you. At this scope, acceptable. The production fix is server-issued UUIDs in `httpOnly` cookies, which closes client manipulation entirely.

---

## 6. Graceful degradation when price feed is unavailable

**Decision:** If both Binance and Kraken fail, `/api/state` returns `{ price: null, score: X, activeGuess: {...} }` — not a 503.

**Why:** A price outage shouldn't prevent players from seeing their score or guess state. These are independent concerns. `Promise.allSettled` fetches price and player data in parallel; a price failure returns partial data with a clear `null` signal.

This matters practically: a 503 forces the frontend to handle a full error state and risks breaking the polling loop. Returning partial data is safer and produces a much better experience — you can still see your score and pending guess, just not the current price.

---

## 7. Next.js 16 on Vercel

**Decision:** Keep the Next.js 16 scaffold. Deploy to Vercel.

**Why Vercel:** One `vercel` CLI command deploys everything. Environment variables go in the dashboard. Zero infrastructure configuration. For a half-day assignment this is the right call — it removes an entire category of things to debug.

**Next.js 16 specifics:** Route handler `params` are Promises (must `await params`). GET handlers are dynamic by default. These are documented in the project setup notes.

The alternative was React + Vite + separate Express. Slightly better testing DX, but a split deployment — frontend here, API there. Not worth it when Next.js already handles both in one repo.

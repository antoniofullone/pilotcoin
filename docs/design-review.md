# Design Review Notes

Before writing code, I challenged every major premise in the initial design. These are the premises I questioned, the alternatives I evaluated, and where I landed.

---

## Premise 1: Background resolution via Lambda + EventBridge

**Original plan:** Lambda triggered by EventBridge every 60 seconds to resolve pending guesses. Architecturally clean, resolves even when users are offline.

**Problem:** That's 2-3 hours of infrastructure for a half-day assignment. Lambda function, IAM roles, EventBridge rule, SAM template, environment variable threading. The spec says "AWS services preferred" — it doesn't say "use Lambda."

**Also considered:** Vercel Cron calling an internal route. Same "resolves offline" story, almost no setup.

**Landed on:** Neither. Dropped the background job entirely. The spec describes a condition ("when the price changes and at least 60 seconds have passed"), not a schedule. Lazy resolution in `/api/state` is simpler and equally correct. Only thing lost is resolution while offline, which the spec doesn't require.

---

## Premise 2: Two DynamoDB tables with a GSI

**Original plan:** Separate `players` and `guesses` tables. GSI on `status` to efficiently query pending guesses across all players.

**Problem:** A GSI on `status='pending'` creates a hot partition — all pending guesses funnel to one partition key. At scale that's a real problem. At assignment scale it's irrelevant, but still wrong.

More importantly: the spec never asks for guess history. Two tables were solving a storage problem that doesn't exist. And the `status` GSI was only needed for the cron job's global scan — once the cron is gone, there's no cross-player query.

**Landed on:** Single item per player. Active guess embedded as an attribute. No second table, no GSI, no cross-player query.

---

## Premise 3: CoinGecko as price fallback

**Original plan:** Binance primary, CoinGecko fallback (aggregated, free tier).

**Problem:** CoinGecko's free tier is rate-limited enough to be unreliable as a fallback. Worse: if a guess is submitted with a Binance price and resolved with a CoinGecko price, the two can differ by $10-50 on BTC. That spread can flip a binary up/down result. That's a fairness bug.

**Landed on:** Kraken as fallback. Real exchange, real-time ticker data, no API key, fully licensed in the US. Store `priceSource` on the guess. Resolution uses the same source as entry.

---

## Premise 4: Server-side in-memory price cache

**Original plan:** Module-level cache with 10-15 second TTL. Reduce external calls when multiple clients poll.

**Problem:** Vercel serverless functions don't share memory between invocations. Each request is a separate process. Module-level state resets on every cold start, which on Vercel's auto-scaling happens constantly. The cache does nothing.

**Landed on:** No cache. Binance's rate limits (1,200 req/min) are more than enough for this app.

---

## Premise 5: Separate polling endpoints

**Original plan:** `GET /api/btc-price` polls every 5 seconds. `GET /api/guess-status` polls separately. Two endpoints, two concurrent polling loops.

**Problem:** Two loops means two HTTP connections per cycle. The client always needs both price and guess status — there's no scenario where you want one without the other.

**Landed on:** Single `GET /api/state` returns `{ price, score, activeGuess }`. One request, one loop.

---

## Premise 6: Separate /api/player bootstrap endpoint

**Original plan:** Call `GET /api/player` on page load to create or fetch the player, then separately start polling.

**Problem:** Extra round-trip. The player record is needed on every state fetch anyway. "Create if not exists" fits naturally in the state handler via DynamoDB's `ConditionExpression: attribute_not_exists(playerId)`.

**Landed on:** No `/api/player`. `GET /api/state` handles get-or-create on every call. First call creates, subsequent calls return existing data.

---

## What I'd build differently with more time

1. **httpOnly cookie for session identity** — Server-issued UUID in a cookie. Closes spoofing and avoids localStorage hydration issues on SSR.
2. **SSE or WebSocket for price updates** — 5-second polling is a latency floor. Streaming would push updates as they arrive.
3. **Guess history** — Add a `guessHistory` list or migrate to a dedicated guesses table. Let players see past decisions.
4. **Rate limiting by IP** — `proxy.ts` with throttling on `POST /api/guess` to prevent cost attacks on DynamoDB writes.

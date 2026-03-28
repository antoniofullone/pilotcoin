# Design Review Notes

Before writing code, I challenged every major premise in the initial design. These are the premises I questioned, the alternatives I evaluated, and why I landed where I did.

---

## Premise 1: Background resolution via Lambda + EventBridge

**Original thinking:** Use AWS Lambda triggered by EventBridge every 60 seconds to resolve pending guesses. Architecturally clean — decoupled, auditable, resolves even when users are offline.

**Challenge:** This is 2-3 hours of infrastructure setup for a half-day assignment. Lambda function code, IAM roles, EventBridge rule, SAM template, environment variable threading. The spec says "AWS services preferred" — it does not say "use Lambda."

**Alternative evaluated:** Vercel Cron job calling an internal API route. Same "resolves offline" story, near-zero infra overhead.

**Final decision:** Neither. Dropped the background job entirely. The spec describes a condition-based resolution model ("when the price changes and at least 60 seconds have passed") — this is a check-on-read, not a scheduled task. Lazy resolution in `/api/state` is simpler and equally correct. The only thing lost is resolution while the user is offline, which the spec does not require.

---

## Premise 2: Two DynamoDB tables with a GSI for pending guesses

**Original thinking:** Separate `players` and `guesses` tables. Players table holds score. Guesses table holds guess records with a Global Secondary Index on `status` to efficiently query pending guesses across all players.

**Challenge:** The GSI on `status='pending'` creates a hot partition — all pending guesses route to a single partition key. At production scale this is a real problem. At assignment scale it's irrelevant, but it's still wrong to build it this way.

More fundamentally: the spec never asks for guess history. Two tables were solving a storage problem that doesn't exist. And the `status` GSI was needed specifically for the cron job's global scan — once the cron job is eliminated, there's no cross-player query pattern at all.

**Final decision:** Single item per player. Active guess embedded as an attribute. No second table, no GSI, no cross-player query. Each request is scoped to a single `playerId` partition key.

---

## Premise 3: CoinGecko as price fallback

**Original thinking:** Binance primary (1,200 req/min, real-time), CoinGecko fallback (aggregated, free tier, ~10-30 req/min).

**Challenge:** CoinGecko's free tier is rate-limited enough to be unreliable as a fallback. More critically, if a guess is submitted with a Binance price and resolved with a CoinGecko price, the two sources can differ by $10-50 on BTC. That spread can flip a binary up/down result, which is a fairness bug.

**Alternative evaluated:** Kraken as fallback. Kraken is a real exchange (like Binance), has real-time ticker data, requires no API key for public endpoints, and is fully licensed in US markets where Vercel runs.

**Final decision:** Binance primary, Kraken fallback. Store `priceSource` on the active guess. Resolution uses the same source as entry. Cross-source resolution is explicitly prevented.

---

## Premise 4: Server-side in-memory price cache

**Original thinking:** Cache the last fetched BTC price in module-level memory with a 10-15 second TTL. Reduce external API calls when multiple clients poll simultaneously.

**Challenge:** Vercel serverless functions don't share memory between invocations. Each invocation is a separate process. A module-level cache resets on every cold start, which on Vercel's auto-scaling infrastructure means it resets constantly. The cache provides no benefit.

**Final decision:** No cache. Binance's rate limits (1,200 req/min) are more than sufficient for the request volume this app will generate. Caching was solving a problem that doesn't exist on this infrastructure.

---

## Premise 5: Multiple polling endpoints (price + guess-status separate)

**Original thinking:** `GET /api/btc-price` polls every 5 seconds. `GET /api/guess-status` polls separately while a guess is pending. Two endpoints, potentially two concurrent polling loops.

**Challenge:** Two polling loops means two HTTP connections per 5-second cycle. The client always needs both pieces of data — price to display, guess status to know what UI to show. There's no scenario where you want one without the other.

**Final decision:** Single `GET /api/state` returns `{ price, score, activeGuess }`. One request, one polling loop. Also consolidates player creation (previously a separate `GET /api/player` bootstrap call) into the first state fetch.

---

## Premise 6: Separate /api/player bootstrap endpoint

**Original thinking:** On page load, call `GET /api/player` to fetch or create the player. Then separately start polling `GET /api/btc-price`.

**Challenge:** This is a redundant round-trip. The player record is needed on every state fetch anyway. The "create if not exists" logic belongs in the state handler using a DynamoDB put-if-not-exists pattern (`ConditionExpression: attribute_not_exists(playerId)`).

**Final decision:** No `/api/player` endpoint. `GET /api/state` handles get-or-create on every call. First call creates the player, subsequent calls return existing data. Same DynamoDB operation cost either way.

---

## What I'd build differently with more time

1. **httpOnly cookie for session identity** — Server-issued UUID in a cookie rather than client-generated UUID in localStorage. Closes the spoofing vector and avoids localStorage hydration sequencing issues on SSR.
2. **SSE or WebSocket for price updates** — 5-second polling is a 5-second latency floor. Server-Sent Events would push price updates as they arrive, reducing perceived latency and server request volume.
3. **Guess history as separate items** — Add a `guessHistory` list attribute or migrate to a dedicated guesses table for auditability. Would let players see their past decisions.
4. **Rate limiting by IP** — The current design has no abuse prevention. A `proxy.ts` with IP-based rate limiting on `POST /api/guess` would prevent cost attacks on DynamoDB writes.


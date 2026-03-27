# Architecture Decisions

This document records the key architectural decisions made for the BTC Price Prediction Game, including the reasoning and trade-offs behind each choice. Written before implementation as a forcing function for clear thinking.

---

## 1. Two API routes, not five

**Decision:** The entire backend is two routes — `GET /api/state` and `POST /api/guess`.

**Why:** The original design had five separate endpoints (player, price, guess, guess-status, cron). When I traced the actual data flows, I kept asking: what does the client actually need? It needs to know its current state (score + price + whether it has a pending guess) and it needs to submit a guess. That's two operations. Every other endpoint was serving the implementation, not the product.

`GET /api/state` handles player bootstrap, price fetching, and guess resolution in a single call. This halves the request count, simplifies the client, and means there's exactly one place where resolution logic can fire — making the system easier to reason about and test.

---

## 2. Lazy resolution on read — no background job

**Decision:** Guess resolution happens inline when `/api/state` is polled, not in a background cron job.

**Why:** The spec says a guess resolves "when the price changes and at least 60 seconds have passed." Read that carefully. It's describing a condition, not a trigger. The natural implementation is: on every state read, check if the condition is met and resolve if so. This is check-on-read, which is simpler, cheaper, and correct.

The alternative I considered was a Vercel Cron job running every 60 seconds. It adds CRON_SECRET management, a separate route handler, a global Scan operation on DynamoDB, and a deployment configuration file. The user experience is identical — both approaches resolve within a few seconds of eligibility — but the cron version has five more moving parts for no correctness benefit.

The one downside: if a user closes their browser with a pending guess, it won't resolve until they return. The spec says "players should be able to close their browser and return to see their score" — it says nothing about resolution happening while they're offline. The guess state persists and resolves the moment they come back.

---

## 3. Single DynamoDB item per player

**Decision:** One DynamoDB item per player. The active guess is an embedded attribute on the player record, not a separate table or separate item.

**Why:** The spec asks me to persist the score and allow one guess at a time. It does not ask for guess history. If I store guesses as separate items (either a second table or separate sort keys in a single table), I've added a query pattern I don't need and a data model that's harder to keep consistent.

With a single item per player, resolving a guess is one `UpdateItem` call — atomically decrement or increment score and clear the activeGuess attribute. There's no need for `TransactWriteItems` (which coordinates writes across multiple items) because both pieces of state live on the same item.

The trade-off: no audit trail of past guesses. In production, I'd want that for debugging and fairness verification. The fix is straightforward — add a `guessHistory` list attribute, or migrate to a proper guesses table when the requirement emerges. For this scope, I'm not building infrastructure the spec doesn't ask for.

---

## 4. Binance primary, Kraken fallback — same source enforced

**Decision:** Fetch BTC/USD price from Binance (`/api/v3/ticker/price?symbol=BTCUSDT`). Fall back to Kraken (`/0/public/Ticker?pair=XBTUSD`) only if Binance is unreachable. Store which source was used at guess time. Resolution uses the same source.

**Why two exchanges, not an aggregator:** Both Binance and Kraken are liquid spot markets with real-time order book data and generous public rate limits. No API key required. An aggregator like CoinGecko introduces latency, rate limits, and a fee tier — unnecessary overhead when the primary sources are directly accessible.

**Why Kraken specifically:** Binance has geographic restrictions in some US states. Vercel's serverless functions run in US regions by default. Kraken is fully licensed in the US, making it the most reliable fallback from US-based compute.

**The fairness constraint:** If a player's guess was priced using Binance data, the resolution must also use Binance data. Kraken prices BTC from different order flow and can differ by $10-50 at any moment. For a binary up/down game, that spread could flip the outcome. Storing `priceSource` on the active guess and passing it as a `preferredSource` hint to the resolver eliminates this class of fairness bugs.

---

## 5. UUID in localStorage for player identity

**Decision:** On first visit, generate a UUID v4 and store it in `localStorage`. Send as `X-Player-Id` header on every request.

**Why:** The spec requires no login system — just persistent state across sessions. A client-generated UUID stored in localStorage is the simplest implementation. It survives browser restarts on the same device.

**Known limitations acknowledged:**
- Clearing localStorage loses the session. This is a documented limitation, not a bug.
- UUID spoofing: anyone who knows another player's UUID can impersonate them. At this scope, acceptable. The production fix is server-issued UUIDs in `httpOnly` cookies, which closes the client-manipulation vector entirely.

---

## 6. Graceful degradation when price is unavailable

**Decision:** If both Binance and Kraken are unreachable, `/api/state` returns `{ price: null, score: X, activeGuess: {...} }` rather than failing with 503.

**Why:** A price provider outage should not prevent players from seeing their score or knowing their guess state. These are independent concerns. I fetch price and player state in parallel using `Promise.allSettled` — if price fails, the player data is still returned. The UI shows "Price unavailable" but remains functional.

This matters more than it sounds: if the frontend gets a 503, it has to handle an error state, potentially breaking the polling loop. Returning partial data with a clear null signal is safer and produces better user experience.

---

## 7. Next.js 16 on Vercel

**Decision:** Keep the Next.js 16 scaffold. Host on Vercel.

**Why Vercel:** One `vercel` CLI command deploys the entire app. Environment variables are set in the dashboard. Zero infrastructure configuration. For a half-day assignment, this is the right call.

**Next.js 16 specifics to follow:** Route handler `params` are now Promises (must `await params`). Middleware is now called Proxy (`proxy.ts`). GET handlers are dynamic by default. These are documented in the project setup notes.

The alternative considered was React + Vite with a separate Express server. The DX is slightly better for testing, but it introduces a split deployment — frontend on one host, API on another. The increased complexity is not worth it when Next.js already handles both.

# Engineering Trade-offs

This document tracks deliberate trade-offs made during the design and implementation of this project. For each trade-off, I've noted what was gained, what was lost, and what the production upgrade path looks like.

---

## 1. Lazy resolution vs. background job

**What I chose:** Guess resolution happens inline on the next `/api/state` poll after eligibility is met.

**What I gave up:** Guesses resolve while the user is offline. If a player submits a guess and closes their browser, the guess won't be evaluated until they return.

**Why I'm comfortable with this:** The spec says "players should be able to close their browser and return back to see their score and continue to make more guesses." This is about persistence (score survives a closed browser), not about background settlement. The spec never says "the guess settles while you're away."

**Production upgrade path:** Add a cron job (Vercel Cron or AWS EventBridge) that runs every 60 seconds, scans for eligible pending guesses across all players, and resolves them. At that point, you'd also want a GSI on the players table to avoid a full scan.

---

## 2. Embedded active guess vs. separate guess records

**What I chose:** One DynamoDB item per player with `activeGuess` as an embedded attribute.

**What I gave up:** Guess history. There's no record of past guesses — only the current active one (if any).

**Why I'm comfortable with this:** The spec asks for score persistence and one-guess-at-a-time enforcement. It doesn't mention displaying past guesses or auditing resolution history. Building guess history storage adds a table, a query pattern, and consistency complexity that buys nothing the spec asks for.

**Production upgrade path:** Change `activeGuess` to a list attribute `guessHistory` (or a separate table with `playerId` as PK and `guessedAt` as SK). The resolution logic stays identical — you just append to history instead of overwriting.

---

## 3. Single UpdateItem vs. TransactWriteItems for resolution

**What I chose:** Single `UpdateItem` with a condition expression for atomic resolution.

**What I gave up:** Multi-item transactional guarantees. (But there's nothing to give up here — it's one item.)

**Why this is correct:** When both score and active guess state live on the same DynamoDB item, resolving a guess is a single atomic operation by definition. `UpdateItem` is fully atomic on a single item. `TransactWriteItems` is needed when you're coordinating writes across multiple items or tables — which is exactly the architecture I moved away from.

The condition expression (`ConditionExpression: attribute_not_exists(activeGuess) = false`) prevents double-resolution if two requests race to resolve the same guess. First writer wins; second writer gets a `ConditionalCheckFailedException` which is silently handled.

---

## 4. UUID in localStorage vs. server-issued session

**What I chose:** Client-generated UUID stored in `localStorage`.

**What I gave up:** Tamper resistance. Anyone who knows a player's UUID can impersonate them by sending that UUID as the `X-Player-Id` header.

**Why I'm comfortable with this:** For a proof-of-concept game with no real money or stakes, session hijacking is a low-severity risk. The UUID is randomly generated (v4), so it's not guessable. The attack surface is "someone who already has your UUID" — a social engineering problem, not a technical one.

**Production upgrade path:** Issue the UUID server-side on first visit. Return it as an `httpOnly`, `Secure`, `SameSite=Strict` cookie. The browser sends it automatically. JavaScript can't read it (closes XSS vector). Remove the `X-Player-Id` header pattern entirely.

---

## 5. 5-second polling vs. real-time push

**What I chose:** Client polls `/api/state` every 5 seconds.

**What I gave up:** Real-time price updates and instant resolution notification. There's up to a 5-second lag between when a guess resolves and when the player sees it.

**Why I'm comfortable with this:** For a "guess over 1 minute" game, 5-second polling latency is imperceptible to the user experience. The gameplay loop is: submit guess, wait, see result. A 5-second resolution delay on a 60-second game is a 8% timing imprecision — acceptable.

**Production upgrade path:** Server-Sent Events (SSE) for the price feed (Vercel supports streaming responses). WebSocket for resolution notifications (would need a persistent connection service like AWS API Gateway WebSocket or a dedicated WS server, since Vercel doesn't support persistent connections natively).

---

## 6. Binance + Kraken vs. dedicated market data provider

**What I chose:** Direct calls to exchange public REST APIs.

**What I gave up:** Price normalization, guaranteed uptime SLAs, a single failure point to monitor.

**Why I'm comfortable with this:** Both Binance and Kraken are tier-1 exchanges with 99.9%+ uptime on their public API endpoints. For this use case, the raw exchange price is actually more accurate than an aggregated price — there's no aggregation lag. No API key required, no rate limit concerns at this scale.

**Production upgrade path:** Use a dedicated market data provider (CoinAPI, Kaiko, or similar) for guaranteed SLAs, normalized data, and WebSocket price streams. Alternatively, build a price caching layer that buffers exchange data and serves it from Redis with sub-millisecond latency.

---

## Explicit non-decisions (things I didn't even start)

- **Guess history UI** — Not in spec. If asked in walkthrough: "I'd add a `guessHistory` attribute to the player item and render it below the game. The data model supports it without migration."
- **Leaderboard** — Not in spec. Would require a GSI on `score` (or a secondary table). Explicitly out of scope.
- **Rate limiting** — Not implemented. Would add `proxy.ts` with IP-based rate limiting on `POST /api/guess` in production.
- **IaC templates** — No SAM or CDK. The DynamoDB table setup is documented in the README with console instructions. In a team context, I'd add a SAM template.
- **End-to-end tests** — Skipped for time. Would use Playwright. The README documents this as the next testing investment.


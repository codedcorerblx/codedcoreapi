# Relay: private Roblox + Discord API proxy

Next.js 15 (App Router) + TypeScript for Vercel. One private API key in front of Roblox and Discord public data, one JSON envelope, pagination, batching, a server-side playground, OpenAPI/Swagger and a Postgres-backed status dashboard.

## Architecture: one registry drives everything
Each endpoint is one object in `src/lib/registry/{roblox,discord,system}.ts` (path, params, pagination, response fields, example, errors **and handler**). From it the project generates the docs pages, playground forms, `/openapi.json` + `/swagger`, request validation, batch routing/validation, and the endpoint list on `/status`. To add an endpoint, append one object. Nothing else changes.

Flow: `route.ts` → `dispatch.handleRequest` (auth) → `pipeline.execute` (auth again, validate, cache/de-dupe, handler, pagination, envelope, log). Direct calls, batch sub-requests and the playground all share `execute`, so they get identical authentication, caching, rate-limit tracking, retries and timeouts.

## Setup
```bash
npm install
cp .env.example .env.local     # fill in API_SECRET, tokens, cookies, DATABASE_URL
npm run dev
```
| Variable | Purpose |
|---|---|
| `API_SECRET` | The single global key (required; ≥32 random chars: `openssl rand -base64 36`). |
| `DISCORD_BOT_TOKENS` | Comma-separated bot tokens (trimmed, empties ignored). |
| `ROBLOX_COOKIES` | Comma-separated `.ROBLOSECURITY` values. Use a throw-away account. |
| `DATABASE_URL` | Postgres (Neon recommended). Tables auto-create. |
Tuning variables are listed in `.env.example`. Credentials are never returned or logged; the DB stores only a keyed HMAC per credential (to share cooldowns across instances).

## Deploy to Vercel
1. Push to Git and import the repo in Vercel (Next.js preset, no extra settings).
2. Storage → add **Neon** (Marketplace) and connect it to the project; this injects `DATABASE_URL`.
3. Add `API_SECRET`, `DISCORD_BOT_TOKENS`, `ROBLOX_COOKIES` as Sensitive environment variables.
4. Deploy. Optionally set `NEXT_PUBLIC_BASE_URL` for a custom domain in the docs.
5. Verify with `curl -H 'x-api-key: …' https://<app>/api/credentials`.

## Authentication
`x-api-key` is required on **every** `/api/*` request (batch and playground included); missing/wrong → 401. Constant-time compare; fails closed if `API_SECRET` is unset. Public: `/`, `/docs/*`, `/status`, `/status/data`, `/openapi.json`, `/swagger`. No accounts or extra keys.

**Playground:** the key never reaches frontend JS, storage or network config. Because docs are public, an open playground would let anyone spend your key, so you enter the key once; the server verifies it and sets a signed, HttpOnly, SameSite=Strict, 1-hour cookie (an HMAC of an expiry, not the key). Requests run via `/api/playground/execute`, which injects the key server-side. Changing `API_SECRET` invalidates sessions.

## Envelope, availability, errors
`{ success, data, error, nextCursor, metadata }`. Metadata always has `timestamp`, `responseTime`, `requestId`; successes add `cached`, `availability` (`available|empty|partial`) and list `pagination`. Private / forbidden / unsupported are distinct error codes (`PRIVATE`, `FORBIDDEN`, `UNSUPPORTED`), never silent empties.

## Pagination
`limit` (clamped to upstream max; Roblox snaps to 10/25/50/100), `cursor=<nextCursor>`, or `cursor=auto`: follows every cursor, bounded by `AUTO_PAGINATION_MAX_ITEMS/PAGES/TIMEOUT_MS`; on a cap or mid-way error it returns what it has plus a resumable `nextCursor`.

## Rate limits, rotation, fallback
LRU rotation; upstream 429 cools that credential (or Discord route bucket) for `Retry-After` and retries on the next one, with cooldowns shared via Postgres; 401 marks a credential invalid for 10 min; Discord guild/channel calls retry with other bots on 403; Roblox public calls fall back to anonymous; jittered retries and timeouts on network/5xx.

## Caching
Per-instance TTL cache + in-flight de-duplication (optimisation only). All monitoring data is in Postgres.

## Analytics
`request_logs` keeps endpoint id, route template, status, latency, cache flag, source. No params, keys, cookies, tokens or IPs; 401s are not logged; 7-day retention (`LOG_RETENTION_DAYS`). Uptime counts 5xx and 429 as unhealthy; 4xx such as "user not found" are healthy.

## Batch
`POST /api/batch` `{ "requests": [{ "id", "endpoint" }], "concurrency": 5 }`: max 25 requests, concurrency ≤ 10, 50 s budget. Only GET endpoints under `/api/roblox/*` and `/api/discord/*`; nested batches and internal routes give `ENDPOINT_NOT_ALLOWED` per item. Each result is a full envelope plus `status`.

## Known limits
- Roblox aggressively rate-limits shared datacenter IPs (including Vercel); expect 429s on anonymous traffic.
- Response cache and per-credential counters are per serverless instance.
- Discord member listing needs the Server Members Intent; message `content` needs the Message Content Intent.
- Upstream endpoints can change; fix the handler in the registry.

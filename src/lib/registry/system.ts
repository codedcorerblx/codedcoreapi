import { config } from "../config";
import { snapshot } from "../credentials";
import { batchHandler } from "../batch";
import { arrOf, int, obj, f, str } from "./helpers";
import type { EndpointDefInput } from "./types";

const envelopeNote = "Each value in `results` is a complete standard envelope (success, data, error, nextCursor, metadata) plus the sub-request's HTTP `status`.";

export const systemEndpoints: EndpointDefInput[] = [
  {
    id: "system.batch", service: "system", tag: "Batch", method: "POST", path: "/api/batch",
    summary: "Run several GET requests in one call",
    description: `Executes up to ${config.batchMaxSize} Roblox/Discord GET endpoints concurrently and returns every individual response keyed by your own request id. Each sub-request goes through the exact same pipeline as a direct call: API-key check, validation, upstream rate-limit tracking, credential rotation, caching, de-duplication, retries and timeouts. A failing sub-request never fails the batch.`,
    params: [
      { name: "requests", in: "body", type: "array", required: true, maxItems: config.batchMaxSize,
        description: "Array of { id, endpoint }. `id` (1-64 chars of A-Z a-z 0-9 _ . -) must be unique; `endpoint` is a path like /api/roblox/users/1?x=y.", example: [{ id: "user", endpoint: "/api/roblox/users/1" }] },
      { name: "concurrency", in: "body", type: "integer", min: 1, max: config.batchMaxConcurrency, default: config.batchDefaultConcurrency,
        description: "How many sub-requests run at the same time." },
    ],
    credential: { service: "none", mode: "none" },
    cacheTtl: 0, batchable: false,
    fields: [
      obj("results", "Map of request id → response.", [obj("*", envelopeNote, [
        int("status", "HTTP status the sub-request would have returned."),
        f("success", "boolean", "true when the sub-request succeeded."),
        f("data", "object", "The sub-request's data (any JSON type), or null on failure.", { nullable: true }),
        f("error", "object", "{ code, message } on failure, otherwise null.", { nullable: true }),
        str("nextCursor", "Pagination cursor of the sub-request, if any.", { nullable: true }),
        f("metadata", "object", "Standard metadata of the sub-request."),
      ])]),
      obj("summary", "Aggregate counts.", [int("total", "Requests executed."), int("succeeded", "Sub-requests with status < 400."), int("failed", "Sub-requests with status ≥ 400."), int("concurrency", "Concurrency actually used.")]),
    ],
    example: {
      results: {
        user: { status: 200, success: true, data: { id: 1, name: "Roblox" }, error: null, nextCursor: null, metadata: { timestamp: "2026-01-15T12:00:00.000Z", cached: false, responseTime: 150, requestId: "a1" } },
        missing: { status: 404, success: false, data: null, error: { code: "NOT_FOUND", message: "The user id is invalid." }, nextCursor: null, metadata: { timestamp: "2026-01-15T12:00:00.000Z", responseTime: 90, requestId: "a2" } },
      },
      summary: { total: 2, succeeded: 1, failed: 1, concurrency: 5 },
    },
    bodyExample: { requests: [
      { id: "user", endpoint: "/api/roblox/users/1" },
      { id: "badges", endpoint: "/api/roblox/users/1/badges?limit=10" },
      { id: "discord", endpoint: "/api/discord/users/80351110224678912" },
    ] },
    errors: { ENDPOINT_NOT_ALLOWED: "Reported per sub-request, e.g. for a nested /api/batch call.", PAYLOAD_TOO_LARGE: "Body larger than 256 KB." },
    notes: [
      "Recursive batches and any path outside /api/roblox/* and /api/discord/* are rejected per sub-request with ENDPOINT_NOT_ALLOWED.",
      `Limits: ${config.batchMaxSize} requests per batch, concurrency ≤ ${config.batchMaxConcurrency}, ${config.batchTimeoutMs / 1000}s total. Requests not started before the deadline return UPSTREAM_TIMEOUT.`,
      "The outer response is 200 whenever the batch itself was valid. Inspect each result's `status`.",
    ],
    handler: batchHandler,
  },
  {
    id: "system.credentials", service: "system", tag: "Credentials", method: "GET", path: "/api/credentials",
    summary: "Credential pool and rate-limit state",
    description: "Shows how many Roblox cookies and Discord bot tokens are configured and whether each is ready, cooling down after an upstream 429, or invalid. Secrets, hashes and account identities are never returned; credentials are identified only by their 1-based position in the environment variable.",
    params: [], credential: { service: "none", mode: "none" }, cacheTtl: 0, batchable: false,
    fields: ["roblox", "discord"].map((svc) =>
      obj(svc, `${svc === "roblox" ? "Roblox cookie" : "Discord bot token"} pool.`, [
        int("configured", "Number of credentials found in the environment."),
        str("anonymousFallback", "Which requests may run without a credential."),
        arrOf("credentials", "One entry per credential.", [
          int("index", "1-based position in the environment list."),
          str("state", "ready | cooling_down | invalid | malformed (contains spaces, line breaks or non-ASCII characters; fix the env value)"),
          int("cooldownRemainingSeconds", "Seconds until the credential is usable again (0 when ready)."),
          int("requestsServed", "Requests served by this credential since this server instance started."),
          int("lastStatus", "Last upstream HTTP status seen.", { nullable: true }),
        ]),
      ])),
    example: {
      roblox: { configured: 2, anonymousFallback: "endpoints that are public", credentials: [{ index: 1, state: "ready", cooldownRemainingSeconds: 0, requestsServed: 41, lastStatus: 200 }, { index: 2, state: "cooling_down", cooldownRemainingSeconds: 22, requestsServed: 38, lastStatus: 429 }] },
      discord: { configured: 1, anonymousFallback: "endpoints that are public", credentials: [{ index: 1, state: "ready", cooldownRemainingSeconds: 0, requestsServed: 12, lastStatus: 200 }] },
    },
    notes: ["Counters are per server instance; cooldowns are shared across instances through the database when it is configured."],
    handler: async () => ({ data: { roblox: await snapshot("roblox"), discord: await snapshot("discord") } }),
  },
];

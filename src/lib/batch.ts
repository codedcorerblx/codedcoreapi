import { config } from "./config";
import { ApiError, toApiError } from "./errors";
import { errorBody } from "./envelope";
import { execute, type ExecResult } from "./pipeline";
import { matchEndpoint } from "./registry";
import { queryRecord } from "./http";
import type { HandlerContext, SingleResult } from "./registry";

interface SubRequest { id: string; endpoint: string }

function parseSub(raw: unknown, i: number): SubRequest {
  if (!raw || typeof raw !== "object") throw new ApiError("INVALID_REQUEST", `requests[${i}] must be an object`);
  const { id, endpoint } = raw as Record<string, unknown>;
  if (typeof id !== "string" || !/^[A-Za-z0-9_.-]{1,64}$/.test(id))
    throw new ApiError("INVALID_REQUEST", `requests[${i}].id must be 1-64 characters of A-Z a-z 0-9 _ . -`);
  if (typeof endpoint !== "string" || endpoint.length > 2048) throw new ApiError("INVALID_REQUEST", `requests[${i}].endpoint must be a string`);
  return { id, endpoint };
}

export async function batchHandler(ctx: HandlerContext): Promise<SingleResult> {
  const body = ctx.body as { requests?: unknown; concurrency?: number };
  if (!Array.isArray(body.requests) || body.requests.length === 0) throw new ApiError("INVALID_REQUEST", "requests must be a non-empty array");
  if (body.requests.length > config.batchMaxSize) throw new ApiError("INVALID_REQUEST", `A batch may contain at most ${config.batchMaxSize} requests`);
  const subs = body.requests.map(parseSub);
  const ids = new Set<string>();
  for (const s of subs) { if (ids.has(s.id)) throw new ApiError("INVALID_REQUEST", `Duplicate request id "${s.id}"`); ids.add(s.id); }
  const concurrency = Math.min(body.concurrency ?? config.batchDefaultConcurrency, config.batchMaxConcurrency);

  const deadline = Date.now() + config.batchTimeoutMs;
  const results: Record<string, { status: number } & Record<string, unknown>> = {};

  const run = async (s: SubRequest): Promise<ExecResult> => {
    const t0 = performance.now();
    const failWith = (err: ApiError): ExecResult => ({
      status: err.status, logs: [], headers: {},
      body: errorBody(err, { responseTime: Math.round(performance.now() - t0), requestId: crypto.randomUUID() }),
    });
    if (Date.now() > deadline) return failWith(new ApiError("UPSTREAM_TIMEOUT", "Batch time limit reached before this request started"));
    let url: URL;
    try { url = new URL(s.endpoint, "http://batch.internal"); } catch { return failWith(new ApiError("INVALID_REQUEST", "endpoint is not a valid path")); }
    if (/^\/api\/batch\/?$/.test(url.pathname)) return failWith(new ApiError("ENDPOINT_NOT_ALLOWED", "Recursive batch requests are not allowed"));
    if (!/^\/api\/(roblox|discord)\//.test(url.pathname)) return failWith(new ApiError("ENDPOINT_NOT_ALLOWED", "Only /api/roblox/* and /api/discord/* endpoints can be batched"));
    const m = matchEndpoint("GET", url.pathname);
    if (m.kind !== "ok") return failWith(new ApiError(m.kind === "method" ? "ENDPOINT_NOT_ALLOWED" : "NOT_FOUND", m.kind === "method" ? "Only GET endpoints can be batched" : `No endpoint at ${url.pathname}`));
    if (!m.def.batchable) return failWith(new ApiError("ENDPOINT_NOT_ALLOWED", "This endpoint cannot be batched"));
    // Same pipeline as a direct call: authentication, validation, cache, de-duplication, retries, timeouts.
    return execute(m.def, { params: m.params, query: queryRecord(url.searchParams) }, { source: "batch", apiKey: ctx.apiKey });
  };

  let next = 0;
  const worker = async () => {
    while (next < subs.length) {
      const s = subs[next++];
      let r: ExecResult;
      try { r = await run(s); } catch (e) {
        const err = toApiError(e);
        r = { status: err.status, logs: [], headers: {}, body: errorBody(err, { responseTime: 0, requestId: crypto.randomUUID() }) };
      }
      r.logs.forEach(ctx.emitLog);
      results[s.id] = { status: r.status, ...(r.body as unknown as Record<string, unknown>) };
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, subs.length) }, worker));

  const ordered: typeof results = {};
  for (const s of subs) ordered[s.id] = results[s.id];
  const succeeded = Object.values(ordered).filter((r) => r.status < 400).length;
  return { data: { results: ordered, summary: { total: subs.length, succeeded, failed: subs.length - succeeded, concurrency } } };
}

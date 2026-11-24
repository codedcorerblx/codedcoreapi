import { config } from "./config";
import { verifyApiKey } from "./auth";
import { ApiError } from "./errors";
import { errorBody, jsonResponse } from "./envelope";
import { matchEndpoint } from "./registry";
import { execute, type RawInput, type Source } from "./pipeline";
import { track } from "./analytics";
import { queryRecord } from "./http";

const reqId = (req: Request) => {
  const h = req.headers.get("x-request-id");
  return h && /^[A-Za-z0-9._-]{1,64}$/.test(h) ? h : undefined;
};

/** HTTP entry for every /api/** route. */
export async function handleRequest(req: Request, source: Source = "direct"): Promise<Response> {
  const t0 = performance.now();
  const requestId = reqId(req) ?? crypto.randomUUID();
  const fail = (err: ApiError, extra: Record<string, string> = {}) =>
    jsonResponse(errorBody(err, { responseTime: Math.round(performance.now() - t0), requestId }), err.status, { "x-request-id": requestId, ...extra });

  const apiKey = req.headers.get("x-api-key");
  const authErr = verifyApiKey(apiKey);           // authenticate before revealing anything about routes
  if (authErr) return fail(authErr);

  const url = new URL(req.url);
  const m = matchEndpoint(req.method, url.pathname);
  if (m.kind === "none") return fail(new ApiError("NOT_FOUND", `No endpoint at ${url.pathname}`));
  if (m.kind === "method") return fail(new ApiError("METHOD_NOT_ALLOWED", `Use ${m.allow.join(" or ")} for this endpoint`), { allow: m.allow.join(", ") });

  let body: unknown;
  if (m.def.method === "POST") {
    const text = await req.text();
    if (text.length > config.maxBodyBytes) return fail(new ApiError("PAYLOAD_TOO_LARGE", "Request body is too large"));
    try { body = text ? JSON.parse(text) : undefined; } catch { return fail(new ApiError("INVALID_REQUEST", "Body must be valid JSON")); }
  }
  const raw: RawInput = { params: m.params, query: queryRecord(url.searchParams), body };
  const res = await execute(m.def, raw, { source, apiKey, requestId });
  track(res.logs);
  return jsonResponse(res.body, res.status, res.headers);
}

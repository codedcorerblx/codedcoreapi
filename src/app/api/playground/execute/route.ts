import { SESSION_COOKIE, readCookie, verifySessionToken } from "@/lib/auth";
import { config } from "@/lib/config";
import { ApiError } from "@/lib/errors";
import { errorBody, jsonResponse } from "@/lib/envelope";
import { byId } from "@/lib/registry";
import { handleRequest } from "@/lib/dispatch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const FORBIDDEN_HEADERS = new Set(["x-api-key", "authorization", "cookie", "host", "content-length", "connection", "transfer-encoding", "upgrade", "origin", "referer"]);
const meta = { responseTime: 0, requestId: "playground" };
const fail = (e: ApiError) => jsonResponse(errorBody(e, meta), e.status);

/**
 * Server-side executor. The browser never sees the API key: this handler checks the signed session cookie,
 * then calls the real API pipeline with the key injected server-side.
 */
export async function POST(req: Request) {
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(req.url).host) return fail(new ApiError("UNAUTHORIZED", "Cross-origin requests are not allowed"));
  if (!verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE))) return fail(new ApiError("UNAUTHORIZED", "Playground is locked. Unlock it with the API key."));

  let input: { endpointId?: string; pathParams?: Record<string, string>; query?: Record<string, string>; body?: unknown; headers?: Record<string, string> };
  try { input = await req.json(); } catch { return fail(new ApiError("INVALID_REQUEST", "Body must be JSON")); }
  const def = input.endpointId ? byId.get(input.endpointId) : undefined;
  if (!def) return fail(new ApiError("NOT_FOUND", "Unknown endpoint id"));

  let path = def.path;
  for (const [k, v] of Object.entries(input.pathParams ?? {})) path = path.replace(`{${k}}`, encodeURIComponent(String(v)));
  if (/\{[^}]+\}/.test(path)) return fail(new ApiError("INVALID_REQUEST", "Fill in every path parameter"));
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(input.query ?? {})) if (v !== "" && v !== undefined) qs.set(k, String(v));

  const headers = new Headers();
  for (const [k, v] of Object.entries(input.headers ?? {})) {
    if (!/^[A-Za-z0-9-]{1,64}$/.test(k) || FORBIDDEN_HEADERS.has(k.toLowerCase()) || String(v).length > 512) continue;
    headers.set(k, String(v));
  }
  headers.set("x-api-key", config.apiSecret);
  if (def.method === "POST") headers.set("content-type", "application/json");

  const inner = new Request(`http://playground.internal${path}${qs.size ? "?" + qs : ""}`, {
    method: def.method, headers, body: def.method === "POST" ? JSON.stringify(input.body ?? {}) : undefined,
  });
  const t0 = performance.now();
  const res = await handleRequest(inner, "playground");
  const text = await res.text();
  const outHeaders: Record<string, string> = {};
  res.headers.forEach((v, k) => { outHeaders[k] = v; });
  return jsonResponse({ status: res.status, statusText: res.statusText || "", durationMs: Math.round(performance.now() - t0), headers: outHeaders, body: text,
    requestPath: path + (qs.size ? "?" + qs : "") }, 200);
}

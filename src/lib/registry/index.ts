import { ERROR_INFO, type ErrorCode } from "../errors";
import { robloxEndpoints } from "./roblox";
import { discordEndpoints } from "./discord";
import { systemEndpoints } from "./system";
import type { EndpointDef, EndpointDefInput, FieldDef, ParamDef, PublicEndpoint } from "./types";

export * from "./types";

function normalise(d: EndpointDefInput): EndpointDef {
  const params = [...d.params];
  if (d.pagination) {
    const max = d.pagination.allowed ? Math.max(...d.pagination.allowed) : d.pagination.max;
    params.push(
      { name: "limit", in: "query", type: "integer", min: 1, max, default: d.pagination.default,
        description: `Items per upstream page (max ${max}).${d.pagination.allowed ? ` Upstream only accepts ${d.pagination.allowed.join(", ")}; other values snap down.` : ""}` },
      { name: "cursor", in: "query", type: "string", maxLength: 2048,
        description: `Omit for the first page. Pass the previous response's nextCursor to continue. ${d.pagination.cursorNote} Use cursor=auto to follow every cursor and return one combined array (bounded by time, page and item caps).` },
      { name: "maxItems", in: "query", type: "integer", min: 1,
        description: "Only with cursor=auto: stop once at least this many items are collected (may overshoot by up to one page). The server-side cap always applies." },
    );
  }
  const codes: Record<string, string | undefined> = {};
  const add = (c: ErrorCode, note?: string) => { if (!(c in codes) || note) codes[c] = note ?? codes[c]; };
  add("UNAUTHORIZED");
  if (params.length || d.method === "POST") add("INVALID_REQUEST");
  Object.entries(d.errors ?? {}).forEach(([c, n]) => add(c as ErrorCode, n));
  if (d.credential.service !== "none") { add("RATE_LIMITED"); add("CREDENTIALS_UNAVAILABLE"); add("UPSTREAM_ERROR"); add("UPSTREAM_TIMEOUT"); }
  add("INTERNAL_ERROR");
  return {
    ...d, params,
    isList: Boolean(d.list),
    errorCodes: Object.entries(codes).map(([code, note]) => ({ code: code as ErrorCode, note })),
  };
}

export const endpoints: EndpointDef[] = [...systemEndpoints, ...robloxEndpoints, ...discordEndpoints].map(normalise);
export const byId = new Map(endpoints.map((e) => [e.id, e]));

export function toPublic(d: EndpointDef): PublicEndpoint {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { handler, list, ...rest } = d;
  return rest;
}
export const publicEndpoints = (): PublicEndpoint[] => endpoints.map(toPublic);

/* ── routing ── */
const compiled = endpoints.map((def) => ({ def, segs: def.path.split("/").filter(Boolean) }));

export type Match =
  | { kind: "ok"; def: EndpointDef; params: Record<string, string> }
  | { kind: "method"; allow: string[] }
  | { kind: "none" };

export function matchEndpoint(method: string, pathname: string): Match {
  const segs = pathname.replace(/\/+$/, "").split("/").filter(Boolean);
  const hits: { def: EndpointDef; params: Record<string, string>; statics: number }[] = [];
  for (const c of compiled) {
    if (c.segs.length !== segs.length) continue;
    const params: Record<string, string> = {};
    let statics = 0, ok = true;
    for (let i = 0; i < segs.length && ok; i++) {
      const t = c.segs[i];
      if (t.startsWith("{")) {
        try { params[t.slice(1, -1)] = decodeURIComponent(segs[i]); } catch { ok = false; }
      } else if (t === segs[i]) statics++;
      else ok = false;
    }
    if (ok) hits.push({ def: c.def, params, statics });
  }
  hits.sort((a, b) => b.statics - a.statics);
  const exact = hits.find((h) => h.def.method === method.toUpperCase());
  if (exact) return { kind: "ok", def: exact.def, params: exact.params };
  return hits.length ? { kind: "method", allow: [...new Set(hits.map((h) => h.def.method))] } : { kind: "none" };
}

/* ── shared documentation helpers (docs, OpenAPI, playground all use these) ── */
export function flattenFields(fields: FieldDef[], prefix: string): { path: string; field: FieldDef }[] {
  return fields.flatMap((f) => {
    const path = `${prefix}.${f.name}`;
    const row = { path, field: f };
    if (!f.children || f.name === "*") return [row];
    return [row, ...flattenFields(f.children, f.type === "array" ? `${path}[]` : path)];
  });
}

export const EXAMPLE_TS = "2026-01-15T12:00:00.000Z";
export function exampleEnvelope(d: PublicEndpoint | EndpointDef) {
  return {
    success: true,
    data: d.example,
    error: null,
    nextCursor: d.pagination ? "eyJrZXkiOiJ2YWx1ZSJ9" : null,
    metadata: {
      timestamp: EXAMPLE_TS, cached: false, responseTime: 184,
      requestId: "7b0c1d52-8e6a-4c0e-9d51-3f2a6a1c9e10",
      availability: "available",
      ...(Array.isArray(d.example) ? { count: d.example.length } : {}),
      ...(d.pagination ? { pagination: { mode: "manual", pages: 1, itemCount: Array.isArray(d.example) ? d.example.length : 0, truncated: false, reason: null } } : {}),
    },
  };
}
export const exampleError = (code: ErrorCode) => ({
  success: false, data: null, error: { code, message: ERROR_INFO[code].description }, nextCursor: null,
  metadata: { timestamp: EXAMPLE_TS, responseTime: 42, requestId: "7b0c1d52-8e6a-4c0e-9d51-3f2a6a1c9e10" },
});

export function exampleUrl(d: PublicEndpoint | EndpointDef, base: string): string {
  let p = d.path;
  const q: string[] = [];
  for (const prm of d.params as ParamDef[]) {
    if (prm.in === "path") p = p.replace(`{${prm.name}}`, String(prm.example ?? "1"));
    else if (prm.in === "query" && prm.required) q.push(`${prm.name}=${encodeURIComponent(String(Array.isArray(prm.example) ? prm.example.join(",") : prm.example ?? ""))}`);
  }
  return base + p + (q.length ? "?" + q.join("&") : "");
}
export function exampleCurl(d: PublicEndpoint | EndpointDef, base: string): string {
  const url = exampleUrl(d, base);
  if (d.method === "POST")
    return `curl -X POST '${url}' \\\n  -H 'x-api-key: YOUR_API_KEY' \\\n  -H 'content-type: application/json' \\\n  -d '${JSON.stringify(d.bodyExample ?? {})}'`;
  return `curl '${url}' \\\n  -H 'x-api-key: YOUR_API_KEY'`;
}

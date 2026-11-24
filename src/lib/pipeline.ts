import { config } from "./config";
import { verifyApiKey } from "./auth";
import { ApiError, toApiError } from "./errors";
import { errorBody, successBody, type ApiBody, type PaginationMeta } from "./envelope";
import { cacheGet, cacheSet, dedupe } from "./cache";
import { resolveIdentity } from "./resolve";
import type { EndpointDef, HandlerContext, ParamDef, PaginationDef } from "./registry";

export type Source = "direct" | "batch" | "playground";
export interface LogEntry {
  endpointId: string; method: string; route: string; status: number; success: boolean;
  errorCode: string | null; latencyMs: number; cached: boolean; source: Source;
}
export interface RawInput {
  params: Record<string, string>;
  query: Record<string, string | string[]>;
  body?: unknown;
}
export interface ExecOptions { source: Source; apiKey: string | null; requestId?: string }
export interface ExecResult { status: number; body: ApiBody; headers: Record<string, string>; logs: LogEntry[] }

interface Computed {
  data: unknown; nextCursor: string | null;
  availability: "available" | "empty" | "partial";
  pagination?: PaginationMeta;
  cacheable: boolean;
}

/* ───────────── validation (driven entirely by the registry's ParamDefs) ───────────── */
type Coerced = { ok: true; value: unknown } | { ok: false; message: string };
const bad = (message: string): Coerced => ({ ok: false, message });

function coerceScalar(p: ParamDef, type: string, v: string): Coerced {
  if (type === "integer") {
    if (!/^-?\d+$/.test(v) || !Number.isSafeInteger(Number(v))) return bad("must be an integer");
    const n = Number(v);
    if (p.enum && !p.enum.includes(v)) return bad(`must be one of: ${p.enum.join(", ")}`);
    if (p.min !== undefined && n < p.min) return bad(`must be ≥ ${p.min}`);
    if (p.max !== undefined && n > p.max) return bad(`must be ≤ ${p.max}`);
    return { ok: true, value: n };
  }
  if (type === "number") {
    const n = Number(v);
    return Number.isFinite(n) && v.trim() !== "" ? { ok: true, value: n } : bad("must be a number");
  }
  if (type === "boolean") return v === "true" || v === "false" ? { ok: true, value: v === "true" } : bad("must be true or false");
  if (p.maxLength !== undefined && v.length > p.maxLength) return bad(`must be at most ${p.maxLength} characters`);
  if (p.enum && !p.enum.includes(v)) return bad(`must be one of: ${p.enum.join(", ")}`);
  if (p.pattern && !new RegExp(p.pattern).test(v)) return bad(`must match ${p.pattern}`);
  return { ok: true, value: v };
}

function coerceQuery(p: ParamDef, raw: string | string[]): Coerced {
  if (p.type !== "array") return coerceScalar(p, p.type, Array.isArray(raw) ? raw[raw.length - 1] : raw);
  const parts = (Array.isArray(raw) ? raw : [raw]).flatMap((s) => s.split(",")).map((s) => s.trim()).filter(Boolean);
  if (!parts.length) return bad("must contain at least one value");
  if (p.maxItems && parts.length > p.maxItems) return bad(`accepts at most ${p.maxItems} values`);
  const out: unknown[] = [];
  for (const part of parts) {
    const r = coerceScalar({ ...p, min: p.min, max: p.max }, p.items ?? "string", part);
    if (!r.ok) return bad(`item "${part.slice(0, 40)}" ${r.message}`);
    out.push(r.value);
  }
  return { ok: true, value: out };
}

function checkBodyValue(p: ParamDef, v: unknown): string | null {
  switch (p.type) {
    case "string": if (typeof v !== "string") return "must be a string"; if (p.enum && !p.enum.includes(v)) return `must be one of: ${p.enum.join(", ")}`; return null;
    case "integer": if (!Number.isInteger(v)) return "must be an integer"; if (p.min !== undefined && (v as number) < p.min) return `must be ≥ ${p.min}`; if (p.max !== undefined && (v as number) > p.max) return `must be ≤ ${p.max}`; return null;
    case "number": return typeof v === "number" && Number.isFinite(v) ? null : "must be a number";
    case "boolean": return typeof v === "boolean" ? null : "must be a boolean";
    case "array": if (!Array.isArray(v)) return "must be an array"; if (p.maxItems && v.length > p.maxItems) return `accepts at most ${p.maxItems} items`; return null;
    case "object": return v && typeof v === "object" && !Array.isArray(v) ? null : "must be an object";
  }
}

export function validateInput(def: EndpointDef, raw: RawInput) {
  const params: Record<string, string> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query: Record<string, any> = {};
  const issues: { param: string; message: string }[] = [];
  const known = new Set(def.params.filter((p) => p.in === "query").map((p) => p.name));
  for (const k of Object.keys(raw.query)) if (!known.has(k)) issues.push({ param: k, message: "Unknown query parameter" });

  for (const p of def.params) {
    if (p.in === "path") {
      const r = coerceScalar(p, p.type, raw.params[p.name] ?? "");
      r.ok ? (params[p.name] = String(r.value)) : issues.push({ param: p.name, message: r.message });
    } else if (p.in === "query") {
      const v = raw.query[p.name];
      if (v === undefined || v === "" || (Array.isArray(v) && v.length === 0)) {
        if (p.required) issues.push({ param: p.name, message: "Required" });
        else if (p.default !== undefined) query[p.name] = p.default;
        continue;
      }
      const r = coerceQuery(p, v);
      r.ok ? (query[p.name] = r.value) : issues.push({ param: p.name, message: r.message });
    } else {
      const b = raw.body && typeof raw.body === "object" ? (raw.body as Record<string, unknown>) : null;
      if (!b) { if (p.required && !issues.some((i) => i.param === "body")) issues.push({ param: "body", message: "A JSON object body is required" }); continue; }
      const v = b[p.name];
      if (v === undefined || v === null) { if (p.required) issues.push({ param: p.name, message: "Required" }); continue; }
      const m = checkBodyValue(p, v);
      if (m) issues.push({ param: p.name, message: m });
    }
  }
  if (issues.length) throw new ApiError("INVALID_REQUEST", "Request validation failed", { details: issues });
  return { params, query, body: raw.body };
}

/* ───────────── pagination ───────────── */
function resolveLimit(p: PaginationDef, requested: number | undefined, auto: boolean): number {
  const max = p.allowed ? Math.max(...p.allowed) : p.max;
  let l = Math.min(Math.max(1, requested ?? (auto ? max : p.default)), max);
  if (p.allowed) { const ok = p.allowed.filter((a) => a <= l); l = ok.length ? Math.max(...ok) : Math.min(...p.allowed); }
  return l;
}

async function compute(def: EndpointDef, ctx: HandlerContext): Promise<Computed> {
  if (!def.isList) {
    const r = await def.handler!(ctx);
    const empty = Array.isArray(r.data) && r.data.length === 0;
    return { data: r.data, nextCursor: null, availability: r.availability ?? (empty ? "empty" : "available"), cacheable: true };
  }
  const pag = def.pagination!;
  const auto = ctx.query.cursor === "auto";
  const limit = resolveLimit(pag, ctx.query.limit, auto);
  const start = Date.now();

  if (!auto) {
    const page = await def.list!(ctx, { cursor: (ctx.query.cursor as string) ?? null, limit });
    return {
      data: page.items, nextCursor: page.nextCursor, availability: page.items.length ? "available" : "empty", cacheable: true,
      pagination: { mode: "manual", pages: 1, itemCount: page.items.length, truncated: false, reason: null },
    };
  }
  const cap = Math.min(ctx.query.maxItems ?? Infinity, config.autoMaxItems);
  const items: unknown[] = [];
  let cursor: string | null = null, pages = 0, reason: string | null = null, partial = false;
  for (;;) {
    try {
      const page = await def.list!(ctx, { cursor, limit });
      items.push(...page.items);
      cursor = page.nextCursor;
      pages++;
    } catch (e) {
      if (pages === 0) throw e; // nothing collected: surface the real error
      reason = toApiError(e).code; partial = true; break;   // keep what we have, resume with nextCursor
    }
    if (!cursor) break;
    if (items.length >= cap) { reason = "MAX_ITEMS"; break; }
    if (pages >= config.autoMaxPages) { reason = "MAX_PAGES"; break; }
    if (Date.now() - start > config.autoTimeoutMs) { reason = "TIMEOUT"; break; }
  }
  const truncated = reason !== null;
  return {
    data: items, nextCursor: truncated ? cursor : null,
    availability: partial ? "partial" : items.length ? "available" : "empty",
    cacheable: !partial,
    pagination: { mode: "auto", pages, itemCount: items.length, truncated, reason },
  };
}

const stable = (o: Record<string, unknown>) => JSON.stringify(Object.keys(o).sort().map((k) => [k, o[k]]));

/* ───────────── the single execution path (direct, batch and playground all use it) ───────────── */
export async function execute(def: EndpointDef, raw: RawInput, opts: ExecOptions): Promise<ExecResult> {
  const t0 = performance.now();
  const requestId = opts.requestId ?? crypto.randomUUID();
  const logs: LogEntry[] = [];
  let status = 200, cached = false, errorCode: string | null = null;
  let body: ApiBody;
  let resolved: { param: string; input: string; id: string } | undefined;
  const extra: Record<string, string> = {};

  try {
    const authErr = verifyApiKey(opts.apiKey);   // every request, sub-requests included
    if (authErr) throw authErr;
    const v = validateInput(def, raw);
    for (const p of def.params) {
      if (p.in !== "path" || !p.resolve) continue;
      const input = v.params[p.name];
      const r = await resolveIdentity(p.resolve, input, v);
      if (r.via === "username") { v.params[p.name] = r.id; resolved = { param: p.name, input, id: r.id }; }
      else v.params[p.name] = input.replace(/^@/, "");
    }
    const ctx: HandlerContext = { ...v, requestId, apiKey: opts.apiKey, source: opts.source, emitLog: (e) => logs.push(e) };
    const key = `${def.id}|${stable(v.params)}|${stable(v.query)}`;
    let value = def.cacheTtl > 0 ? cacheGet<Computed>(key) : undefined;
    if (value) cached = true;
    else {
      value = def.cacheTtl > 0 ? await dedupe(key, () => compute(def, ctx)) : await compute(def, ctx);
      if (def.cacheTtl > 0 && value.cacheable) cacheSet(key, value, def.cacheTtl);
    }
    body = successBody(value.data, value.nextCursor, {
      cached, responseTime: 0, requestId, availability: value.availability, ...(value.pagination ? { pagination: value.pagination } : {}), ...(resolved ? { resolved } : {}),
    });
  } catch (e) {
    const err = toApiError(e);
    status = err.status; errorCode = err.code;
    if (err.retryAfter) extra["retry-after"] = String(err.retryAfter);
    body = errorBody(err, { responseTime: 0, requestId });
  }
  const latencyMs = Math.round(performance.now() - t0);
  body.metadata.responseTime = latencyMs;
  // 401s are not logged: unauthenticated noise must not be able to fill the database.
  if (errorCode !== "UNAUTHORIZED" && errorCode !== "CONFIG_ERROR")
    logs.push({ endpointId: def.id, method: def.method, route: def.path, status, success: status < 400, errorCode, latencyMs, cached, source: opts.source });
  return {
    status, body, logs,
    headers: { "x-request-id": requestId, "x-response-time": `${latencyMs}ms`, "x-cache": cached ? "HIT" : "MISS", ...extra },
  };
}

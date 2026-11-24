import { ApiError } from "./errors";

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
export const backoff = (attempt: number) => Math.min(2000, 250 * 2 ** attempt) + Math.random() * 150;

export async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal, cache: "no-store" });
  } catch (e) {
    if (ctrl.signal.aborted) throw new ApiError("UPSTREAM_TIMEOUT", `Upstream did not respond within ${timeoutMs}ms`);
    // Surface the low-level cause code (ECONNRESET, ENOTFOUND, UND_ERR_CONNECT_TIMEOUT, CERT_*, ...). No URLs or secrets.
    const cause = (e as { cause?: { code?: string; message?: string } })?.cause;
    const code = cause?.code ?? (e instanceof Error ? e.name : "unknown");
    console.error(`[upstream] network failure host=${new URL(url).host} cause=${code} detail=${String(cause?.message ?? (e as Error)?.message ?? "").slice(0, 160)}`);
    throw new ApiError("UPSTREAM_ERROR", `Could not reach the upstream API (${code})`, { details: { cause: code } });
  } finally {
    clearTimeout(timer);
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function readJson(res: Response): Promise<any> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

export function buildUrl(base: string, query?: Record<string, unknown>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === "") continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(",") : String(v));
  }
  return u.toString();
}

/** Upstream error bodies are public API text, never credentials. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function upstreamMessage(body: any, fallback: string): string {
  const m = body?.errors?.[0]?.message ?? body?.message ?? body?.error;
  return typeof m === "string" && m.length < 300 ? m : fallback;
}

/** Fetch a CDN image and return Base64. Host allow-list prevents SSRF. */
const IMAGE_HOSTS = [/(^|\.)rbxcdn\.com$/, /^cdn\.discordapp\.com$/, /^media\.discordapp\.net$/];
export async function fetchImageBase64(url: string, maxBytes: number, timeoutMs: number) {
  const u = new URL(url);
  if (u.protocol !== "https:" || !IMAGE_HOSTS.some((re) => re.test(u.hostname)))
    throw new ApiError("UNSUPPORTED", "Image host is not on the allow-list");
  const res = await fetchWithTimeout(u.toString(), {}, timeoutMs);
  if (!res.ok) throw new ApiError("UPSTREAM_ERROR", `Image CDN returned HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > maxBytes) throw new ApiError("UNSUPPORTED", "Image exceeds the Base64 size limit");
  return { contentType: res.headers.get("content-type") ?? "application/octet-stream", bytes: buf.length, data: buf.toString("base64") };
}

export function queryRecord(sp: URLSearchParams): Record<string, string | string[]> {
  const out: Record<string, string | string[]> = {};
  for (const k of new Set(sp.keys())) { const all = sp.getAll(k); out[k] = all.length > 1 ? all : all[0]; }
  return out;
}

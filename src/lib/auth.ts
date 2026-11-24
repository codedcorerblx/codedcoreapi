import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { ApiError } from "./errors";

const digest = (v: string) => createHash("sha256").update(v).digest();

/** Constant-time check of the single global API key. Returns an error, or null when valid. */
export function verifyApiKey(presented: string | null | undefined): ApiError | null {
  const secret = config.apiSecret;
  if (!secret) return new ApiError("CONFIG_ERROR", "API_SECRET is not configured on the server");
  if (!presented) return new ApiError("UNAUTHORIZED", "Missing x-api-key header");
  return timingSafeEqual(digest(presented), digest(secret))
    ? null
    : new ApiError("UNAUTHORIZED", "Invalid API key");
}

/* ── Playground session: a signed, expiring, HttpOnly cookie. The API key itself is never stored client-side. ── */
export const SESSION_COOKIE = "pg_session";
export const SESSION_TTL_S = 60 * 60;
const sign = (exp: string) => createHmac("sha256", "playground-session:" + config.apiSecret).update(exp).digest("base64url");

export function createSessionToken(): string {
  const exp = String(Math.floor(Date.now() / 1000) + SESSION_TTL_S);
  return `${exp}.${sign(exp)}`;
}

export function verifySessionToken(token: string | undefined): boolean {
  if (!token || !config.apiSecret) return false;
  const [exp, sig] = token.split(".");
  if (!exp || !sig || Number(exp) < Date.now() / 1000) return false;
  const a = Buffer.from(sig);
  const b = Buffer.from(sign(exp));
  return a.length === b.length && timingSafeEqual(a, b);
}

export function readCookie(header: string | null, name: string): string | undefined {
  return header
    ?.split(";")
    .map((c) => c.trim())
    .find((c) => c.startsWith(name + "="))
    ?.slice(name.length + 1);
}

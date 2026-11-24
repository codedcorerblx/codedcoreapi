import { ApiError, type ErrorCode } from "../errors";
import { config } from "../config";
import { acquire, markCooldown, markInvalid, credentialCount } from "../credentials";
import { backoff, buildUrl, fetchWithTimeout, readJson, sleep, upstreamMessage } from "../http";

const HOSTS = {
  users: "https://users.roblox.com",
  friends: "https://friends.roblox.com",
  groups: "https://groups.roblox.com",
  badges: "https://badges.roblox.com",
  inventory: "https://inventory.roblox.com",
  games: "https://games.roblox.com",
  avatar: "https://avatar.roblox.com",
  thumbnails: "https://thumbnails.roblox.com",
  presence: "https://presence.roblox.com",
  apis: "https://apis.roblox.com",
} as const;
export type RobloxHost = keyof typeof HOSTS;

export interface RobloxOpts {
  /** none: never send a cookie · optional: rotate cookies, fall back to anonymous · required: cookie mandatory */
  auth?: "none" | "optional" | "required";
  method?: "GET" | "POST";
  body?: unknown;
  /** How to report an upstream 403 (default FORBIDDEN). */
  forbiddenAs?: ErrorCode;
  notFound?: string;
}

let csrf = "";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function robloxRequest(host: RobloxHost, path: string, query?: Record<string, unknown>, opts: RobloxOpts = {}): Promise<any> {
  const auth = opts.auth ?? "optional";
  const url = buildUrl(HOSTS[host] + path, query);
  const method = opts.method ?? "GET";
  const maxAttempts = config.upstreamRetries + credentialCount("roblox") + 2;
  let lastErr: ApiError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { cred, waitMs, configured } = await acquire("roblox", { allowAnonymous: auth === "optional" || auth === "none" });
    if (auth === "required" && configured === 0)
      throw new ApiError("CREDENTIALS_UNAVAILABLE", "This endpoint needs a Roblox cookie. Set ROBLOX_COOKIES.");
    if (!cred) {
      if (waitMs > 0 && waitMs <= 1500) { await sleep(waitMs); continue; }
      throw lastErr ?? new ApiError(waitMs > 0 ? "RATE_LIMITED" : "CREDENTIALS_UNAVAILABLE",
        waitMs > 0 ? "All Roblox credentials are rate limited" : "All Roblox credentials are invalid", { retryAfter: Math.ceil(waitMs / 1000) || undefined });
    }
    const useCookie = auth !== "none" && cred.secret !== "";
    const headers: Record<string, string> = { accept: "application/json" };
    if (useCookie) headers.cookie = `.ROBLOSECURITY=${cred.secret}`;
    if (method === "POST") { headers["content-type"] = "application/json"; if (csrf) headers["x-csrf-token"] = csrf; }

    let res: Response;
    try {
      res = await fetchWithTimeout(url, { method, headers, body: opts.body ? JSON.stringify(opts.body) : undefined }, config.upstreamTimeoutMs);
    } catch (e) {
      lastErr = e as ApiError;
      if (attempt < config.upstreamRetries) { await sleep(backoff(attempt)); continue; }
      throw lastErr;
    }
    cred.lastStatus = res.status;
    if (res.ok) return readJson(res);

    const body = await readJson(res);
    const msg = upstreamMessage(body, `Roblox returned HTTP ${res.status}`);
    if (res.status === 403 && method === "POST" && res.headers.get("x-csrf-token")) { csrf = res.headers.get("x-csrf-token")!; continue; }
    if (res.status === 429) {
      const ra = Number(res.headers.get("retry-after") ?? res.headers.get("x-ratelimit-reset") ?? 30);
      markCooldown(cred, (Number.isFinite(ra) && ra > 0 ? ra : 30) * 1000);
      lastErr = new ApiError("RATE_LIMITED", "Roblox rate limited the request", { retryAfter: Math.ceil(ra) || 30 });
      continue; // rotate to another credential (or the anonymous slot)
    }
    if (res.status === 401) {
      if (cred.secret) { markInvalid(cred); lastErr = new ApiError("CREDENTIALS_UNAVAILABLE", "A Roblox cookie was rejected as invalid"); continue; }
      throw new ApiError("CREDENTIALS_UNAVAILABLE", "This endpoint needs a Roblox cookie. Set ROBLOX_COOKIES.");
    }
    if (res.status >= 500) { lastErr = new ApiError("UPSTREAM_ERROR", msg); if (attempt < config.upstreamRetries) { await sleep(backoff(attempt)); continue; } throw lastErr; }
    if (res.status === 404) throw new ApiError("NOT_FOUND", opts.notFound ?? msg);
    if (res.status === 403) throw new ApiError(opts.forbiddenAs ?? "FORBIDDEN", msg);
    if (res.status === 400) throw new ApiError("INVALID_REQUEST", msg);
    throw new ApiError("UPSTREAM_ERROR", msg);
  }
  throw lastErr ?? new ApiError("UPSTREAM_ERROR", "Roblox request failed");
}

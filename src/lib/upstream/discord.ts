import { ApiError, type ErrorCode } from "../errors";
import { config } from "../config";
import { acquire, markBucket, markCooldown, markInvalid, credentialCount } from "../credentials";
import { backoff, buildUrl, fetchWithTimeout, readJson, sleep, upstreamMessage } from "../http";

const API = "https://discord.com/api/v10";

export interface DiscordOpts {
  /** bot: token required · optional: token preferred, anonymous allowed · none: never send a token */
  auth?: "bot" | "optional" | "none";
  /** On 403 / unknown-guild-or-channel, retry with the next bot (a different bot may be a member). */
  fallbackOnAccess?: boolean;
  /** Prefer a specific 1-based credential index. */
  prefer?: number;
  forbiddenAs?: ErrorCode;
}

const NOT_FOUND_CODES = new Set([10003, 10004, 10006, 10007, 10008, 10013]);
const routeKeyOf = (path: string) => path.replace(/\d{15,21}/g, ":id");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function discordRequest(path: string, query?: Record<string, unknown>, opts: DiscordOpts = {}): Promise<any> {
  const auth = opts.auth ?? "bot";
  const url = buildUrl(API + path, query);
  const routeKey = routeKeyOf(path);
  const tried = new Set<number>();
  const maxAttempts = config.upstreamRetries + credentialCount("discord") + 2;
  let lastErr: ApiError | null = null;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const { cred, waitMs, configured } = await acquire("discord", {
      exclude: tried, routeKey, prefer: opts.prefer, allowAnonymous: auth !== "bot",
    });
    if (auth === "bot" && configured === 0) throw new ApiError("CREDENTIALS_UNAVAILABLE", "No Discord bot token configured. Set DISCORD_BOT_TOKENS.");
    if (!cred) {
      if (lastErr && tried.size > 0 && waitMs === 0) throw lastErr; // every bot was tried and denied access
      if (waitMs > 0 && waitMs <= 1500) { await sleep(waitMs); continue; }
      throw lastErr ?? new ApiError(waitMs > 0 ? "RATE_LIMITED" : "CREDENTIALS_UNAVAILABLE",
        waitMs > 0 ? "All Discord credentials are rate limited" : "All Discord credentials are invalid or malformed (see GET /api/credentials)", { retryAfter: Math.ceil(waitMs / 1000) || undefined });
    }
    const headers: Record<string, string> = { accept: "application/json", "user-agent": "DiscordBot (proxy-hub, 1.0)" };
    if (auth !== "none" && cred.secret) headers.authorization = `Bot ${cred.secret}`;

    let res: Response;
    try {
      res = await fetchWithTimeout(url, { headers }, config.upstreamTimeoutMs);
    } catch (e) {
      lastErr = e as ApiError;
      if (attempt < config.upstreamRetries) { await sleep(backoff(attempt)); continue; }
      throw lastErr;
    }
    cred.lastStatus = res.status;
    const remaining = res.headers.get("x-ratelimit-remaining");
    const resetAfter = res.headers.get("x-ratelimit-reset-after");
    if (remaining !== null && resetAfter !== null) markBucket(cred, routeKey, Number(remaining), Number(resetAfter) * 1000);
    if (res.ok) return readJson(res);

    const body = await readJson(res);
    const msg = upstreamMessage(body, `Discord returned HTTP ${res.status}`);
    const code: number | undefined = typeof body?.code === "number" ? body.code : undefined;

    if (res.status === 429) {
      const ra = Number(body?.retry_after ?? res.headers.get("retry-after") ?? 5);
      const ms = (Number.isFinite(ra) ? ra : 5) * 1000;
      if (body?.global || res.headers.get("x-ratelimit-global")) markCooldown(cred, ms);
      else markBucket(cred, routeKey, 0, ms);
      lastErr = new ApiError("RATE_LIMITED", "Discord rate limited the request", { retryAfter: Math.ceil(ms / 1000) });
      continue;
    }
    if (res.status === 401) {
      if (cred.secret) { markInvalid(cred); lastErr = new ApiError("CREDENTIALS_UNAVAILABLE", "A Discord token was rejected as invalid"); continue; }
      throw new ApiError("CREDENTIALS_UNAVAILABLE", "This endpoint needs a Discord bot token. Set DISCORD_BOT_TOKENS.");
    }
    if (res.status >= 500) { lastErr = new ApiError("UPSTREAM_ERROR", msg); if (attempt < config.upstreamRetries) { await sleep(backoff(attempt)); continue; } throw lastErr; }

    const mapped =
      res.status === 404 || (code !== undefined && NOT_FOUND_CODES.has(code)) ? new ApiError("NOT_FOUND", msg)
      : res.status === 403 ? new ApiError(opts.forbiddenAs ?? "FORBIDDEN", msg)
      : res.status === 400 ? new ApiError("INVALID_REQUEST", msg)
      : new ApiError("UPSTREAM_ERROR", msg);

    const accessProblem = res.status === 403 || (res.status === 404 && code !== undefined && (code === 10004 || code === 10003));
    if (opts.fallbackOnAccess && accessProblem && cred.secret && configured > 1) {
      tried.add(cred.index);
      lastErr = mapped;
      continue;
    }
    throw mapped;
  }
  throw lastErr ?? new ApiError("UPSTREAM_ERROR", "Discord request failed");
}

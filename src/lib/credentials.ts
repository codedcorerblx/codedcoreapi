import { createHmac } from "node:crypto";
import { config, parseList } from "./config";
import { dbEnabled, dbQuery } from "./db";

export type Service = "roblox" | "discord";
interface Bucket { remaining: number; resetAt: number }

export interface Credential {
  service: Service;
  /** 1-based position in the env list; 0 = the anonymous (no credential) slot. */
  index: number;
  /** Keyed hash, used only as a DB key. Never the secret. */
  id: string;
  secret: string;
  cooldownUntil: number;
  invalid: boolean;
  /** Contains characters that cannot be sent in an HTTP header (spaces, line breaks, non-ASCII). */
  malformed: boolean;
  served: number;
  lastUsed: number;
  lastStatus: number | null;
  buckets: Map<string, Bucket>;
}
interface Pool { sig: string; creds: Credential[]; anon: Credential; hydratedAt: number; hydrating: boolean }

const g = globalThis as unknown as { __pools?: Partial<Record<Service, Pool>> };
const pools = (g.__pools ??= {});

const ENV: Record<Service, string> = { roblox: "ROBLOX_COOKIES", discord: "DISCORD_BOT_TOKENS" };

function normalise(service: Service, v: string): string {
  let s = v.replace(/^["']|["']$/g, "");
  s = service === "roblox" ? s.replace(/^\.?ROBLOSECURITY=/i, "") : s.replace(/^Bot\s+/i, "");
  return s.trim();
}

const mk = (service: Service, index: number, secret: string): Credential => ({
  service, index, secret,
  id: createHmac("sha256", config.apiSecret || "x").update(service + index + secret).digest("hex").slice(0, 16),
  cooldownUntil: 0, invalid: secret !== "" && !/^[\x21-\x7E]+$/.test(secret), malformed: secret !== "" && !/^[\x21-\x7E]+$/.test(secret), served: 0, lastUsed: 0, lastStatus: null, buckets: new Map(),
});

function pool(service: Service): Pool {
  const raw = process.env[ENV[service]];
  const list = parseList(raw).map((v) => normalise(service, v)).filter(Boolean);
  const sig = list.join("\u0000");
  let p = pools[service];
  if (!p || p.sig !== sig) {
    p = pools[service] = { sig, creds: list.map((v, i) => mk(service, i + 1, v)), anon: mk(service, 0, ""), hydratedAt: 0, hydrating: false };
  }
  return p;
}

export const credentialCount = (service: Service) => pool(service).creds.length;

/** Pull cooldowns written by other server instances (shared via Postgres). */
async function hydrate(service: Service) {
  const p = pool(service);
  if (!dbEnabled() || p.hydrating || Date.now() - p.hydratedAt < 10_000) return;
  p.hydrating = true;
  try {
    const rows = await dbQuery<{ cred_id: string; cooldown_until: string }>(
      "SELECT cred_id, cooldown_until FROM credential_state WHERE service=$1 AND cooldown_until > now()", [service]);
    for (const r of rows) {
      const c = p.creds.find((x) => x.id === r.cred_id);
      if (c) c.cooldownUntil = Math.max(c.cooldownUntil, Date.parse(r.cooldown_until));
    }
  } catch { /* storage is best-effort for cooldown sharing */ }
  p.hydratedAt = Date.now();
  p.hydrating = false;
}

function persist(c: Credential) {
  if (!dbEnabled() || c.index === 0) return;
  dbQuery(
    `INSERT INTO credential_state (service, cred_id, cooldown_until) VALUES ($1,$2,to_timestamp($3))
     ON CONFLICT (service, cred_id) DO UPDATE SET cooldown_until = EXCLUDED.cooldown_until`,
    [c.service, c.id, c.cooldownUntil / 1000],
  ).catch(() => {});
}

export interface AcquireOpts {
  exclude?: Set<number>;
  routeKey?: string;
  allowAnonymous?: boolean;
  prefer?: number;
}

/** Pick the least-recently-used usable credential (round-robin rotation). */
export async function acquire(service: Service, opts: AcquireOpts = {}): Promise<{ cred: Credential | null; waitMs: number; configured: number }> {
  await hydrate(service);
  const p = pool(service);
  const now = Date.now();
  let soonest = Infinity;
  const usable: Credential[] = [];
  const consider = (c: Credential) => {
    if (opts.exclude?.has(c.index) || c.invalid) return;
    let until = c.cooldownUntil;
    const b = opts.routeKey ? c.buckets.get(opts.routeKey) : undefined;
    if (b && b.remaining <= 0) until = Math.max(until, b.resetAt);
    if (until > now) soonest = Math.min(soonest, until - now);
    else usable.push(c);
  };
  p.creds.forEach(consider);
  let cred: Credential | null = null;
  if (usable.length) {
    cred = usable.find((c) => c.index === opts.prefer) ?? usable.sort((a, b) => a.lastUsed - b.lastUsed)[0];
  } else if (opts.allowAnonymous || p.creds.length === 0) {
    if (opts.allowAnonymous || p.creds.length === 0) {
      if (p.anon.cooldownUntil > now) soonest = Math.min(soonest, p.anon.cooldownUntil - now);
      else cred = p.anon;
    }
  }
  if (cred) { cred.lastUsed = now; cred.served++; }
  return { cred, waitMs: Number.isFinite(soonest) ? soonest : 0, configured: p.creds.length };
}

export function markCooldown(c: Credential, ms: number) {
  c.cooldownUntil = Date.now() + Math.min(ms, 15 * 60_000);
  persist(c);
}
export function markInvalid(c: Credential) {
  if (c.index === 0 || c.malformed) return;
  c.invalid = true;
  setTimeout(() => { c.invalid = false; }, 10 * 60_000).unref?.();
  markCooldown(c, 10 * 60_000);
}
export function markBucket(c: Credential, key: string, remaining: number, resetAfterMs: number) {
  c.buckets.set(key, { remaining, resetAt: Date.now() + resetAfterMs });
  if (c.buckets.size > 200) c.buckets.delete(c.buckets.keys().next().value as string);
}

/** Safe, secret-free view for GET /api/credentials. */
export async function snapshot(service: Service) {
  await hydrate(service);
  const p = pool(service);
  const now = Date.now();
  return {
    configured: p.creds.length,
    anonymousFallback: service === "discord" ? "endpoints that are public" : "endpoints that are public",
    credentials: p.creds.map((c) => ({
      index: c.index,
      state: c.malformed ? "malformed" : c.invalid ? "invalid" : c.cooldownUntil > now ? "cooling_down" : "ready",
      cooldownRemainingSeconds: Math.max(0, Math.ceil((c.cooldownUntil - now) / 1000)),
      requestsServed: c.served,
      lastStatus: c.lastStatus,
    })),
  };
}

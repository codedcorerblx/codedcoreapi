import { after } from "next/server";
import { config } from "./config";
import { dbEnabled, dbQuery } from "./db";
import type { LogEntry } from "./pipeline";

/** Only endpoint ids, route templates, status codes and timings are stored: no params, keys, cookies or tokens. */
async function insert(entries: LogEntry[]) {
  if (!entries.length) return;
  await dbQuery(
    `INSERT INTO request_logs (endpoint_id, method, route, status, success, error_code, latency_ms, cached, source)
     SELECT * FROM unnest($1::text[], $2::text[], $3::text[], $4::int[], $5::boolean[], $6::text[], $7::int[], $8::boolean[], $9::text[])`,
    [entries.map((e) => e.endpointId), entries.map((e) => e.method), entries.map((e) => e.route), entries.map((e) => e.status),
      entries.map((e) => e.success), entries.map((e) => e.errorCode), entries.map((e) => e.latencyMs), entries.map((e) => e.cached), entries.map((e) => e.source)],
  );
  if (Math.random() < 0.02)
    await dbQuery(`DELETE FROM request_logs WHERE ts < now() - make_interval(days => $1::int)`, [config.logRetentionDays]);
}

/** Fire-and-forget, kept alive after the response via next/server `after` (Vercel waitUntil). */
export function track(entries: LogEntry[]) {
  if (!dbEnabled() || !entries.length) return;
  const p = insert(entries).catch((e) => console.error("[analytics] insert failed:", e instanceof Error ? e.message : "unknown"));
  try { after(p); } catch { /* outside a request scope – the promise still runs */ }
}

/* ───────────── reads ───────────── */
export interface Filters { hours: number; endpoint?: string; status?: string; q?: string }
const UNHEALTHY = "(status >= 500 OR status = 429)";

function where(f: Filters, withStatusAndText = true) {
  const params: unknown[] = [f.hours];
  const c = ["ts > now() - make_interval(hours => $1::int)"];
  if (f.endpoint && withStatusAndText) { params.push(f.endpoint); c.push(`endpoint_id = $${params.length}`); }
  if (withStatusAndText && f.status) {
    const s = f.status;
    if (s === "success") c.push("status BETWEEN 200 AND 299");
    else if (s === "failed") c.push("status >= 400");
    else if (/^[2-5]xx$/.test(s)) c.push(`status BETWEEN ${Number(s[0]) * 100} AND ${Number(s[0]) * 100 + 99}`);
    else if (/^\d{3}$/.test(s)) { params.push(Number(s)); c.push(`status = $${params.length}`); }
  }
  if (withStatusAndText && f.q) { params.push(`%${f.q.replace(/[\\%_]/g, "\\$&")}%`); c.push(`(endpoint_id ILIKE $${params.length} OR route ILIKE $${params.length})`); }
  return { sql: c.join(" AND "), params };
}

export function bucketSeconds(hours: number) { return hours <= 1 ? 300 : hours <= 6 ? 900 : hours <= 24 ? 3600 : 6 * 3600; }

export async function readDashboard(f: Filters & { limit: number; offset: number }) {
  const w = where(f);
  const wAll = where(f, false);
  const [summary, codes, series, perEndpoint, recent, total] = await Promise.all([
    dbQuery(`SELECT count(*)::int total,
        count(*) FILTER (WHERE status BETWEEN 200 AND 299)::int success,
        count(*) FILTER (WHERE status >= 400)::int failed,
        count(*) FILTER (WHERE cached)::int cache_hits,
        COALESCE(round(avg(latency_ms)),0)::int avg_ms, COALESCE(max(latency_ms),0)::int max_ms,
        COALESCE(round(percentile_cont(0.95) WITHIN GROUP (ORDER BY latency_ms)),0)::int p95_ms,
        count(*) FILTER (WHERE ${UNHEALTHY})::int unhealthy
      FROM request_logs WHERE ${w.sql}`, w.params),
    dbQuery(`SELECT status, count(*)::int count FROM request_logs WHERE ${w.sql} GROUP BY status ORDER BY status`, w.params),
    dbQuery(`SELECT extract(epoch FROM date_bin(make_interval(secs => ${bucketSeconds(f.hours)}), ts, TIMESTAMPTZ 'epoch'))::bigint * 1000 AS t,
        count(*)::int total, count(*) FILTER (WHERE status >= 400)::int failed
      FROM request_logs WHERE ${w.sql} GROUP BY 1 ORDER BY 1`, w.params),
    dbQuery(`SELECT endpoint_id id, count(*)::int total,
        count(*) FILTER (WHERE status BETWEEN 200 AND 299)::int success,
        count(*) FILTER (WHERE status >= 400)::int failed,
        count(*) FILTER (WHERE ${UNHEALTHY})::int unhealthy,
        count(*) FILTER (WHERE cached)::int cache_hits,
        round(avg(latency_ms))::int avg_ms, max(latency_ms)::int max_ms,
        max(ts) FILTER (WHERE status BETWEEN 200 AND 299) last_success, max(ts) last_request,
        count(*) FILTER (WHERE ts > now() - interval '15 minutes')::int recent_total,
        count(*) FILTER (WHERE ts > now() - interval '15 minutes' AND ${UNHEALTHY})::int recent_unhealthy
      FROM request_logs WHERE ${wAll.sql} GROUP BY endpoint_id`, wAll.params),
    dbQuery(`SELECT ts, endpoint_id, method, route, status, latency_ms, cached, source, error_code
      FROM request_logs WHERE ${w.sql} ORDER BY ts DESC LIMIT ${f.limit} OFFSET ${f.offset}`, w.params),
    dbQuery(`SELECT count(*)::int n FROM request_logs WHERE ${w.sql}`, w.params),
  ]);
  return { summary: summary[0], statusCodes: codes, timeseries: series, endpoints: perEndpoint, recent: { rows: recent, total: total[0]?.n ?? 0 } };
}

export type Health = "operational" | "degraded" | "down" | "no-data";
export function healthOf(e: { total: number; unhealthy: number; recent_total: number; recent_unhealthy: number } | undefined): { health: Health; uptime: number | null } {
  if (!e || e.total === 0) return { health: "no-data", uptime: null };
  const uptime = 100 * (1 - e.unhealthy / e.total);
  const recent = e.recent_total ? 100 * (1 - e.recent_unhealthy / e.recent_total) : 100;
  if ((e.recent_total >= 3 && recent < 50) || uptime < 50) return { health: "down", uptime };
  if (uptime < 99 || recent < 90) return { health: "degraded", uptime };
  return { health: "operational", uptime };
}

/** Compact 24h summary for the homepage. Returns null when storage is not configured or unreachable. */
export async function homeSummary() {
  if (!dbEnabled()) return null;
  try {
    const r = await readDashboard({ hours: 24, limit: 0, offset: 0 });
    return r;
  } catch { return null; }
}

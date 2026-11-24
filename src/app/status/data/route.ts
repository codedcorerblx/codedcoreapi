import { bucketSeconds, healthOf, readDashboard } from "@/lib/analytics";
import { dbEnabled } from "@/lib/db";
import { endpoints } from "@/lib/registry";
import { jsonResponse } from "@/lib/envelope";

export const dynamic = "force-dynamic";

/** Public, read-only aggregates. Contains endpoint ids, status codes and timings only. */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const hours = [1, 6, 24, 168].includes(Number(sp.get("hours"))) ? Number(sp.get("hours")) : 24;
  const known = new Set(endpoints.map((e) => e.id));
  const endpoint = sp.get("endpoint") && known.has(sp.get("endpoint")!) ? sp.get("endpoint")! : undefined;
  const limit = Math.min(Math.max(Number(sp.get("limit")) || 25, 1), 100);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const base = { generatedAt: new Date().toISOString(), hours, bucketSeconds: bucketSeconds(hours) };
  if (!dbEnabled()) return jsonResponse({ ...base, configured: false }, 200);
  try {
    const d = await readDashboard({ hours, endpoint, status: sp.get("status") ?? undefined, q: (sp.get("q") ?? "").slice(0, 80) || undefined, limit, offset });
    const byId = new Map(d.endpoints.map((e) => [e.id as string, e]));
    return jsonResponse({
      ...base, configured: true, summary: d.summary, statusCodes: d.statusCodes, timeseries: d.timeseries, recent: d.recent,
      endpoints: endpoints.map((e) => {
        const s = byId.get(e.id);
        return { id: e.id, ...(s ?? {}), ...healthOf(s as never) };
      }),
    }, 200);
  } catch {
    return jsonResponse({ ...base, configured: true, error: "Analytics storage is unreachable" }, 503);
  }
}

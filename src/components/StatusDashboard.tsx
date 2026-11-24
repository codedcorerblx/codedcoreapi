"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarList, VolumeChart } from "./charts";

interface Ep { id: string; service: string; method: string; path: string; summary: string }
interface EpStat { id: string; health: "operational" | "degraded" | "down" | "no-data"; uptime: number | null; total?: number; success?: number; failed?: number; avg_ms?: number; max_ms?: number; last_success?: string | null; cache_hits?: number }
interface Data {
  configured: boolean; error?: string; hours: number; bucketSeconds: number; generatedAt: string;
  summary?: { total: number; success: number; failed: number; cache_hits: number; avg_ms: number; max_ms: number; p95_ms: number; unhealthy: number };
  statusCodes?: { status: number; count: number }[]; timeseries?: { t: number; total: number; failed: number }[];
  endpoints?: EpStat[];
  recent?: { rows: { ts: string; endpoint_id: string; method: string; route: string; status: number; latency_ms: number; cached: boolean; source: string }[]; total: number };
}
const PAGE = 20;
const ago = (iso?: string | null) => {
  if (!iso) return "never";
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  return s < 60 ? `${Math.floor(s)}s ago` : s < 3600 ? `${Math.floor(s / 60)}m ago` : s < 86400 ? `${Math.floor(s / 3600)}h ago` : `${Math.floor(s / 86400)}d ago`;
};
const cls = (s: number) => `s${String(s)[0]}xx`;
const LABEL = { operational: "Operational", degraded: "Degraded", down: "Down", "no-data": "No traffic" };

export default function StatusDashboard({ endpoints }: { endpoints: Ep[] }) {
  const [hours, setHours] = useState(24);
  const [endpoint, setEndpoint] = useState("");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const [qDebounced, setQd] = useState("");
  const [tableQ, setTableQ] = useState("");
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { const t = setTimeout(() => setQd(q), 300); return () => clearTimeout(t); }, [q]);
  useEffect(() => setOffset(0), [hours, endpoint, status, qDebounced]);

  const load = useCallback(async () => {
    const sp = new URLSearchParams({ hours: String(hours), limit: String(PAGE), offset: String(offset) });
    if (endpoint) sp.set("endpoint", endpoint); if (status) sp.set("status", status); if (qDebounced) sp.set("q", qDebounced);
    try { const r = await fetch(`/status/data?${sp}`, { cache: "no-store" }); setData(await r.json()); } catch { setData({ configured: true, error: "Could not load statistics", hours, bucketSeconds: 3600, generatedAt: "" }); }
    setLoading(false);
  }, [hours, endpoint, status, qDebounced, offset]);
  useEffect(() => { load(); const t = setInterval(load, 30_000); return () => clearInterval(t); }, [load]);

  const stats = useMemo(() => new Map((data?.endpoints ?? []).map((e) => [e.id, e])), [data]);
  const s = data?.summary;
  const rows = endpoints.filter((e) => !tableQ || (e.path + e.id + e.summary).toLowerCase().includes(tableQ.toLowerCase()));
  const top = [...(data?.endpoints ?? [])].filter((e) => e.total).sort((a, b) => (b.total ?? 0) - (a.total ?? 0)).slice(0, 8);
  const rate = s && s.total ? (100 * s.success) / s.total : null;
  const hit = s && s.total ? (100 * s.cache_hits) / s.total : null;

  if (data && !data.configured) return (
    <div className="banner"><b>Analytics storage is not configured.</b> Set <code>DATABASE_URL</code> to a Postgres database (Neon via the Vercel Marketplace works) and redeploy. The tables are created automatically. Until then the API works but nothing is recorded.</div>);

  return (
    <>
      <div className="filters">
        <div><label htmlFor="f-range">Time range</label><select id="f-range" value={hours} onChange={(e) => setHours(Number(e.target.value))}><option value={1}>Last hour</option><option value={6}>Last 6 hours</option><option value={24}>Last 24 hours</option><option value={168}>Last 7 days</option></select></div>
        <div><label htmlFor="f-ep">Endpoint</label><select id="f-ep" value={endpoint} onChange={(e) => setEndpoint(e.target.value)}><option value="">All endpoints</option>{endpoints.map((e) => <option key={e.id} value={e.id}>{e.path.replace("/api/", "")}</option>)}</select></div>
        <div><label htmlFor="f-st">Status</label><select id="f-st" value={status} onChange={(e) => setStatus(e.target.value)}>{[["", "Any"], ["success", "Successful (2xx)"], ["failed", "Failed (≥400)"], ["4xx", "4xx"], ["5xx", "5xx"], ["429", "429 rate limited"]].map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
        <div><label htmlFor="f-q">Search history</label><input id="f-q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="users, guilds, badges…" /></div>
        <button className="btn" onClick={() => { setHours(24); setEndpoint(""); setStatus(""); setQ(""); }}>Reset</button>
      </div>
      {data?.error && <div className="banner">{data.error}</div>}

      <div className="kpis" aria-busy={loading}>
        <div className="kpi"><b>{s?.total ?? "–"}</b><span>Requests</span></div>
        <div className="kpi"><b>{rate === null ? "–" : rate.toFixed(1) + "%"}</b><span>{s?.success ?? 0} ok · {s?.failed ?? 0} failed</span></div>
        <div className="kpi"><b>{s ? s.avg_ms + " ms" : "–"}</b><span>Average latency</span></div>
        <div className="kpi"><b>{s ? s.max_ms + " ms" : "–"}</b><span>Max · p95 {s?.p95_ms ?? 0} ms</span></div>
        <div className="kpi"><b>{hit === null ? "–" : hit.toFixed(0) + "%"}</b><span>{s?.cache_hits ?? 0} cache hits · {(s?.total ?? 0) - (s?.cache_hits ?? 0)} misses</span></div>
      </div>

      <div className="grid2">
        <div className="panel"><h3>Request volume</h3>{data?.timeseries && <VolumeChart points={data.timeseries} hours={hours} bucket={data.bucketSeconds} />}<p className="muted" style={{ fontSize: ".8rem", margin: "8px 0 0" }}><span className="dot" style={{ background: "var(--amber)" }} />successful <span className="dot" style={{ background: "var(--bad)", marginLeft: 12 }} />failed (≥400)</p></div>
        <div className="panel"><h3>HTTP status codes</h3>
          <BarList items={(data?.statusCodes ?? []).map((c) => ({ label: String(c.status), value: c.count, color: c.status < 300 ? "var(--ok)" : c.status < 500 ? "var(--warn)" : "var(--bad)" }))} /></div>
      </div>
      <div className="grid2" style={{ gridTemplateColumns: "1fr" }}>
        <div className="panel"><h3>Most used endpoints</h3><BarList items={top.map((e) => ({ label: e.id.replace(/^(roblox|discord|system)\./, ""), value: e.total ?? 0, title: e.id }))} /></div>
      </div>

      <section className="section" style={{ paddingTop: 36 }}>
        <div style={{ display: "flex", gap: 12, alignItems: "end", flexWrap: "wrap", justifyContent: "space-between" }}>
          <h2>Endpoints</h2>
          <input style={{ maxWidth: 260 }} placeholder="Filter endpoints" aria-label="Filter endpoints" value={tableQ} onChange={(e) => setTableQ(e.target.value)} />
        </div>
        <p className="muted" style={{ marginTop: 6 }}>Uptime counts every response except 5xx and 429 as healthy. A 404 for a user that does not exist is a correct answer, not an outage. Select a row to filter the charts and history.</p>
        <div className="tablewrap"><table>
          <thead><tr><th>Endpoint</th><th>Status</th><th>Uptime</th><th>OK / failed</th><th>Avg</th><th>Max</th><th>Last success</th></tr></thead>
          <tbody>{rows.map((e) => {
            const st = stats.get(e.id);
            return (
              <tr key={e.id} className="click" onClick={() => setEndpoint(endpoint === e.id ? "" : e.id)} aria-selected={endpoint === e.id}>
                <td><span className={`tag-${e.service}`}>●</span> <code>{e.method} {e.path.replace("/api/", "/")}</code></td>
                <td><span className={`pill ${st?.health ?? "no-data"}`}>{LABEL[st?.health ?? "no-data"]}</span></td>
                <td>{st?.uptime == null ? "–" : st.uptime.toFixed(2) + "%"}</td>
                <td className="nw">{st?.total ? <>{st.success} / <span className={st.failed ? "s4xx" : ""}>{st.failed}</span></> : "–"}</td>
                <td>{st?.total ? st.avg_ms + " ms" : "–"}</td><td>{st?.total ? st.max_ms + " ms" : "–"}</td>
                <td className="nw">{ago(st?.last_success)}</td>
              </tr>);
          })}</tbody>
        </table></div>
      </section>

      <section className="section" style={{ paddingTop: 36 }}>
        <h2>Recent requests</h2>
        <div className="tablewrap" style={{ marginTop: 14 }}><table>
          <thead><tr><th>Time</th><th>Endpoint</th><th>Status</th><th>Latency</th><th>Cache</th><th>Via</th></tr></thead>
          <tbody>{(data?.recent?.rows ?? []).map((r, i) => (
            <tr key={i}><td className="nw" title={r.ts}>{new Date(r.ts).toLocaleTimeString()} <span className="muted">· {ago(r.ts)}</span></td>
              <td><code>{r.method} {r.route.replace("/api/", "/")}</code></td><td className={cls(r.status)}><b>{r.status}</b></td><td>{r.latency_ms} ms</td><td>{r.cached ? "hit" : "miss"}</td><td>{r.source}</td></tr>))}
            {!data?.recent?.rows.length && <tr><td colSpan={6} className="muted" style={{ textAlign: "center", padding: 24 }}>No requests match these filters.</td></tr>}</tbody>
        </table></div>
        <div className="pager">
          <span>{data?.recent ? `${Math.min(offset + 1, data.recent.total)}–${Math.min(offset + PAGE, data.recent.total)} of ${data.recent.total}` : ""}</span>
          <button className="btn small" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE))}>Previous</button>
          <button className="btn small" disabled={!data?.recent || offset + PAGE >= data.recent.total} onClick={() => setOffset(offset + PAGE)}>Next</button>
        </div>
      </section>
    </>
  );
}

import Link from "next/link";
import { healthOf, homeSummary } from "@/lib/analytics";
import { endpoints } from "@/lib/registry";
import { JsonView, Curl } from "@/components/Json";

export const revalidate = 30;

const hero = { success: true, data: { id: 1, name: "Roblox", displayName: "Roblox", hasVerifiedBadge: true }, error: null, nextCursor: null,
  metadata: { timestamp: "2026-01-15T12:00:00.000Z", cached: false, responseTime: 120, requestId: "7b0c1d52-…", availability: "available" } };

const links = [
  ["/docs", "Documentation", "Every endpoint with parameters, types, examples and error codes. Includes the playground."],
  ["/docs/roblox", "Roblox API", "Users, friends, followers, groups, badges, inventory, games, avatars and presence."],
  ["/docs/discord", "Discord API", "Users, servers, channels, members, invites, widgets and snowflake decoding."],
  ["/status", "Status", "Per-endpoint uptime, latency, cache hit rate and request history for the last 24 hours."],
  ["/swagger", "Swagger UI", "OpenAPI 3.1 explorer generated from the same registry."],
  ["/openapi.json?download=1", "openapi.json", "Download the specification for client generators."],
] as const;

export default async function Home() {
  const d = await homeSummary();
  const stat = new Map((d?.endpoints ?? []).map((e) => [e.id as string, e]));
  const svc = (s: string) => {
    const list = endpoints.filter((e) => e.service === s);
    const c = { operational: 0, degraded: 0, down: 0, "no-data": 0 };
    list.forEach((e) => { c[healthOf(stat.get(e.id) as never).health]++; });
    return { n: list.length, c };
  };
  return (
    <div className="wrap">
      <section className="hero">
        <div>
          <h1>One key in front of Roblox and Discord.</h1>
          <p>A private proxy that rotates your credentials, respects upstream limits and answers every request with the same JSON envelope.</p>
          <div className="actions"><Link className="btn primary" href="/docs">Read the docs</Link><Link className="btn" href="/status">See live status</Link></div>
        </div>
        <div className="codewin">
          <header><span>GET /api/roblox/users/1</span><b style={{ marginLeft: "auto" }}>200</b></header>
          <Curl text={"curl 'https://your-deployment.vercel.app/api/roblox/users/1' \\\n  -H 'x-api-key: YOUR_API_KEY'"} />
          <JsonView value={hero} bordered={false} />
        </div>
      </section>

      <section className="section" style={{ paddingTop: 24 }}>
        <h2>Service health</h2>
        <p className="lede">{d ? "Based on the last 24 hours of traffic." : "Statistics appear once DATABASE_URL is set and requests arrive."}</p>
        <div className="health">
          {(["roblox", "discord"] as const).map((s) => {
            const { n, c } = svc(s);
            const total = d?.summary ? (d.endpoints as { id: string; total: number }[]).filter((e) => e.id.startsWith(s + ".")).reduce((a, e) => a + e.total, 0) : null;
            return (
              <div key={s} className={`svc ${s}`}>
                <h3><span>{s === "roblox" ? "Roblox" : "Discord"}</span><Link className="muted" style={{ fontSize: ".85rem", fontWeight: 400 }} href={`/docs/${s}`}>{n} endpoints</Link></h3>
                <div className="segbar" aria-hidden>{(Object.keys(c) as (keyof typeof c)[]).filter((k) => c[k]).map((k) => <i key={k} className={`bg-${k}`} style={{ flex: c[k] }} />)}</div>
                <div className="legend">
                  {(["operational", "degraded", "down", "no-data"] as const).map((k) => <span key={k}><span className={`dot ${k}`} />{c[k]} {k === "no-data" ? "no traffic" : k}</span>)}
                </div>
                {total !== null && <p className="muted" style={{ margin: "12px 0 0", fontSize: ".9rem" }}>{total} requests in 24h</p>}
              </div>);
          })}
        </div>
      </section>

      <section className="section">
        <h2>Where to go</h2>
        <div className="rows">
          {links.map(([href, title, desc]) => (
            <Link key={href} href={href} className="row"><h3>{title}</h3><span className="muted">{desc}</span><span className="go">open</span></Link>))}
        </div>
      </section>

      <section className="section">
        <h2>Quick start</h2>
        <p className="lede">Pass the key in <code>x-api-key</code>. Page through lists with <code>cursor</code>, or let the server collect everything with <code>cursor=auto</code>.</p>
        <Curl text={"curl 'https://your-deployment.vercel.app/api/roblox/users/1/badges?limit=100&cursor=auto&maxItems=500' \\\n  -H 'x-api-key: YOUR_API_KEY'"} />
        <div style={{ height: 12 }} />
        <Curl text={`curl -X POST 'https://your-deployment.vercel.app/api/batch' \\\n  -H 'x-api-key: YOUR_API_KEY' -H 'content-type: application/json' \\\n  -d '{"requests":[{"id":"user","endpoint":"/api/roblox/users/1"},{"id":"guild","endpoint":"/api/discord/guilds/81384788765712384"}]}'`} />
      </section>
    </div>
  );
}

import { ERROR_INFO } from "@/lib/errors";
import { exampleCurl, exampleEnvelope, exampleError, exampleUrl, flattenFields, typeLabel, type PublicEndpoint } from "@/lib/registry";
import { Curl, JsonView } from "./Json";
import TryButton from "./TryButton";

const pathNodes = (p: string) => p.split(/(\{[^}]+\})/).map((s, i) => (s.startsWith("{") ? <em key={i}>{s}</em> : s));

export function Sidebar({ endpoints }: { endpoints: PublicEndpoint[] }) {
  const groups = new Map<string, PublicEndpoint[]>();
  for (const e of endpoints) groups.set(`${e.service} · ${e.tag}`, [...(groups.get(`${e.service} · ${e.tag}`) ?? []), e]);
  return (
    <aside className="side" aria-label="Endpoints">
      <a href="#playground">Playground</a>
      {[...groups].map(([g, list]) => (
        <div key={g}><h4>{g}</h4>{list.map((e) => <a key={e.id} href={`#${e.id}`} title={e.path}>{e.summary}</a>)}</div>
      ))}
    </aside>
  );
}

function EndpointDoc({ d, base }: { d: PublicEndpoint; base: string }) {
  const rows = flattenFields(d.fields, d.isList ? "data[]" : "data");
  const bodyParams = d.params.filter((p) => p.in === "body");
  return (
    <details className="ep" id={d.id}>
      <summary>
        <span className={`method ${d.method}`}>{d.method}</span>
        <span className="path">{pathNodes(d.path)}<span className="sum">{d.summary}</span></span>
        <span className="chev" aria-hidden>›</span>
      </summary>
      <div className="ep-body">
        <p style={{ marginTop: 14 }}>{d.description}</p>
        {d.notes && <ul>{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
        <div className="fullurl">{d.method} {base}{d.path}</div>

        <h4>Authentication</h4>
        <p className="muted" style={{ marginBottom: 0 }}>
          Header <code>x-api-key: YOUR_API_KEY</code> is required (missing or wrong → 401 <code>UNAUTHORIZED</code>).{" "}
          Upstream credential: {d.credential.mode === "none" ? "none needed." : <>{d.credential.service} · <b>{d.credential.mode}</b>. {d.credential.note}</>}
        </p>

        {d.params.length > 0 && (<>
          <h4>Parameters</h4>
          <div className="tablewrap"><table>
            <thead><tr><th>Name</th><th>In</th><th>Type</th><th>Default</th><th>Description</th></tr></thead>
            <tbody>{d.params.map((p) => (
              <tr key={p.in + p.name}>
                <td className="nw"><code>{p.name}</code>{(p.required || p.in === "path") && <span className="req"> required</span>}</td>
                <td>{p.in}</td>
                <td className="nw">{p.type === "array" ? `array<${p.items ?? "string"}>` : p.type}</td>
                <td>{p.default !== undefined ? <code>{String(p.default)}</code> : "–"}</td>
                <td>{p.description}{p.enum && <> One of: {p.enum.map((v) => <code key={v}> {v}</code>)}.</>}{p.max !== undefined && p.type === "integer" && !p.description.includes("max") && <> Max {p.max}.</>}</td>
              </tr>))}</tbody>
          </table></div>
        </>)}

        {d.pagination && (<>
          <h4>Pagination</h4>
          <p className="muted">Default <code>limit={d.pagination.default}</code>, upstream maximum {d.pagination.max}{d.pagination.allowed ? ` (accepted sizes: ${d.pagination.allowed.join(", ")})` : ""}. {d.pagination.cursorNote} Responses carry <code>nextCursor</code>; <code>null</code> means the last page. <code>cursor=auto</code> follows every cursor and combines results; it stops at the server caps and reports <code>metadata.pagination.truncated</code> with a resumable <code>nextCursor</code>.</p>
        </>)}

        <h4>Example request</h4>
        <Curl text={exampleCurl(d, base)} />
        {bodyParams.length > 0 && <p className="muted" style={{ marginTop: 8 }}>Example URL: <code>{exampleUrl(d, base)}</code></p>}

        <h4>Example response</h4>
        <JsonView value={exampleEnvelope(d)} />

        <h4>Fields of <code>{d.isList ? "data[]" : "data"}</code></h4>
        <div className="tablewrap"><table>
          <thead><tr><th>Field</th><th>Type</th><th>Description</th></tr></thead>
          <tbody>{rows.map(({ path, field }) => (
            <tr key={path}><td><code>{path}</code></td><td className="nw">{typeLabel(field)}</td><td>{field.description}</td></tr>))}</tbody>
        </table></div>

        <h4>Errors</h4>
        <div className="tablewrap"><table>
          <thead><tr><th>Code</th><th>HTTP</th><th>Meaning</th></tr></thead>
          <tbody>{d.errorCodes.map(({ code, note }) => (
            <tr key={code}><td><code>{code}</code></td><td>{ERROR_INFO[code].status}</td><td>{note ?? ERROR_INFO[code].description}</td></tr>))}</tbody>
        </table></div>
        <details style={{ marginTop: 10 }}><summary className="muted" style={{ cursor: "pointer" }}>Error response shape</summary>
          <JsonView value={exampleError(d.errorCodes[d.errorCodes.length > 2 ? 1 : 0].code)} /></details>
        <p style={{ marginTop: 16, marginBottom: 0 }}><TryButton id={d.id} /></p>
      </div>
    </details>
  );
}

export function ServiceDocs({ endpoints, base }: { endpoints: PublicEndpoint[]; base: string }) {
  const tags = [...new Set(endpoints.map((e) => e.tag))];
  return <>{tags.map((t) => (
    <section key={t}><h3 className="tag">{t}</h3>{endpoints.filter((e) => e.tag === t).map((e) => <EndpointDoc key={e.id} d={e} base={base} />)}</section>
  ))}</>;
}

export function Concepts() {
  return (
    <div className="concepts">
      <section id="auth"><h3>Authentication</h3>
        <p className="muted">There is one global private key. Send it on every <code>/api/*</code> request as <code>x-api-key</code>. Missing or wrong keys return HTTP 401. This documentation, the homepage, <code>/status</code>, <code>/openapi.json</code> and <code>/swagger</code> are public; executing requests is not.</p>
      </section>
      <section id="envelope"><h3>Response envelope</h3>
        <p className="muted">Every endpoint, including errors and batch sub-requests, returns the same shape. <code>metadata.availability</code> separates <b>available</b> (data returned), <b>empty</b> (valid request, nothing exists) and <b>partial</b> (some sections failed). Private, forbidden and unsupported data are errors with their own codes, never empty lists.</p>
        <JsonView value={{ success: true, data: {}, error: null, nextCursor: null, metadata: { timestamp: "ISO-8601", cached: false, responseTime: 120, requestId: "uuid", availability: "available" } }} />
        <JsonView value={{ success: false, data: null, error: { code: "RATE_LIMITED", message: "Roblox rate limited the request" }, nextCursor: null, metadata: { timestamp: "ISO-8601", responseTime: 42, requestId: "uuid" } }} />
      </section>
      <section id="usernames"><h3>Users by ID or username</h3>
        <p className="muted"><b>Roblox:</b> every <code>{"{userId}"}</code> path accepts a numeric ID or a username (case-insensitive). All-digit values are IDs; write <code>@12345</code> to force a username. The proxy resolves the name first, caches it for 10 minutes, and reports the translation in <code>metadata.resolved</code>. Unknown names return 404 <code>NOT_FOUND</code>.</p>
        <p className="muted"><b>Discord:</b> there is no global username lookup in Discord&apos;s API. Pass a snowflake, or add <code>guildId</code> so the name is matched against that server&apos;s members (exact match on username, display name or nickname; ambiguous matches return <code>INVALID_REQUEST</code> with candidate IDs). <code>/guilds/{"{guildId}"}/members/{"{userId}"}</code> accepts names directly.</p>
      </section>
      <section id="pagination"><h3>Pagination</h3>
        <p className="muted">List endpoints take <code>limit</code> (clamped to the upstream maximum), <code>cursor=&lt;nextCursor&gt;</code> for manual paging, and <code>cursor=auto</code> to walk every page server-side. Auto mode is bounded by item, page and time caps; hitting one returns the partial result with <code>metadata.pagination.truncated=true</code>, a <code>reason</code>, and a <code>nextCursor</code> you can resume from.</p>
      </section>
      <section id="errors"><h3>Error codes</h3>
        <div className="tablewrap"><table><thead><tr><th>Code</th><th>HTTP</th><th>Meaning</th></tr></thead>
          <tbody>{Object.entries(ERROR_INFO).map(([c, i]) => <tr key={c}><td><code>{c}</code></td><td>{i.status}</td><td>{i.description}</td></tr>)}</tbody></table></div>
      </section>
    </div>
  );
}

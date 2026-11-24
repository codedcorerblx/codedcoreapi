"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { JsonView } from "./Json";
import type { ParamDef } from "@/lib/registry/types";

export interface PGEndpoint { id: string; service: string; tag: string; method: string; path: string; summary: string; params: ParamDef[]; bodyExample?: unknown }
interface Resp { status: number; statusText: string; durationMs: number; headers: Record<string, string>; body: string; requestPath: string }

const exStr = (v: unknown) => (Array.isArray(v) ? v.join(",") : v === undefined ? "" : String(v));
const initial = (d: PGEndpoint) => ({
  path: Object.fromEntries(d.params.filter((p) => p.in === "path").map((p) => [p.name, exStr(p.example)])),
  query: Object.fromEntries(d.params.filter((p) => p.in === "query").map((p) => [p.name, p.required ? exStr(p.example) : ""])),
  body: d.bodyExample ? JSON.stringify(d.bodyExample, null, 2) : "",
});
const sh = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export default function Playground({ endpoints }: { endpoints: PGEndpoint[] }) {
  const [id, setId] = useState(endpoints[0].id);
  const def = useMemo(() => endpoints.find((e) => e.id === id) ?? endpoints[0], [id, endpoints]);
  const [vals, setVals] = useState(() => initial(endpoints[0]));
  const [headers, setHeaders] = useState<{ k: string; v: string }[]>([]);
  const [resp, setResp] = useState<Resp | null>(null);
  const [tab, setTab] = useState<"body" | "headers">("body");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [auth, setAuth] = useState<"unknown" | "locked" | "unlocked">("unknown");
  const [keyInput, setKeyInput] = useState("");
  const [copied, setCopied] = useState("");

  const select = useCallback((next: string) => {
    const d = endpoints.find((e) => e.id === next); if (!d) return;
    setId(next); setVals(initial(d)); setResp(null); setErr(null);
  }, [endpoints]);

  useEffect(() => {
    const h = (e: Event) => select((e as CustomEvent<string>).detail);
    window.addEventListener("playground:select", h);
    return () => window.removeEventListener("playground:select", h);
  }, [select]);
  useEffect(() => { fetch("/api/playground/session").then((r) => setAuth(r.ok ? "unlocked" : "locked")).catch(() => setAuth("locked")); }, []);

  const requestPath = () => {
    let p = def.path;
    for (const [k, v] of Object.entries(vals.path)) p = p.replace(`{${k}}`, encodeURIComponent(v || `{${k}}`));
    const qs = new URLSearchParams(Object.entries(vals.query).filter(([, v]) => v !== ""));
    return p + (qs.size ? "?" + qs : "");
  };
  const curl = () => {
    const parts = [`curl${def.method === "POST" ? " -X POST" : ""} ${sh(location.origin + requestPath())}`, `  -H 'x-api-key: YOUR_API_KEY'`];
    headers.filter((h) => h.k.trim()).forEach((h) => parts.push(`  -H ${sh(`${h.k.trim()}: ${h.v}`)}`));
    if (def.method === "POST") { parts.push(`  -H 'content-type: application/json'`); parts.push(`  -d ${sh(vals.body.replace(/\s*\n\s*/g, " "))}`); }
    return parts.join(" \\\n");
  };
  const copy = async (what: string, text: string) => { await navigator.clipboard.writeText(text); setCopied(what); setTimeout(() => setCopied(""), 1500); };

  async function unlock() {
    setErr(null);
    const r = await fetch("/api/playground/session", { method: "POST", headers: { "x-api-key": keyInput } });
    setKeyInput("");
    if (r.ok) setAuth("unlocked"); else setErr("That key was not accepted.");
  }
  async function lock() { await fetch("/api/playground/session", { method: "DELETE" }); setAuth("locked"); }

  async function run() {
    setBusy(true); setErr(null); setResp(null);
    try {
      let body: unknown;
      if (def.method === "POST") { try { body = JSON.parse(vals.body || "{}"); } catch { setErr("Request body is not valid JSON."); return; } }
      const r = await fetch("/api/playground/execute", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ endpointId: def.id, pathParams: vals.path, query: vals.query, body, headers: Object.fromEntries(headers.filter((h) => h.k.trim()).map((h) => [h.k.trim(), h.v])) }),
      });
      const j = await r.json();
      if (typeof j.status === "number") { setResp(j); setTab("body"); }
      else { if (r.status === 401) setAuth("locked"); setErr(j.error?.message ?? "Request failed"); }
    } catch { setErr("Could not reach the server."); } finally { setBusy(false); }
  }

  const pretty = useMemo(() => { if (!resp) return ""; try { return JSON.stringify(JSON.parse(resp.body), null, 2); } catch { return resp.body; } }, [resp]);
  const groups = [...new Set(endpoints.map((e) => e.service))];
  const field = (kind: "path" | "query", p: ParamDef) => {
    const v = vals[kind][p.name] ?? "";
    const set = (x: string) => setVals((s) => ({ ...s, [kind]: { ...s[kind], [p.name]: x } }));
    const opts = p.type === "boolean" ? ["true", "false"] : p.enum;
    return (
      <div className="field" key={kind + p.name}>
        <label htmlFor={`pg-${kind}-${p.name}`}>{p.name}{(p.required || kind === "path") && <span className="req"> *</span>}<span className="meta">{p.type === "array" ? `array<${p.items ?? "string"}>` : p.type}</span></label>
        {opts ? (
          <select id={`pg-${kind}-${p.name}`} value={v} onChange={(e) => set(e.target.value)}>{kind === "query" && <option value="">{p.default !== undefined ? `(default ${p.default})` : "(unset)"}</option>}{opts.map((o) => <option key={o}>{o}</option>)}</select>
        ) : (
          <input id={`pg-${kind}-${p.name}`} value={v} onChange={(e) => set(e.target.value)} placeholder={p.default !== undefined ? `default ${p.default}` : exStr(p.example)} autoComplete="off" spellCheck={false} />
        )}
        <small>{p.description}</small>
      </div>
    );
  };

  return (
    <section className="pg" id="playground" aria-label="API playground">
      <div className="pg-head">
        <select aria-label="Endpoint" value={id} onChange={(e) => select(e.target.value)}>
          {groups.map((g) => <optgroup key={g} label={g}>{endpoints.filter((e) => e.service === g).map((e) => <option key={e.id} value={e.id}>{e.method} {e.path.replace(/^\/api\/(roblox|discord)/, "")} · {e.summary}</option>)}</optgroup>)}
        </select>
        {auth === "unlocked" && <button className="btn small" onClick={lock} type="button">Lock</button>}
      </div>

      {auth !== "unlocked" ? (
        <div className="lock">
          <b>Unlock the playground</b>
          <span className="muted">Enter the API key once. The server swaps it for a signed one-hour cookie and discards it. The key is never kept in this page or in browser storage, and requests run on the server.</span>
          <input type="password" placeholder="API key" value={keyInput} onChange={(e) => setKeyInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && unlock()} autoComplete="off" aria-label="API key" />
          <div><button className="btn primary" type="button" onClick={unlock} disabled={!keyInput || auth === "unknown"}>Unlock</button></div>
          {err && <span className="err">{err}</span>}
        </div>
      ) : (
        <div className="pg-cols">
          <div>
            <div className="field"><label>Method</label><select value={def.method} disabled aria-label="HTTP method"><option>{def.method}</option></select></div>
            {def.params.filter((p) => p.in === "path").map((p) => field("path", p))}
            {def.params.filter((p) => p.in === "query").map((p) => field("query", p))}
            {def.method === "POST" && (
              <div className="field"><label htmlFor="pg-body">Request body (JSON)</label>
                <textarea id="pg-body" value={vals.body} onChange={(e) => setVals((s) => ({ ...s, body: e.target.value }))} spellCheck={false} /></div>)}
            <div className="field"><label>Custom headers</label>
              {headers.map((h, i) => (
                <div className="hdrrow" key={i}>
                  <input placeholder="x-request-id" aria-label="Header name" value={h.k} onChange={(e) => setHeaders((a) => a.map((x, j) => (j === i ? { ...x, k: e.target.value } : x)))} />
                  <input placeholder="value" aria-label="Header value" value={h.v} onChange={(e) => setHeaders((a) => a.map((x, j) => (j === i ? { ...x, v: e.target.value } : x)))} />
                  <button className="btn small" type="button" aria-label="Remove header" onClick={() => setHeaders((a) => a.filter((_, j) => j !== i))}>✕</button>
                </div>))}
              <button className="btn small" type="button" onClick={() => setHeaders((a) => [...a, { k: "", v: "" }])}>Add header</button>
              <small>x-api-key is added by the server and cannot be overridden. The API reads x-request-id for tracing.</small>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn primary" type="button" onClick={run} disabled={busy}>{busy ? "Sending…" : "Send request"}</button>
              <button className="btn" type="button" onClick={() => { setResp(null); setErr(null); }}>Clear</button>
              <button className="btn" type="button" onClick={() => { setVals(initial(def)); setHeaders([]); setResp(null); setErr(null); }}>Reset</button>
              <button className="btn" type="button" onClick={() => copy("curl", curl())}>{copied === "curl" ? "Copied" : "Copy as cURL"}</button>
            </div>
          </div>
          <div>
            <div className="fullurl" style={{ marginBottom: 12 }}>{def.method} {requestPath()}</div>
            {err && <p className="err">{err}</p>}
            {resp ? (<>
              <div className="resp-bar">
                <b className={`s${String(resp.status)[0]}xx`}>{resp.status} {resp.statusText}</b>
                <span className="muted">{resp.durationMs} ms</span>
                <span className="grow" />
                <button className="tabbtn" aria-pressed={tab === "body"} onClick={() => setTab("body")}>Body</button>
                <button className="tabbtn" aria-pressed={tab === "headers"} onClick={() => setTab("headers")}>Headers ({Object.keys(resp.headers).length})</button>
                <button className="btn small" type="button" onClick={() => copy("resp", pretty)}>{copied === "resp" ? "Copied" : "Copy response"}</button>
              </div>
              <div className="out">
                {tab === "body" ? <JsonView text={pretty} bordered={false} /> : (
                  <table><tbody>{Object.entries(resp.headers).map(([k, v]) => <tr key={k}><td className="nw"><code>{k}</code></td><td style={{ wordBreak: "break-all" }}>{v}</td></tr>)}</tbody></table>)}
              </div>
            </>) : !err && <div className="empty">Fill in the parameters and send the request. The response appears here.</div>}
          </div>
        </div>
      )}
    </section>
  );
}

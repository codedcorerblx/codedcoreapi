import type { ReactNode } from "react";

const RE = /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;

export function highlightJson(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0, i = 0, m: RegExpExecArray | null;
  RE.lastIndex = 0;
  while ((m = RE.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1] && m[2]) { out.push(<span key={i++} className="tk-key">{m[1]}</span>, m[2]); }
    else if (m[1]) out.push(<span key={i++} className="tk-str">{m[1]}</span>);
    else if (m[3]) out.push(<span key={i++} className="tk-bool">{m[0]}</span>);
    else if (m[0] === "null") out.push(<span key={i++} className="tk-null">null</span>);
    else out.push(<span key={i++} className="tk-num">{m[0]}</span>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function JsonView({ value, text, bordered = true }: { value?: unknown; text?: string; bordered?: boolean }) {
  const s = text ?? JSON.stringify(value, null, 2);
  return <pre className={`code${bordered ? " bordered" : ""}`}><code>{highlightJson(s)}</code></pre>;
}

export function Curl({ text }: { text: string }) {
  const nodes = text.split(/(\s-[A-Za-z]\s|^curl)/).map((p, i) =>
    p === "curl" ? <span key={i} className="tk-cmd">{p}</span> : /^\s-[A-Za-z]\s$/.test(p) ? <span key={i} className="tk-flag">{p}</span> : p);
  return <pre className="code bordered"><code>{nodes}</code></pre>;
}

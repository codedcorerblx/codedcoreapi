"use client";
import { useState } from "react";

export interface Point { t: number; total: number; failed: number }

export function VolumeChart({ points, hours, bucket }: { points: Point[]; hours: number; bucket: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const b = bucket * 1000;
  const end = Math.floor(Date.now() / b) * b;
  const start = end - Math.ceil((hours * 3600_000) / b) * b + b;
  const map = new Map(points.map((p) => [Number(p.t), p]));
  const bars: Point[] = [];
  for (let t = start; t <= end; t += b) bars.push(map.get(t) ?? { t, total: 0, failed: 0 });
  const max = Math.max(1, ...bars.map((x) => x.total));
  const W = 800, H = 220, L = 34, B = 22, T = 8;
  const bw = (W - L) / bars.length;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  const fmt = (t: number) => new Date(t).toLocaleString([], hours > 24 ? { month: "short", day: "numeric", hour: "2-digit" } : { hour: "2-digit", minute: "2-digit" });
  const h = hover !== null ? bars[hover] : null;
  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Requests over time" onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => <g key={f}><line x1={L} x2={W} y1={y(max * f)} y2={y(max * f)} stroke="var(--line-soft)" /><text x={L - 6} y={y(max * f) + 4} fontSize="11" fill="var(--faint)" textAnchor="end">{Math.round(max * f)}</text></g>)}
        {bars.map((p, i) => {
          const x = L + i * bw, ok = p.total - p.failed;
          return (
            <g key={p.t} onMouseEnter={() => setHover(i)}>
              <rect x={x} y={0} width={bw} height={H - B} fill={hover === i ? "var(--surface-2)" : "transparent"} />
              <rect x={x + 1} y={y(ok)} width={Math.max(bw - 2, 1)} height={H - B - y(ok)} fill="var(--amber)" rx="1.5" />
              <rect x={x + 1} y={y(p.total)} width={Math.max(bw - 2, 1)} height={y(ok) - y(p.total)} fill="var(--bad)" rx="1.5" />
            </g>);
        })}
        {[0, Math.floor(bars.length / 2), bars.length - 1].map((i) => <text key={i} x={L + i * bw + bw / 2} y={H - 6} fontSize="11" fill="var(--faint)" textAnchor={i === 0 ? "start" : i === bars.length - 1 ? "end" : "middle"}>{fmt(bars[i].t)}</text>)}
      </svg>
      {h && <div className="tip" style={{ left: `${((L + (hover! + 0.5) * bw) / W) * 100}%` }}><b>{h.total}</b> requests · <span className="s5xx">{h.failed} failed</span><br /><span className="muted">{fmt(h.t)}</span></div>}
    </div>
  );
}

export function BarList({ items, color }: { items: { label: string; value: number; color?: string; title?: string }[]; color?: string }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  if (!items.length) return <div className="empty">No data in this range.</div>;
  return <>{items.map((i) => (
    <div className="hbar" key={i.label} title={i.title ?? i.label}>
      <span className="name">{i.label}</span>
      <span className="track"><i style={{ width: `${(i.value / max) * 100}%`, background: i.color ?? color ?? "var(--amber)" }} /></span>
      <span>{i.value}</span>
    </div>))}</>;
}

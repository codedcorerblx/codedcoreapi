import Link from "next/link";
import type { PGEndpoint } from "./Playground";
import type { PublicEndpoint } from "@/lib/registry";

export const toPG = (l: PublicEndpoint[]): PGEndpoint[] =>
  l.map(({ id, service, tag, method, path, summary, params, bodyExample }) => ({ id, service, tag, method, path, summary, params, bodyExample }));

export function DocsHead({ active, title, blurb }: { active: "all" | "roblox" | "discord"; title: string; blurb: string }) {
  const tabs = [["all", "/docs", "Overview"], ["roblox", "/docs/roblox", "Roblox"], ["discord", "/docs/discord", "Discord"]] as const;
  return (
    <div className="pagehead">
      <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)" }}>{title}</h1>
      <p>{blurb}</p>
      <div className="tabs">
        {tabs.map(([k, href, label]) => <Link key={k} href={href} aria-current={active === k ? "page" : undefined}>{label}</Link>)}
        <Link href="/swagger">Swagger UI</Link><Link href="/openapi.json?download=1">Download OpenAPI</Link>
      </div>
    </div>
  );
}

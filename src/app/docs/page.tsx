import type { Metadata } from "next";
import Link from "next/link";
import { publicEndpoints } from "@/lib/registry";
import { getBaseUrl } from "@/lib/base-url";
import { Concepts, ServiceDocs, Sidebar } from "@/components/DocsView";
import Playground from "@/components/Playground";
import OpenOnHash from "@/components/OpenOnHash";
import { DocsHead, toPG } from "@/components/DocsHead";

export const metadata: Metadata = { title: "Documentation" };
export const dynamic = "force-dynamic";

export default async function DocsPage() {
  const base = await getBaseUrl();
  const all = publicEndpoints();
  const by = (s: string) => all.filter((e) => e.service === s);
  return (
    <div className="wrap">
      <DocsHead active="all" title="Documentation" blurb={`${all.length} endpoints across Roblox, Discord and system tools. Generated from one registry, so this page, the playground, Swagger and batch validation always agree.`} />
      <div className="docs">
        <Sidebar endpoints={all} />
        <div>
          <OpenOnHash />
          <h2>Concepts</h2>
          <Concepts />
          <h2 className="group" id="playground-title">Playground</h2>
          <p className="muted">Pick any endpoint, fill the generated form and send it. Requests execute on the server.</p>
          <Playground endpoints={toPG(all)} />
          <h2 className="group" id="roblox">Roblox API <Link className="muted" style={{ fontSize: ".9rem", fontWeight: 400 }} href="/docs/roblox">· open on its own page</Link></h2>
          <ServiceDocs endpoints={by("roblox")} base={base} />
          <h2 className="group" id="discord">Discord API <Link className="muted" style={{ fontSize: ".9rem", fontWeight: 400 }} href="/docs/discord">· open on its own page</Link></h2>
          <ServiceDocs endpoints={by("discord")} base={base} />
          <h2 className="group" id="system">Batch and system</h2>
          <ServiceDocs endpoints={by("system")} base={base} />
        </div>
      </div>
    </div>
  );
}

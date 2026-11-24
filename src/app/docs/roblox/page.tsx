import type { Metadata } from "next";
import { publicEndpoints } from "@/lib/registry";
import { getBaseUrl } from "@/lib/base-url";
import { ServiceDocs, Sidebar } from "@/components/DocsView";
import Playground from "@/components/Playground";
import OpenOnHash from "@/components/OpenOnHash";
import { DocsHead, toPG } from "@/components/DocsHead";

export const metadata: Metadata = { title: "Roblox API" };
export const dynamic = "force-dynamic";

export default async function Page() {
  const base = await getBaseUrl();
  const list = publicEndpoints().filter((e) => e.service === "roblox");
  return (
    <div className="wrap">
      <DocsHead active="roblox" title="Roblox API" blurb="All endpoints under /api/roblox/*. Authentication, the response envelope, pagination and error codes are explained on the main documentation page." />
      <div className="docs">
        <Sidebar endpoints={list} />
        <div>
          <OpenOnHash />
          <h2 id="playground-title">Playground</h2>
          <Playground endpoints={toPG(list)} />
          <h2 className="group">Endpoints</h2>
          <ServiceDocs endpoints={list} base={base} />
        </div>
      </div>
    </div>
  );
}

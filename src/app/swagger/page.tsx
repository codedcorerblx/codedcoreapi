import type { Metadata } from "next";
import SwaggerClient from "@/components/SwaggerClient";

export const metadata: Metadata = { title: "Swagger UI" };

export default function Swagger() {
  return (
    <div className="wrap">
      <div className="pagehead">
        <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)" }}>Swagger UI</h1>
        <p>Generated live from <code>/openapi.json</code>. Choose Authorize and paste the API key to try requests; the key stays in this tab&apos;s memory only. For keyless exploration use the playground in the documentation.</p>
      </div>
      <SwaggerClient />
    </div>
  );
}

import type { Metadata } from "next";
import { publicEndpoints } from "@/lib/registry";
import StatusDashboard from "@/components/StatusDashboard";

export const metadata: Metadata = { title: "Status" };

export default function StatusPage() {
  const eps = publicEndpoints().map(({ id, service, method, path, summary }) => ({ id, service, method, path, summary }));
  return (
    <div className="wrap">
      <div className="pagehead">
        <h1 style={{ fontSize: "clamp(2rem,4vw,2.8rem)" }}>Status and analytics</h1>
        <p>Live statistics for all {eps.length} endpoints, stored in Postgres so they survive restarts and are shared by every serverless instance. Only endpoint names, status codes and timings are recorded.</p>
      </div>
      <StatusDashboard endpoints={eps} />
    </div>
  );
}

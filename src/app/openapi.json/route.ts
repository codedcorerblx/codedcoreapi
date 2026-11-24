import { buildOpenApi } from "@/lib/openapi";
import { getBaseUrl } from "@/lib/base-url";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const spec = buildOpenApi(await getBaseUrl());
  const download = new URL(req.url).searchParams.has("download");
  return new Response(JSON.stringify(spec, null, 2), {
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=300",
      ...(download ? { "content-disposition": 'attachment; filename="openapi.json"' } : {}),
    },
  });
}

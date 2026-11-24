"use client";
import Script from "next/script";

const V = "5.17.14";
declare global { interface Window { SwaggerUIBundle?: ((o: Record<string, unknown>) => void) & { presets: { apis: unknown } } } }

export default function SwaggerClient() {
  return (
    <>
      <link rel="stylesheet" href={`https://cdn.jsdelivr.net/npm/swagger-ui-dist@${V}/swagger-ui.css`} />
      <Script src={`https://cdn.jsdelivr.net/npm/swagger-ui-dist@${V}/swagger-ui-bundle.js`} strategy="afterInteractive"
        onLoad={() => window.SwaggerUIBundle?.({ url: "/openapi.json", dom_id: "#swagger-ui", deepLinking: true, persistAuthorization: false, docExpansion: "list", defaultModelsExpandDepth: 0 })} />
      <div className="swagger-shell"><div id="swagger-ui" /></div>
    </>
  );
}

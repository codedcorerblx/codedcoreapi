import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, JetBrains_Mono } from "next/font/google";
import Link from "next/link";
import Nav from "@/components/Nav";
import "./globals.css";

const sans = Bricolage_Grotesque({ subsets: ["latin"], variable: "--font-bricolage", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", display: "swap" });

export const metadata: Metadata = {
  title: { default: "CodedCore API: private Roblox + Discord API proxy", template: "%s · CodedCore API" },
  description: "One private key in front of Roblox and Discord public data, with one JSON envelope, pagination, batching and live status.",
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { themeColor: "#0b1020" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable}`}>
      <body>
        <Nav />
        <main>{children}</main>
        <footer>
          <div className="wrap">
            <span>CodedCore API: every /api request needs the x-api-key header.</span>
            <span><Link href="/openapi.json">openapi.json</Link> · <Link href="/swagger">Swagger UI</Link></span>
          </div>
        </footer>
      </body>
    </html>
  );
}

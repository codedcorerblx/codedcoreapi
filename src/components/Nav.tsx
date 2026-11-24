"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

const items = [
  { href: "/", label: "Home", match: (p: string) => p === "/" },
  { href: "/docs", label: "Documentation", match: (p: string) => p.startsWith("/docs") || p === "/swagger" },
  { href: "/status", label: "Status", match: (p: string) => p.startsWith("/status") },
];

export default function Nav() {
  const path = usePathname();
  return (
    <header className="topbar">
      <div className="wrap">
        <Link href="/" className="brand"><i aria-hidden />CodedCore API</Link>
        <nav className="nav" aria-label="Primary">
          {items.map((i) => (
            <Link key={i.href} href={i.href} aria-current={i.match(path) ? "page" : undefined}>{i.label}</Link>
          ))}
        </nav>
        <div className="toplinks">
          <Link href="/swagger">Swagger</Link>
          <Link href="/openapi.json">OpenAPI</Link>
        </div>
      </div>
    </header>
  );
}

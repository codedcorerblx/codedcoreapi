import type { FieldDef, FieldType, ParamDef } from "./types";

/* field builders */
type Opts = { nullable?: boolean };
export const f = (name: string, type: FieldType, description: string, o: Opts = {}): FieldDef => ({ name, type, description, ...o });
export const str = (n: string, d: string, o?: Opts) => f(n, "string", d, o);
export const int = (n: string, d: string, o?: Opts) => f(n, "integer", d, o);
export const bool = (n: string, d: string, o?: Opts) => f(n, "boolean", d, o);
export const dt = (n: string, d: string, o?: Opts) => f(n, "datetime", d, o);
export const obj = (n: string, d: string, children: FieldDef[], o: Opts = {}): FieldDef => ({ name: n, type: "object", description: d, children, ...o });
export const arrOf = (n: string, d: string, children: FieldDef[], o: Opts = {}): FieldDef => ({ name: n, type: "array", description: d, children, ...o });
export const prim = (n: string, d: string, items: "string" | "integer", o: Opts = {}): FieldDef => ({ name: n, type: "array", description: d, items, ...o });

/* param builders */
export const idParam = (name: string, description: string, example: number | string): ParamDef =>
  ({ name, in: "path", type: "string", required: true, pattern: "^\\d{1,19}$", description, example });
export const snowflake = (name: string, description: string, example: string): ParamDef =>
  ({ name, in: "path", type: "string", required: true, pattern: "^\\d{15,21}$", description, example });
export const q = (name: string, type: ParamDef["type"], description: string, o: Partial<ParamDef> = {}): ParamDef =>
  ({ name, in: "query", type, description, ...o });

/** Keep only the listed keys that exist on the upstream object. */
export function pick<T extends object>(o: T | null | undefined, keys: string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!o) return out;
  for (const k of keys) if (k in o) out[k] = (o as Record<string, unknown>)[k];
  return out;
}

/** Run an upstream call and capture a failure as an `unavailable` section instead of failing the whole response. */
export async function settle<T>(section: string, p: Promise<T>, unavailable: { section: string; code: string; message: string }[]): Promise<T | null> {
  try { return await p; } catch (e) {
    const err = e as { code?: string; message?: string };
    unavailable.push({ section, code: err.code ?? "UPSTREAM_ERROR", message: err.message ?? "failed" });
    return null;
  }
}

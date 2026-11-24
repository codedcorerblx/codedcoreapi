import { robloxRequest as rb } from "./roblox";

export interface UserLite { id: number; name: string | null; displayName: string | null; hasVerifiedBadge: boolean | null }

/** Roblox's friends endpoints return "" (or nothing) for names; treat both as missing. */
export const text = (v: unknown): string | null => (typeof v === "string" && v.trim() !== "" ? v : null);

export function toLite(u: Record<string, unknown>): UserLite {
  return { id: Number(u.id ?? u.userId), name: text(u.name), displayName: text(u.displayName), hasVerifiedBadge: typeof u.hasVerifiedBadge === "boolean" ? u.hasVerifiedBadge : null };
}

/**
 * Fill names through POST users.roblox.com/v1/users (100 IDs per call, 3 calls in parallel).
 * Never throws: failures are reported in `warnings` and the affected items keep name=null.
 */
export async function hydrateUsers(items: UserLite[]): Promise<{ items: UserLite[]; warnings: string[] }> {
  const need = [...new Set(items.filter((i) => i.name === null || i.displayName === null).map((i) => i.id))];
  if (!need.length) return { items, warnings: [] };
  const found = new Map<number, Record<string, unknown>>();
  const chunks: number[][] = [];
  for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
  const warnings = new Set<string>();
  for (let i = 0; i < chunks.length; i += 3) {
    await Promise.all(chunks.slice(i, i + 3).map(async (ids) => {
      try {
        const r = await rb("users", "/v1/users", undefined, { method: "POST", body: { userIds: ids, excludeBannedUsers: false } });
        for (const u of (r?.data ?? []) as Record<string, unknown>[]) found.set(u.id as number, u);
      } catch (e) {
        const err = e as { code?: string; message?: string };
        warnings.add(`Name lookup failed for ${ids.length} users (${err.code ?? "ERROR"}: ${err.message ?? "unknown"})`);
      }
    }));
  }
  const out = items.map((i) => {
    const u = found.get(i.id);
    return u ? { id: i.id, name: text(u.name) ?? i.name, displayName: text(u.displayName) ?? i.displayName, hasVerifiedBadge: typeof u.hasVerifiedBadge === "boolean" ? u.hasVerifiedBadge : i.hasVerifiedBadge } : i;
  });
  const unresolved = out.filter((i) => i.name === null).length;
  if (unresolved && !warnings.size) warnings.add(`${unresolved} account(s) could not be resolved (deleted or terminated); name is null`);
  return { items: out, warnings: [...warnings] };
}

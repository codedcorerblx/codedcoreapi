import { robloxRequest as rb } from "./roblox";

export interface UserLite { id: number; name: string | null; displayName: string | null; hasVerifiedBadge: boolean | null }

/**
 * Roblox's friends/followers endpoints frequently return IDs without usable names.
 * Fill the gaps through POST users.roblox.com/v1/users (100 IDs per call, 3 calls in parallel).
 * Never throws: on failure the items are returned as-is and failed=true.
 */
export async function hydrateUsers(items: UserLite[]): Promise<{ items: UserLite[]; failed: boolean }> {
  const need = [...new Set(items.filter((i) => i.name === null || i.displayName === null).map((i) => i.id))];
  if (!need.length) return { items, failed: false };
  const found = new Map<number, Record<string, unknown>>();
  const chunks: number[][] = [];
  for (let i = 0; i < need.length; i += 100) chunks.push(need.slice(i, i + 100));
  let failed = false;
  for (let i = 0; i < chunks.length; i += 3) {
    await Promise.all(chunks.slice(i, i + 3).map(async (ids) => {
      try {
        const r = await rb("users", "/v1/users", undefined, { method: "POST", body: { userIds: ids, excludeBannedUsers: false } });
        for (const u of (r?.data ?? []) as Record<string, unknown>[]) found.set(u.id as number, u);
      } catch { failed = true; }
    }));
  }
  return {
    failed,
    items: items.map((i) => {
      const u = found.get(i.id);
      return u ? { id: i.id, name: (u.name as string) ?? i.name, displayName: (u.displayName as string) ?? i.displayName, hasVerifiedBadge: (u.hasVerifiedBadge as boolean) ?? i.hasVerifiedBadge } : i;
    }),
  };
}

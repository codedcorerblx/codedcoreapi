import { ApiError } from "./errors";
import { cacheGet, cacheSet, dedupe } from "./cache";
import { robloxRequest } from "./upstream/roblox";
import { discordRequest } from "./upstream/discord";

export type ResolveKind = "robloxUser" | "discordUser";
interface Ctx { params: Record<string, string>; query: Record<string, unknown> }

/** Turn an ID-or-username path value into an ID. All-digit Roblox values are IDs; prefix "@" to force a username. */
export async function resolveIdentity(kind: ResolveKind, input: string, ctx: Ctx): Promise<{ id: string; via: "id" | "username" }> {
  return kind === "robloxUser" ? roblox(input) : discord(input, ctx);
}

async function cached(key: string, ttl: number, fn: () => Promise<string>): Promise<string> {
  const hit = cacheGet<string>(key);
  if (hit) return hit;
  const v = await dedupe(key, fn);
  cacheSet(key, v, ttl);
  return v;
}

async function roblox(input: string) {
  if (/^\d+$/.test(input)) return { id: input, via: "id" as const };
  const name = input.replace(/^@/, "");
  const id = await cached(`resolve:rbx:${name.toLowerCase()}`, 600, async () => {
    const r = await robloxRequest("users", "/v1/usernames/users", undefined, { method: "POST", body: { usernames: [name], excludeBannedUsers: false } });
    const u = r?.data?.[0];
    if (!u) throw new ApiError("NOT_FOUND", `No Roblox user with the username "${name}"`);
    return String(u.id);
  });
  return { id, via: "username" as const };
}

/** Discord has no global username lookup. Names are resolved by searching one server's members (needs the Server Members Intent). */
async function discord(input: string, ctx: Ctx) {
  if (/^\d{15,21}$/.test(input)) return { id: input, via: "id" as const };
  const name = input.replace(/^@/, "").trim();
  const guild = (ctx.params.guildId ?? ctx.query.guildId) as string | undefined;
  if (!guild || !/^\d{15,21}$/.test(guild))
    throw new ApiError("INVALID_REQUEST", "Discord has no global username lookup. Pass the numeric user ID, or add guildId=<server id> so the username can be matched against that server's members.");
  const id = await cached(`resolve:dc:${guild}:${name.toLowerCase()}`, 300, async () => {
    const r = (await discordRequest(`/guilds/${guild}/members/search`, { query: name, limit: 10 }, { fallbackOnAccess: true })) as { user?: { id: string; username?: string; global_name?: string | null }; nick?: string | null }[];
    const n = name.toLowerCase();
    const hit = (pick: (m: (typeof r)[number]) => string | null | undefined) => r.filter((m) => pick(m)?.toLowerCase() === n);
    const exact = [hit((m) => m.user?.username), hit((m) => m.user?.global_name), hit((m) => m.nick)].find((l) => l.length > 0) ?? [];
    const ids = [...new Set(exact.map((m) => m.user!.id))];
    if (ids.length === 0) throw new ApiError("NOT_FOUND", `No member named "${name}" in that server`);
    if (ids.length > 1) throw new ApiError("INVALID_REQUEST", `"${name}" matches several members; use a numeric user ID`, { details: { candidates: ids } });
    return ids[0];
  });
  return { id, via: "username" as const };
}

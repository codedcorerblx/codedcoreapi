import { robloxRequest as rb } from "../upstream/roblox";
import { config } from "../config";
import { ApiError } from "../errors";
import { fetchImageBase64 } from "../http";
import { hydrateUsers, type UserLite } from "../upstream/roblox-users";
import { arrOf, bool, dt, f, idParam, int, obj, pick, prim, q, settle, str } from "./helpers";
import type { EndpointDefInput, FieldDef, HandlerContext, PageArgs, ParamDef } from "./types";

const ROBLOX = { service: "roblox" as const };
const optional = { ...ROBLOX, mode: "optional" as const, note: "Public data. Uses a rotating ROBLOX_COOKIES entry when configured, otherwise runs anonymously." };
const userId: ParamDef = {
  name: "userId", in: "path", type: "string", required: true, resolve: "robloxUser", pattern: "^(\\d{1,19}|@?[A-Za-z0-9_]{3,20})$", example: 1,
  description: "Roblox user ID **or username** (case-insensitive). All-digit values are treated as IDs; prefix @ to force a username. Usernames are resolved to IDs first and the result is reported in metadata.resolved.",
};
const hydrateParam = q("hydrate", "boolean", "Look up username, display name and verified badge for every ID. Roblox's friends endpoints do not return them reliably. Set false for a faster IDs-only response.", { default: true });
const socialFields: FieldDef[] = [
  int("id", "User ID."),
  str("name", "Username. null only if the account could not be resolved (deleted or terminated) or hydrate=false.", { nullable: true }),
  str("displayName", "Display name, null when unresolved.", { nullable: true }),
  bool("hasVerifiedBadge", "Verified badge, null when unresolved.", { nullable: true }),
];
const SOCIAL_EX = [{ id: 156, name: "builderman", displayName: "builderman", hasVerifiedBadge: true }];
async function socialItems(raw: Record<string, unknown>[], hydrate: boolean) {
  const base: UserLite[] = raw.map((u) => ({ id: (u.id ?? u.userId) as number, name: (u.name as string) ?? null, displayName: (u.displayName as string) ?? null, hasVerifiedBadge: (u.hasVerifiedBadge as boolean) ?? null }));
  return hydrate ? hydrateUsers(base) : { items: base, failed: false };
}
/** Current endpoint first; if it fails, fall back to the older paginated /friends/find listing. */
async function fetchFriends(id: string): Promise<Record<string, unknown>[]> {
  try {
    return ((await rb("friends", `/v1/users/${id}/friends`))?.data ?? []) as Record<string, unknown>[];
  } catch (first) {
    const code = (first as { code?: string }).code;
    if (code === "RATE_LIMITED" || code === "CREDENTIALS_UNAVAILABLE" || code === "UPSTREAM_TIMEOUT") throw first;
    const out: Record<string, unknown>[] = [];
    let cursor: string | undefined;
    try {
      for (let i = 0; i < 20; i++) {
        const r = await rb("friends", `/v1/users/${id}/friends/find`, { limit: 50, cursor });
        out.push(...(((r?.PageItems ?? r?.data) ?? []) as Record<string, unknown>[]));
        cursor = (r?.NextCursor ?? r?.nextPageCursor) || undefined;
        if (!cursor) break;
      }
    } catch { throw first; }
    return out;
  }
}
const groupId = idParam("groupId", "Roblox group ID.", 1200769);
const sortOrder = (d = "Asc"): ParamDef => q("sortOrder", "string", "Sort direction.", { enum: ["Asc", "Desc"], default: d });
const OPAQUE = "Cursors are opaque Roblox tokens.";
const P10_100 = { default: 25, max: 100, allowed: [10, 25, 50, 100], cursorNote: OPAQUE };

const userBrief: FieldDef[] = [
  int("id", "User ID."), str("name", "Username."), str("displayName", "Display name."),
  bool("hasVerifiedBadge", "Whether the user has the verified badge."),
];
const userKeys = ["id", "name", "displayName", "hasVerifiedBadge"];
const gameFields: FieldDef[] = [
  int("id", "Universe ID."), str("name", "Experience name."), str("description", "Description.", { nullable: true }),
  obj("creator", "Creator.", [int("id", "Creator ID."), str("type", "User or Group.")]),
  obj("rootPlace", "Start place.", [int("id", "Place ID."), str("type", "Always Place.")]),
  dt("created", "Creation time."), dt("updated", "Last update time."), int("placeVisits", "Total visits."),
];
const gameKeys = ["id", "name", "description", "creator", "rootPlace", "created", "updated", "placeVisits"];
const badgeFields: FieldDef[] = [
  int("id", "Badge ID."), str("name", "Badge name."), str("description", "Description.", { nullable: true }),
  bool("enabled", "Whether the badge can currently be awarded."), int("iconImageId", "Icon asset ID."),
  dt("created", "Creation time."), dt("updated", "Last update time."),
  obj("statistics", "Award statistics.", [int("pastDayAwardedCount", "Awards in the past day."), int("awardedCount", "Total awards."), f("winRatePercentage", "number", "Win rate (0–1 fraction as returned by Roblox).")]),
  obj("awardingUniverse", "Experience that awards the badge.", [int("id", "Universe ID."), str("name", "Name."), int("rootPlaceId", "Root place ID.")], { nullable: true }),
];
const badgeKeys = ["id", "name", "description", "enabled", "iconImageId", "created", "updated", "statistics", "awardingUniverse"];

const page = (host: Parameters<typeof rb>[0], path: (c: HandlerContext) => string, extra: (c: HandlerContext) => Record<string, unknown>, map: (x: Record<string, unknown>) => unknown, opts?: Parameters<typeof rb>[3]) =>
  async (c: HandlerContext, { cursor, limit }: PageArgs) => {
    const r = await rb(host, path(c), { limit, cursor: cursor ?? undefined, ...extra(c) }, opts);
    return { items: ((r?.data ?? []) as Record<string, unknown>[]).map(map), nextCursor: (r?.nextPageCursor as string) || null };
  };

const USER_EX = { id: 1, name: "Roblox", displayName: "Roblox", hasVerifiedBadge: true };
const TS = "2026-01-15T12:00:00.000Z";

export const robloxEndpoints: EndpointDefInput[] = [
  /* ───────── Users ───────── */
  {
    id: "roblox.users.lookup", service: "roblox", tag: "Users", method: "GET", path: "/api/roblox/users/lookup",
    summary: "Resolve usernames to user IDs",
    description: "Looks up to 100 usernames at once (case-insensitive) and returns the matching accounts. Names that do not exist are listed in notFound.",
    params: [
      q("usernames", "array", "Comma-separated usernames.", { required: true, items: "string", maxItems: 100, example: ["Roblox", "builderman"] }),
      q("excludeBanned", "boolean", "Skip banned accounts.", { default: false }),
    ],
    credential: optional, cacheTtl: 120, batchable: true,
    fields: [
      arrOf("users", "Accounts found.", [str("requestedUsername", "Name as you requested it."), ...userBrief]),
      prim("notFound", "Requested names with no matching account.", "string"),
    ],
    example: { users: [{ requestedUsername: "Roblox", ...USER_EX }], notFound: [] },
    handler: async ({ query }) => {
      const names = query.usernames as string[];
      const r = await rb("users", "/v1/usernames/users", undefined, { method: "POST", body: { usernames: names, excludeBannedUsers: query.excludeBanned } });
      const users = ((r?.data ?? []) as Record<string, unknown>[]).map((u) => pick(u, ["requestedUsername", ...userKeys]));
      const found = new Set(users.map((u) => String(u.requestedUsername).toLowerCase()));
      return { data: { users, notFound: names.filter((n) => !found.has(n.toLowerCase())) }, availability: users.length ? "available" : "empty" };
    },
  },
  {
    id: "roblox.users.search", service: "roblox", tag: "Users", method: "GET", path: "/api/roblox/users/search",
    summary: "Search users by keyword",
    description: "Keyword search over usernames and display names.",
    params: [q("keyword", "string", "Search text.", { required: true, maxLength: 100, example: "builder" })],
    credential: optional, cacheTtl: 60, batchable: true,
    pagination: P10_100,
    fields: [...userBrief, prim("previousUsernames", "Earlier usernames.", "string")],
    example: [{ ...USER_EX, id: 156, name: "builderman", displayName: "builderman", previousUsernames: [] }],
    errors: { INVALID_REQUEST: "Roblox rejects filtered or too-short keywords." },
    list: page("users", () => "/v1/users/search", (c) => ({ keyword: c.query.keyword }), (u) => pick(u, [...userKeys, "previousUsernames"])),
  },
  {
    id: "roblox.users.get", service: "roblox", tag: "Users", method: "GET", path: "/api/roblox/users/{userId}",
    summary: "Get a user",
    description: "Core public account information.",
    params: [userId], credential: optional, cacheTtl: 120, batchable: true,
    fields: [...userBrief, str("description", "Profile 'About' text (may be empty).", { nullable: true }), dt("created", "Account creation time."), bool("isBanned", "Whether the account is terminated.")],
    example: { ...USER_EX, description: "Welcome to the Roblox profile!", created: "2006-02-27T21:06:40.300Z", isBanned: false },
    errors: { NOT_FOUND: "No user with this ID." },
    handler: async ({ params }) => {
      const u = await rb("users", `/v1/users/${params.userId}`, undefined, { notFound: "User not found" });
      return { data: pick(u, [...userKeys, "description", "created", "isBanned"]) };
    },
  },
  {
    id: "roblox.users.profile", service: "roblox", tag: "Users", method: "GET", path: "/api/roblox/users/{userId}/profile",
    summary: "Profile overview (user + status + counts + headshot)",
    description: "One call that combines the account, status message, friend/follower/following counts and headshot URL. Sections that fail upstream are reported in `unavailable` and the response becomes availability=partial instead of failing.",
    params: [userId], credential: optional, cacheTtl: 120, batchable: true,
    fields: [
      ...userBrief, str("description", "Profile text.", { nullable: true }), dt("created", "Account creation time."), bool("isBanned", "Terminated flag."),
      str("status", "Status message, null when unavailable or unset.", { nullable: true }),
      obj("counts", "Social counts.", [int("friends", "Friend count.", { nullable: true }), int("followers", "Follower count.", { nullable: true }), int("following", "Following count.", { nullable: true })]),
      str("headshotUrl", "150×150 PNG headshot URL, null while pending or unavailable.", { nullable: true }),
      arrOf("unavailable", "Sections that could not be loaded.", [str("section", "Section name."), str("code", "Error code."), str("message", "Reason.")]),
    ],
    example: { ...USER_EX, description: "Welcome!", created: "2006-02-27T21:06:40.300Z", isBanned: false, status: "Hello!", counts: { friends: 20, followers: 12000000, following: 3 }, headshotUrl: "https://tr.rbxcdn.com/.../150/150/AvatarHeadshot/Png", unavailable: [] },
    errors: { NOT_FOUND: "No user with this ID." },
    handler: async ({ params }) => {
      const id = params.userId;
      const unavailable: { section: string; code: string; message: string }[] = [];
      const [user, status, fr, fo, fg, thumb] = await Promise.all([
        rb("users", `/v1/users/${id}`, undefined, { notFound: "User not found" }),
        settle("status", rb("users", `/v1/users/${id}/status`), unavailable),
        settle("friends", rb("friends", `/v1/users/${id}/friends/count`), unavailable),
        settle("followers", rb("friends", `/v1/users/${id}/followers/count`), unavailable),
        settle("following", rb("friends", `/v1/users/${id}/followings/count`), unavailable),
        settle("headshot", rb("thumbnails", "/v1/users/avatar-headshot", { userIds: id, size: "150x150", format: "Png" }), unavailable),
      ]);
      const t = thumb?.data?.[0];
      return {
        data: { ...pick(user, [...userKeys, "description", "created", "isBanned"]), status: status?.status ?? null,
          counts: { friends: fr?.count ?? null, followers: fo?.count ?? null, following: fg?.count ?? null },
          headshotUrl: t?.state === "Completed" ? t.imageUrl : null, unavailable },
        availability: unavailable.length ? "partial" : "available",
      };
    },
  },
  {
    id: "roblox.users.usernameHistory", service: "roblox", tag: "Users", method: "GET", path: "/api/roblox/users/{userId}/username-history",
    summary: "Previous usernames", description: "Past usernames of the account, newest first by default.",
    params: [userId, sortOrder("Desc")], credential: optional, cacheTtl: 300, batchable: true, pagination: P10_100,
    fields: [str("name", "A previous username.")], example: [{ name: "OldName" }],
    list: page("users", (c) => `/v1/users/${c.params.userId}/username-history`, (c) => ({ sortOrder: c.query.sortOrder }), (x) => pick(x, ["name"])),
  },
  {
    id: "roblox.users.counts", service: "roblox", tag: "Users", method: "GET", path: "/api/roblox/users/{userId}/counts",
    summary: "Friend, follower and following counts", description: "Three cheap count calls in parallel – use this instead of listing everyone when you only need totals.",
    params: [userId], credential: optional, cacheTtl: 120, batchable: true,
    fields: [int("friends", "Friend count."), int("followers", "Follower count."), int("following", "Following count.")],
    example: { friends: 20, followers: 12000000, following: 3 },
    handler: async ({ params }) => {
      const id = params.userId;
      const [a, b, c] = await Promise.all(["friends", "followers", "followings"].map((k) => rb("friends", `/v1/users/${id}/${k}/count`)));
      return { data: { friends: a.count, followers: b.count, following: c.count } };
    },
  },
  {
    id: "roblox.users.friends", service: "roblox", tag: "Social", method: "GET", path: "/api/roblox/users/{userId}/friends",
    summary: "List friends", description: "All friends of the user, with usernames filled in. Roblox's friends endpoint returns IDs with unreliable names, so the proxy collects the IDs (falling back to the older paginated listing if needed) and then resolves names in batches of 100. Not paginated.",
    params: [userId, hydrateParam], credential: optional, cacheTtl: 120, batchable: true,
    fields: socialFields, example: SOCIAL_EX, errors: { NOT_FOUND: "User not found." },
    notes: ["metadata.availability is partial when some names could not be looked up; those entries keep their id with name=null."],
    handler: async ({ params, query }) => {
      const { items, failed } = await socialItems(await fetchFriends(params.userId), query.hydrate);
      return { data: items, availability: items.length === 0 ? "empty" : failed ? "partial" : "available" };
    },
  },
  ...(["followers", "following"] as const).map((kind): EndpointDefInput => ({
    id: `roblox.users.${kind}`, service: "roblox", tag: "Social", method: "GET", path: `/api/roblox/users/{userId}/${kind}`,
    summary: `List ${kind}`, description: `Accounts that ${kind === "followers" ? "follow this user" : "this user follows"}, with usernames filled in (see hydrate).`,
    params: [userId, sortOrder("Desc"), hydrateParam], credential: optional, cacheTtl: 60, batchable: true,
    pagination: { default: 25, max: 100, allowed: [10, 18, 25, 50, 100], cursorNote: OPAQUE },
    fields: socialFields, example: SOCIAL_EX,
    list: async (c, { cursor, limit }) => {
      const r = await rb("friends", `/v1/users/${c.params.userId}/${kind === "following" ? "followings" : "followers"}`, { limit, cursor: cursor ?? undefined, sortOrder: c.query.sortOrder });
      const { items } = await socialItems((r?.data ?? []) as Record<string, unknown>[], c.query.hydrate);
      return { items, nextCursor: (r?.nextPageCursor as string) || null };
    },
  })),
  {
    id: "roblox.users.presence", service: "roblox", tag: "Social", method: "GET", path: "/api/roblox/users/{userId}/presence",
    summary: "Online presence", description: "Whether the user is online, in a game or in Studio. Respects the user's privacy settings: hidden users appear Offline with no location.",
    params: [userId], cacheTtl: 15, batchable: true,
    credential: { service: "roblox", mode: "required", note: "Roblox only serves presence to authenticated sessions. Needs at least one ROBLOX_COOKIES entry." },
    fields: [int("userId", "User ID."), str("presence", "Offline | Online | InGame | InStudio | Invisible"), int("presenceTypeId", "Raw Roblox presence code (0–4)."),
      str("lastLocation", "Human-readable location.", { nullable: true }), int("placeId", "Current place.", { nullable: true }), int("rootPlaceId", "Root place of the experience.", { nullable: true }),
      str("gameId", "Server (job) ID.", { nullable: true }), int("universeId", "Universe ID.", { nullable: true }), dt("lastOnline", "Last online time.", { nullable: true })],
    example: { userId: 1, presence: "Offline", presenceTypeId: 0, lastLocation: "Offline", placeId: null, rootPlaceId: null, gameId: null, universeId: null, lastOnline: TS },
    errors: { CREDENTIALS_UNAVAILABLE: "No ROBLOX_COOKIES configured, or all are invalid." },
    handler: async ({ params }) => {
      const r = await rb("presence", "/v1/presence/users", undefined, { method: "POST", body: { userIds: [Number(params.userId)] }, auth: "required" });
      const p = r?.userPresences?.[0];
      if (!p) throw new ApiError("NOT_FOUND", "No presence returned for this user");
      return { data: { userId: p.userId, presence: ["Offline", "Online", "InGame", "InStudio", "Invisible"][p.userPresenceType] ?? "Offline", presenceTypeId: p.userPresenceType,
        lastLocation: p.lastLocation ?? null, placeId: p.placeId ?? null, rootPlaceId: p.rootPlaceId ?? null, gameId: p.gameId ?? null, universeId: p.universeId ?? null, lastOnline: p.lastOnline ?? null } };
    },
  },
  /* ───────── Groups ───────── */
  {
    id: "roblox.users.groups", service: "roblox", tag: "Groups", method: "GET", path: "/api/roblox/users/{userId}/groups",
    summary: "Groups a user belongs to", description: "Every group the user is in with their role. Not paginated upstream.",
    params: [userId, q("includeLocked", "boolean", "Include locked (moderated) groups.", { default: false })], credential: optional, cacheTtl: 120, batchable: true,
    fields: [
      obj("group", "The group.", [int("id", "Group ID."), str("name", "Name."), int("memberCount", "Members."), bool("hasVerifiedBadge", "Verified badge.")]),
      obj("role", "The user's role.", [int("id", "Role ID."), str("name", "Role name."), int("rank", "Rank 0–255.")]),
    ],
    example: [{ group: { id: 1200769, name: "Roblox Group", memberCount: 1000, hasVerifiedBadge: true }, role: { id: 1, name: "Member", rank: 1 } }],
    handler: async ({ params, query }) => {
      const r = await rb("groups", `/v2/users/${params.userId}/groups/roles`, { includeLocked: query.includeLocked });
      return { data: ((r?.data ?? []) as { group: Record<string, unknown>; role: Record<string, unknown> }[]).map((x) => ({
        group: pick(x.group, ["id", "name", "memberCount", "hasVerifiedBadge"]), role: pick(x.role, ["id", "name", "rank"]) })) };
    },
  },
  {
    id: "roblox.groups.search", service: "roblox", tag: "Groups", method: "GET", path: "/api/roblox/groups/search",
    summary: "Search groups", description: "Keyword search over group names.",
    params: [q("keyword", "string", "Search text.", { required: true, maxLength: 100, example: "roblox" }), q("prioritizeExactMatch", "boolean", "Put an exact name match first.", { default: false })],
    credential: optional, cacheTtl: 60, batchable: true, pagination: P10_100,
    fields: [int("id", "Group ID."), str("name", "Name."), str("description", "Description.", { nullable: true }), int("memberCount", "Members."), bool("publicEntryAllowed", "Anyone can join."), dt("created", "Created."), dt("updated", "Updated."), bool("hasVerifiedBadge", "Verified badge.")],
    example: [{ id: 1200769, name: "Roblox Group", description: "", memberCount: 1000, publicEntryAllowed: true, created: "2012-01-01T00:00:00Z", updated: TS, hasVerifiedBadge: true }],
    list: page("groups", () => "/v1/groups/search", (c) => ({ keyword: c.query.keyword, prioritizeExactMatch: c.query.prioritizeExactMatch }),
      (g) => pick(g, ["id", "name", "description", "memberCount", "publicEntryAllowed", "created", "updated", "hasVerifiedBadge"])),
  },
  {
    id: "roblox.groups.get", service: "roblox", tag: "Groups", method: "GET", path: "/api/roblox/groups/{groupId}",
    summary: "Get a group", description: "Group details including owner and current shout.",
    params: [groupId], credential: optional, cacheTtl: 120, batchable: true,
    fields: [
      int("id", "Group ID."), str("name", "Name."), str("description", "Description.", { nullable: true }),
      obj("owner", "Owner, null for ownerless groups.", [int("userId", "Owner ID."), str("username", "Username."), str("displayName", "Display name."), bool("hasVerifiedBadge", "Verified badge.")], { nullable: true }),
      obj("shout", "Current group shout, null if none.", [str("body", "Shout text."), dt("created", "Posted."), dt("updated", "Updated.")], { nullable: true }),
      int("memberCount", "Members."), bool("isBuildersClubOnly", "Premium only."), bool("publicEntryAllowed", "Anyone can join."), bool("hasVerifiedBadge", "Verified badge."),
    ],
    example: { id: 1200769, name: "Roblox Group", description: "", owner: { userId: 1, username: "Roblox", displayName: "Roblox", hasVerifiedBadge: true }, shout: null, memberCount: 1000, isBuildersClubOnly: false, publicEntryAllowed: true, hasVerifiedBadge: true },
    errors: { NOT_FOUND: "No group with this ID." },
    handler: async ({ params }) => {
      const g = await rb("groups", `/v1/groups/${params.groupId}`, undefined, { notFound: "Group not found" });
      const out = pick(g, ["id", "name", "description", "owner", "shout", "memberCount", "isBuildersClubOnly", "publicEntryAllowed", "hasVerifiedBadge"]);
      if (out.owner) out.owner = pick(out.owner as object, ["userId", "username", "displayName", "hasVerifiedBadge"]);
      if (out.shout) out.shout = pick(out.shout as object, ["body", "created", "updated"]);
      return { data: out };
    },
  },
  {
    id: "roblox.groups.roles", service: "roblox", tag: "Groups", method: "GET", path: "/api/roblox/groups/{groupId}/roles",
    summary: "Group roles", description: "All ranks of a group with member counts.",
    params: [groupId], credential: optional, cacheTtl: 300, batchable: true,
    fields: [int("id", "Role ID."), str("name", "Role name."), int("rank", "Rank 0–255."), int("memberCount", "Members with the role.", { nullable: true })],
    example: [{ id: 1, name: "Guest", rank: 0, memberCount: null }],
    errors: { NOT_FOUND: "No group with this ID." },
    handler: async ({ params }) => {
      const r = await rb("groups", `/v1/groups/${params.groupId}/roles`, undefined, { notFound: "Group not found" });
      return { data: ((r?.roles ?? []) as Record<string, unknown>[]).map((x) => ({ memberCount: null, ...pick(x, ["id", "name", "rank", "memberCount"]) })) };
    },
  },
  {
    id: "roblox.groups.members", service: "roblox", tag: "Groups", method: "GET", path: "/api/roblox/groups/{groupId}/members",
    summary: "Group members", description: "Members with their role. Large groups hold millions of members: prefer manual pagination or set maxItems with cursor=auto.",
    params: [groupId, sortOrder("Asc")], credential: optional, cacheTtl: 60, batchable: true, pagination: P10_100,
    fields: [obj("user", "Member.", [int("userId", "User ID."), str("username", "Username."), str("displayName", "Display name."), bool("hasVerifiedBadge", "Verified badge.")]),
      obj("role", "Member's role.", [int("id", "Role ID."), str("name", "Role name."), int("rank", "Rank.")])],
    example: [{ user: { userId: 1, username: "Roblox", displayName: "Roblox", hasVerifiedBadge: true }, role: { id: 1, name: "Member", rank: 1 } }],
    errors: { NOT_FOUND: "No group with this ID.", PRIVATE: "The group hides its member list." },
    list: page("groups", (c) => `/v1/groups/${c.params.groupId}/users`, (c) => ({ sortOrder: c.query.sortOrder }),
      (x) => ({ user: pick(x.user as object, ["userId", "username", "displayName", "hasVerifiedBadge"]), role: pick(x.role as object, ["id", "name", "rank"]) }), { forbiddenAs: "PRIVATE", notFound: "Group not found" }),
  },
  {
    id: "roblox.groups.games", service: "roblox", tag: "Groups", method: "GET", path: "/api/roblox/groups/{groupId}/games",
    summary: "Experiences owned by a group", description: "Public experiences created by the group.",
    params: [groupId, sortOrder("Asc")], credential: optional, cacheTtl: 120, batchable: true,
    pagination: { default: 25, max: 50, allowed: [10, 25, 50], cursorNote: OPAQUE },
    fields: gameFields, example: [{ id: 1, name: "Example", description: null, creator: { id: 1200769, type: "Group" }, rootPlace: { id: 2, type: "Place" }, created: TS, updated: TS, placeVisits: 100 }],
    list: page("games", (c) => `/v2/groups/${c.params.groupId}/games`, (c) => ({ accessFilter: "Public", sortOrder: c.query.sortOrder }), (g) => pick(g, gameKeys)),
  },
  /* ───────── Badges ───────── */
  {
    id: "roblox.users.badges", service: "roblox", tag: "Badges", method: "GET", path: "/api/roblox/users/{userId}/badges",
    summary: "Badges earned by a user", description: "Badges owned by the user, with award statistics.",
    params: [userId, sortOrder("Asc")], credential: optional, cacheTtl: 120, batchable: true, pagination: P10_100,
    fields: badgeFields, example: [{ id: 1, name: "Welcome", description: null, enabled: true, iconImageId: 2124533, created: TS, updated: TS, statistics: { pastDayAwardedCount: 10, awardedCount: 1000, winRatePercentage: 0.5 }, awardingUniverse: { id: 1, name: "Place", rootPlaceId: 2 } }],
    errors: { NOT_FOUND: "User not found." },
    list: page("badges", (c) => `/v1/users/${c.params.userId}/badges`, (c) => ({ sortOrder: c.query.sortOrder }), (b) => pick(b, badgeKeys)),
  },
  {
    id: "roblox.badges.get", service: "roblox", tag: "Badges", method: "GET", path: "/api/roblox/badges/{badgeId}",
    summary: "Get a badge", description: "Details of a single badge.",
    params: [idParam("badgeId", "Badge ID.", 2124533)], credential: optional, cacheTtl: 300, batchable: true,
    fields: badgeFields, example: { id: 2124533, name: "Welcome", description: null, enabled: true, iconImageId: 2124533, created: TS, updated: TS, statistics: { pastDayAwardedCount: 10, awardedCount: 1000, winRatePercentage: 0.5 }, awardingUniverse: null },
    errors: { NOT_FOUND: "No badge with this ID." },
    handler: async ({ params }) => ({ data: pick(await rb("badges", `/v1/badges/${params.badgeId}`, undefined, { notFound: "Badge not found" }), badgeKeys) }),
  },
  /* ───────── Inventory ───────── */
  {
    id: "roblox.users.inventory", service: "roblox", tag: "Inventory", method: "GET", path: "/api/roblox/users/{userId}/inventory",
    summary: "Public inventory", description: "Items in the user's inventory. Only works when the owner's inventory privacy is Everyone: otherwise the error is PRIVATE (not an empty list). Use can-view first to check cheaply.",
    params: [userId, q("assetTypes", "string", "Comma-separated Roblox asset type names, e.g. Hat,Shirt,Pants,Model,Decal,Face,Gear.", { required: true, maxLength: 200, example: "Hat,Shirt" }), sortOrder("Asc")],
    credential: optional, cacheTtl: 120, batchable: true, pagination: P10_100,
    fields: [int("assetId", "Catalog/asset ID."), str("name", "Item name."), str("assetType", "Asset type name."), dt("created", "When the user obtained it.")],
    example: [{ assetId: 1028606, name: "Red Baseball Cap", assetType: "Hat", created: TS }],
    errors: { PRIVATE: "The user's inventory is hidden.", NOT_FOUND: "User not found." },
    list: page("inventory", (c) => `/v2/users/${c.params.userId}/inventory`, (c) => ({ assetTypes: c.query.assetTypes, sortOrder: c.query.sortOrder }),
      (i) => pick(i, ["assetId", "name", "assetType", "created"]), { forbiddenAs: "PRIVATE" }),
  },
  {
    id: "roblox.users.canViewInventory", service: "roblox", tag: "Inventory", method: "GET", path: "/api/roblox/users/{userId}/inventory/can-view",
    summary: "Is the inventory public?", description: "Cheap privacy check before requesting the inventory.",
    params: [userId], credential: optional, cacheTtl: 120, batchable: true,
    fields: [bool("canView", "true when the inventory is viewable.")], example: { canView: true },
    handler: async ({ params }) => ({ data: { canView: Boolean((await rb("inventory", `/v1/users/${params.userId}/can-view-inventory`))?.canView) } }),
  },
  {
    id: "roblox.users.owns", service: "roblox", tag: "Inventory", method: "GET", path: "/api/roblox/users/{userId}/owns/{itemType}/{itemId}",
    summary: "Does the user own an item?", description: "Ownership check for an asset, game pass, badge or bundle.",
    params: [userId, { name: "itemType", in: "path", type: "string", required: true, enum: ["Asset", "GamePass", "Badge", "Bundle"], description: "Kind of item.", example: "Asset" }, idParam("itemId", "Item ID.", 1028606)],
    credential: optional, cacheTtl: 60, batchable: true,
    fields: [int("userId", "User ID."), str("itemType", "Item kind."), int("itemId", "Item ID."), bool("owned", "true if owned.")],
    example: { userId: 1, itemType: "Asset", itemId: 1028606, owned: false },
    errors: { PRIVATE: "The user's inventory is hidden." },
    handler: async ({ params }) => {
      const r = await rb("inventory", `/v1/users/${params.userId}/items/${params.itemType}/${params.itemId}/is-owned`, undefined, { forbiddenAs: "PRIVATE" });
      return { data: { userId: Number(params.userId), itemType: params.itemType, itemId: Number(params.itemId), owned: r === true } };
    },
  },
  /* ───────── Games ───────── */
  {
    id: "roblox.users.games", service: "roblox", tag: "Games", method: "GET", path: "/api/roblox/users/{userId}/games",
    summary: "Experiences created by a user", description: "Public experiences made by the user.",
    params: [userId, sortOrder("Asc")], credential: optional, cacheTtl: 120, batchable: true,
    pagination: { default: 25, max: 50, allowed: [10, 25, 50], cursorNote: OPAQUE },
    fields: gameFields, example: [{ id: 1, name: "Example", description: null, creator: { id: 1, type: "User" }, rootPlace: { id: 2, type: "Place" }, created: TS, updated: TS, placeVisits: 100 }],
    list: page("games", (c) => `/v2/users/${c.params.userId}/games`, (c) => ({ accessFilter: "Public", sortOrder: c.query.sortOrder }), (g) => pick(g, gameKeys)),
  },
  {
    id: "roblox.games.get", service: "roblox", tag: "Games", method: "GET", path: "/api/roblox/games/{universeId}",
    summary: "Experience details and votes", description: "Details plus like/dislike counts for a universe (not a place). Convert a place ID with /places/{placeId}/universe.",
    params: [idParam("universeId", "Universe ID.", 1)], credential: optional, cacheTtl: 60, batchable: true,
    fields: [
      int("id", "Universe ID."), int("rootPlaceId", "Start place ID."), str("name", "Name."), str("description", "Description.", { nullable: true }),
      obj("creator", "Creator.", [int("id", "ID."), str("name", "Name."), str("type", "User or Group."), bool("hasVerifiedBadge", "Verified badge.")]),
      int("price", "Price in Robux, null when free.", { nullable: true }), int("playing", "Players now."), int("visits", "Total visits."), int("maxPlayers", "Server size."),
      dt("created", "Created."), dt("updated", "Updated."), str("genre", "Genre."), int("favoritedCount", "Favorites."),
      obj("votes", "Votes, null if they could not be loaded.", [int("upVotes", "Likes."), int("downVotes", "Dislikes.")], { nullable: true }),
    ],
    example: { id: 1, rootPlaceId: 2, name: "Example", description: null, creator: { id: 1, name: "Roblox", type: "User", hasVerifiedBadge: true }, price: null, playing: 120, visits: 1000000, maxPlayers: 20, created: TS, updated: TS, genre: "All", favoritedCount: 5000, votes: { upVotes: 900, downVotes: 40 } },
    errors: { NOT_FOUND: "No such universe." },
    handler: async ({ params }) => {
      const id = params.universeId;
      const [g, v] = await Promise.all([rb("games", "/v1/games", { universeIds: id }), rb("games", "/v1/games/votes", { universeIds: id }).catch(() => null)]);
      const d = g?.data?.[0];
      if (!d) throw new ApiError("NOT_FOUND", "Universe not found");
      const vote = v?.data?.[0];
      return { data: { ...pick(d, ["id", "rootPlaceId", "name", "description", "creator", "price", "playing", "visits", "maxPlayers", "created", "updated", "genre", "favoritedCount"]),
        votes: vote ? { upVotes: vote.upVotes, downVotes: vote.downVotes } : null }, availability: vote ? "available" : "partial" };
    },
  },
  {
    id: "roblox.places.universe", service: "roblox", tag: "Games", method: "GET", path: "/api/roblox/places/{placeId}/universe",
    summary: "Place → universe ID", description: "Resolves the universe that owns a place.",
    params: [idParam("placeId", "Place ID.", 2)], credential: optional, cacheTtl: 3600, batchable: true,
    fields: [int("placeId", "Place ID."), int("universeId", "Universe ID.", { nullable: true })], example: { placeId: 2, universeId: 1 },
    errors: { NOT_FOUND: "No such place." },
    handler: async ({ params }) => {
      const r = await rb("apis", `/universes/v1/places/${params.placeId}/universe`, undefined, { notFound: "Place not found" });
      return { data: { placeId: Number(params.placeId), universeId: r?.universeId ?? null } };
    },
  },
  /* ───────── Avatars ───────── */
  {
    id: "roblox.users.avatar", service: "roblox", tag: "Avatars", method: "GET", path: "/api/roblox/users/{userId}/avatar",
    summary: "Avatar configuration", description: "Body scales, colors and the assets currently worn.",
    params: [userId], credential: optional, cacheTtl: 120, batchable: true,
    fields: [
      obj("scales", "Body scales.", [f("height", "number", "Height."), f("width", "number", "Width."), f("head", "number", "Head."), f("depth", "number", "Depth."), f("proportion", "number", "Proportion."), f("bodyType", "number", "Body type.")]),
      str("playerAvatarType", "R6 or R15."),
      f("bodyColors", "object", "Body color IDs (headColorId, torsoColorId, …) as returned by Roblox."),
      arrOf("assets", "Worn assets.", [int("id", "Asset ID."), str("name", "Name."), obj("assetType", "Type.", [int("id", "Type ID."), str("name", "Type name.")])]),
      bool("defaultShirtApplied", "Default shirt in use."), bool("defaultPantsApplied", "Default pants in use."),
    ],
    example: { scales: { height: 1, width: 1, head: 1, depth: 1, proportion: 0, bodyType: 0 }, playerAvatarType: "R15", bodyColors: { headColorId: 1001 }, assets: [{ id: 1, name: "Hat", assetType: { id: 8, name: "Hat" } }], defaultShirtApplied: false, defaultPantsApplied: false },
    errors: { NOT_FOUND: "User not found." },
    handler: async ({ params }) => {
      const a = await rb("avatar", `/v1/users/${params.userId}/avatar`, undefined, { notFound: "User not found" });
      return { data: { ...pick(a, ["scales", "playerAvatarType", "bodyColors", "defaultShirtApplied", "defaultPantsApplied"]),
        assets: ((a?.assets ?? []) as Record<string, unknown>[]).map((x) => pick(x, ["id", "name", "assetType"])) } };
    },
  },
  {
    id: "roblox.users.thumbnail", service: "roblox", tag: "Avatars", method: "GET", path: "/api/roblox/users/{userId}/thumbnail",
    summary: "Avatar image URL (optionally Base64)", description: "Full avatar, headshot or bust image. state=Pending means Roblox is still rendering: retry shortly. With base64=true the image bytes are fetched from the CDN and returned inline (≤ 2 MB).",
    params: [userId,
      q("type", "string", "Which render.", { enum: ["avatar", "headshot", "bust"], default: "headshot" }),
      q("size", "string", "WxH. Common values: 48x48, 60x60, 100x100, 150x150, 180x180, 352x352, 420x420, 720x720.", { pattern: "^\\d{2,4}x\\d{2,4}$", default: "150x150" }),
      q("format", "string", "Image format.", { enum: ["Png", "Jpeg", "Webp"], default: "Png" }),
      q("isCircular", "boolean", "Crop to a circle.", { default: false }),
      q("base64", "boolean", "Also return the image as Base64.", { default: false })],
    credential: optional, cacheTtl: 60, batchable: true,
    fields: [int("userId", "User ID."), str("type", "Render type."), str("size", "Size."), str("format", "Format."), str("state", "Completed | Pending | Blocked | Error | InReview"),
      str("imageUrl", "CDN URL, null unless state is Completed.", { nullable: true }),
      obj("image", "Inline image, null unless base64=true and the image is ready.", [str("contentType", "MIME type."), int("bytes", "Size."), f("data", "base64", "Base64-encoded bytes.")], { nullable: true })],
    example: { userId: 1, type: "headshot", size: "150x150", format: "Png", state: "Completed", imageUrl: "https://tr.rbxcdn.com/.../150/150/AvatarHeadshot/Png", image: null },
    errors: { UNSUPPORTED: "The image is larger than the Base64 limit." },
    handler: async ({ params, query }) => {
      const kind = { avatar: "avatar", headshot: "avatar-headshot", bust: "avatar-bust" }[query.type as string];
      const r = await rb("thumbnails", `/v1/users/${kind}`, { userIds: params.userId, size: query.size, format: query.format, isCircular: query.isCircular });
      const t = r?.data?.[0];
      if (!t) throw new ApiError("NOT_FOUND", "No thumbnail returned");
      const url: string | null = t.state === "Completed" ? t.imageUrl : null;
      const image = query.base64 && url ? await fetchImageBase64(url, config.maxImageBytes, config.upstreamTimeoutMs) : null;
      return { data: { userId: Number(params.userId), type: query.type, size: query.size, format: query.format, state: t.state, imageUrl: url, image },
        availability: url ? "available" : "partial" };
    },
  },
];

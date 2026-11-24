import { discordRequest as dc } from "../upstream/discord";
import { config } from "../config";
import { ApiError } from "../errors";
import { fetchImageBase64 } from "../http";
import { arrOf, bool, dt, f, int, obj, pick, prim, q, snowflake, str } from "./helpers";
import type { EndpointDefInput, FieldDef, HandlerContext, PageArgs, ParamDef } from "./types";

const EPOCH = 1420070400000n;
const bot = { service: "discord" as const, mode: "required" as const, note: "Uses a rotating DISCORD_BOT_TOKENS entry. The bot must be able to see the target." };
const userRef = (nameOnly = false): ParamDef => ({
  name: "userId", in: "path", type: "string", required: true, resolve: "discordUser", pattern: "^(\\d{15,21}|@?[^\\s/?#][^/?#]{1,79})$", example: "80351110224678912",
  description: "User snowflake" + (nameOnly ? " **or username / display name / nickname** (matched within this server's members; needs the Server Members Intent)." : " **or username**. Discord has no global username lookup, so a username also needs the guildId query parameter."),
});
const guildIdQuery = q("guildId", "string", "Only for username lookups: the server whose members are searched (needs the Server Members Intent).", { pattern: "^\\d{15,21}$", example: "81384788765712384" });
const guildId = snowflake("guildId", "Guild (server) ID.", "81384788765712384");
const SF = "2026-01-15T12:00:00.000Z";

/* ───────── helpers ───────── */
const FLAGS: [number, string][] = [[0, "DISCORD_EMPLOYEE"], [1, "PARTNERED_SERVER_OWNER"], [2, "HYPESQUAD_EVENTS"], [3, "BUG_HUNTER_LEVEL_1"], [6, "HOUSE_BRAVERY"], [7, "HOUSE_BRILLIANCE"], [8, "HOUSE_BALANCE"], [9, "EARLY_SUPPORTER"], [10, "TEAM_PSEUDO_USER"], [14, "BUG_HUNTER_LEVEL_2"], [16, "VERIFIED_BOT"], [17, "VERIFIED_DEVELOPER"], [18, "CERTIFIED_MODERATOR"], [19, "BOT_HTTP_INTERACTIONS"], [22, "ACTIVE_DEVELOPER"]];
const decodeFlags = (n: number) => FLAGS.filter(([bit]) => (n & (1 << bit)) !== 0).map(([, name]) => name);
const CHANNEL_TYPES: Record<number, string> = { 0: "GUILD_TEXT", 1: "DM", 2: "GUILD_VOICE", 3: "GROUP_DM", 4: "GUILD_CATEGORY", 5: "GUILD_ANNOUNCEMENT", 10: "ANNOUNCEMENT_THREAD", 11: "PUBLIC_THREAD", 12: "PRIVATE_THREAD", 13: "GUILD_STAGE_VOICE", 14: "GUILD_DIRECTORY", 15: "GUILD_FORUM", 16: "GUILD_MEDIA" };
const cdn = (kind: string, id: string, hash: string | null | undefined, size = 1024) =>
  hash ? `https://cdn.discordapp.com/${kind}/${id}/${hash}.${hash.startsWith("a_") ? "gif" : "png"}?size=${size}` : null;
const createdAt = (id: string) => new Date(Number((BigInt(id) >> 22n) + EPOCH)).toISOString();
const defaultAvatar = (u: { id: string; discriminator?: string }) =>
  `https://cdn.discordapp.com/embed/avatars/${!u.discriminator || u.discriminator === "0" ? Number((BigInt(u.id) >> 22n) % 6n) : Number(u.discriminator) % 5}.png`;

const userPick = (u: Record<string, unknown>) => pick(u, ["id", "username", "discriminator", "global_name", "avatar", "bot"]);
const userBrief: FieldDef[] = [str("id", "User snowflake."), str("username", "Username."), str("discriminator", "'0' for migrated usernames."), str("global_name", "Display name.", { nullable: true }), str("avatar", "Avatar hash.", { nullable: true }), bool("bot", "Bot account (absent for humans).")];
const memberFields: FieldDef[] = [
  obj("user", "The user.", userBrief), str("nick", "Server nickname.", { nullable: true }), str("avatar", "Server-specific avatar hash.", { nullable: true }),
  prim("roles", "Role IDs.", "string"), dt("joined_at", "Join time."), dt("premium_since", "Boost start.", { nullable: true }), int("flags", "Guild member flags."),
  bool("pending", "Has not passed membership screening."), dt("communication_disabled_until", "Timeout end.", { nullable: true }),
];
const memberPick = (m: Record<string, unknown>) => ({ ...pick(m, ["nick", "avatar", "roles", "joined_at", "premium_since", "flags", "pending", "communication_disabled_until"]), user: userPick((m.user ?? {}) as Record<string, unknown>) });

const SNOWFLAKE_CURSOR = "Cursors are snowflake IDs (the id of the last item).";
const MEMBER_EX = { user: { id: "80351110224678912", username: "nelly", discriminator: "0", global_name: "Nelly", avatar: "8342729096ea3675442027381ff50dfe" }, nick: null, avatar: null, roles: ["41771983423143936"], joined_at: SF, premium_since: null, flags: 0, pending: false, communication_disabled_until: null };

export const discordEndpoints: EndpointDefInput[] = [
  /* ───────── Users ───────── */
  {
    id: "discord.users.get", service: "discord", tag: "Users", method: "GET", path: "/api/discord/users/{userId}",
    summary: "Get a user", description: "Public profile of any Discord user, with computed avatar/banner URLs, creation date and decoded badges.",
    params: [userRef(), guildIdQuery], credential: bot, cacheTtl: 300, batchable: true,
    fields: [
      ...userBrief, str("banner", "Banner hash.", { nullable: true }), int("accent_color", "Banner color as an integer.", { nullable: true }), bool("system", "Official Discord system user."),
      int("public_flags", "Raw public flag bitfield.", { nullable: true }), prim("badges", "Decoded public_flags names.", "string"),
      dt("created_at", "Account creation time, derived from the snowflake."), str("avatar_url", "1024px avatar URL.", { nullable: true }),
      str("default_avatar_url", "Default avatar used when avatar is null."), str("banner_url", "1024px banner URL.", { nullable: true }),
    ],
    example: { id: "80351110224678912", username: "nelly", discriminator: "0", global_name: "Nelly", avatar: "8342729096ea3675442027381ff50dfe", banner: null, accent_color: null, public_flags: 64, badges: ["HOUSE_BRAVERY"], created_at: "2015-08-10T17:26:37.529Z", avatar_url: "https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=1024", default_avatar_url: "https://cdn.discordapp.com/embed/avatars/0.png", banner_url: null },
    errors: { NOT_FOUND: "Unknown user." },
    handler: async ({ params }) => {
      const u = await dc(`/users/${params.userId}`, undefined);
      const flags = (u.public_flags ?? 0) as number;
      return { data: { ...pick(u, ["id", "username", "discriminator", "global_name", "avatar", "banner", "accent_color", "bot", "system", "public_flags"]),
        badges: decodeFlags(flags), created_at: createdAt(u.id), avatar_url: cdn("avatars", u.id, u.avatar), default_avatar_url: defaultAvatar(u), banner_url: cdn("banners", u.id, u.banner) } };
    },
  },
  {
    id: "discord.users.avatar", service: "discord", tag: "Users", method: "GET", path: "/api/discord/users/{userId}/avatar",
    summary: "Avatar URL (optionally Base64)", description: "Resolves a user's avatar at a chosen size and format. With base64=true the image is fetched from Discord's CDN and returned inline (≤ 2 MB).",
    params: [userRef(), guildIdQuery,
      q("size", "integer", "Power of two from 16 to 4096.", { enum: ["16", "32", "64", "128", "256", "512", "1024", "2048", "4096"], default: 1024 }),
      q("format", "string", "Image format. Omit for gif when animated, otherwise png.", { enum: ["png", "jpg", "webp", "gif"] }),
      q("base64", "boolean", "Also return the image as Base64.", { default: false })],
    credential: bot, cacheTtl: 300, batchable: true,
    fields: [str("userId", "User snowflake."), bool("hasCustomAvatar", "false means the default avatar is used."), bool("animated", "Avatar is animated."), str("format", "Format of url."), int("size", "Size of url."), str("url", "Image URL."),
      obj("image", "Inline image, null unless base64=true.", [str("contentType", "MIME type."), int("bytes", "Size."), f("data", "base64", "Base64-encoded bytes.")], { nullable: true })],
    example: { userId: "80351110224678912", hasCustomAvatar: true, animated: false, format: "png", size: 1024, url: "https://cdn.discordapp.com/avatars/80351110224678912/8342729096ea3675442027381ff50dfe.png?size=1024", image: null },
    errors: { NOT_FOUND: "Unknown user.", UNSUPPORTED: "Image exceeds the Base64 limit." },
    handler: async ({ params, query }) => {
      const u = await dc(`/users/${params.userId}`);
      const animated = typeof u.avatar === "string" && u.avatar.startsWith("a_");
      const format = (query.format as string | undefined) ?? (animated ? "gif" : "png");
      if (format === "gif" && !animated) throw new ApiError("INVALID_REQUEST", "This avatar is not animated; choose png, jpg or webp");
      const url = u.avatar ? `https://cdn.discordapp.com/avatars/${u.id}/${u.avatar}.${format}?size=${query.size}` : defaultAvatar(u);
      const image = query.base64 ? await fetchImageBase64(url, config.maxImageBytes, config.upstreamTimeoutMs) : null;
      return { data: { userId: u.id, hasCustomAvatar: Boolean(u.avatar), animated, format: u.avatar ? format : "png", size: Number(query.size), url, image } };
    },
  },
  {
    id: "discord.snowflakes.get", service: "discord", tag: "Utilities", method: "GET", path: "/api/discord/snowflakes/{id}",
    summary: "Decode a snowflake", description: "Pure computation, no upstream call: extracts the creation time and internal worker/process/increment from any Discord ID.",
    params: [snowflake("id", "Any Discord snowflake.", "80351110224678912")], credential: { service: "none", mode: "none" }, cacheTtl: 86400, batchable: true,
    fields: [str("id", "The snowflake."), int("timestamp", "Unix epoch milliseconds."), dt("createdAt", "Creation time."), int("workerId", "Internal worker ID."), int("processId", "Internal process ID."), int("increment", "Per-process increment.")],
    example: { id: "80351110224678912", timestamp: 1439227597529, createdAt: "2015-08-10T17:26:37.529Z", workerId: 0, processId: 1, increment: 0 },
    handler: async ({ params }) => {
      const id = BigInt(params.id);
      if (id >= 1n << 64n) throw new ApiError("INVALID_REQUEST", "Snowflake must fit in 64 bits");
      return { data: { id: params.id, timestamp: Number((id >> 22n) + EPOCH), createdAt: createdAt(params.id), workerId: Number((id & 0x3e0000n) >> 17n), processId: Number((id & 0x1f000n) >> 12n), increment: Number(id & 0xfffn) } };
    },
  },
  /* ───────── Guilds ───────── */
  {
    id: "discord.guilds.list", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds",
    summary: "Servers the bot is in", description: "Guilds that one configured bot has joined. Lists are per bot: pass credential to choose which (default 1), so pagination stays consistent.",
    params: [q("credential", "integer", "1-based index of the bot token in DISCORD_BOT_TOKENS.", { min: 1, default: 1 }), q("withCounts", "boolean", "Include approximate member/presence counts.", { default: true })],
    credential: bot, cacheTtl: 60, batchable: true,
    pagination: { default: 200, max: 200, cursorNote: SNOWFLAKE_CURSOR },
    fields: [str("id", "Guild snowflake."), str("name", "Name."), str("icon", "Icon hash.", { nullable: true }), bool("owner", "The bot owns the guild."), str("permissions", "Bot permissions in the guild (bitfield string)."), prim("features", "Guild feature flags.", "string"),
      int("approximate_member_count", "Members (when withCounts)."), int("approximate_presence_count", "Online members (when withCounts).")],
    example: [{ id: "81384788765712384", name: "Discord API", icon: "f64c482b807da4f539cff778d174971c", owner: false, permissions: "2147483647", features: ["COMMUNITY"], approximate_member_count: 100000, approximate_presence_count: 20000 }],
    list: async (c: HandlerContext, { cursor, limit }: PageArgs) => {
      const r = (await dc("/users/@me/guilds", { limit, after: cursor ?? undefined, with_counts: c.query.withCounts }, { prefer: c.query.credential })) as Record<string, unknown>[];
      const items = r.map((g) => pick(g, ["id", "name", "icon", "owner", "permissions", "features", "approximate_member_count", "approximate_presence_count"]));
      return { items, nextCursor: items.length === limit ? String(items[items.length - 1].id) : null };
    },
  },
  {
    id: "discord.guilds.get", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}",
    summary: "Get a server", description: "Full guild object. At least one configured bot must be a member; other bots are tried automatically when the first one lacks access.",
    params: [guildId], credential: bot, cacheTtl: 120, batchable: true,
    fields: [
      str("id", "Snowflake."), str("name", "Name."), str("description", "Description.", { nullable: true }), str("icon", "Icon hash.", { nullable: true }), str("banner", "Banner hash.", { nullable: true }), str("splash", "Invite splash hash.", { nullable: true }),
      str("owner_id", "Owner user ID."), prim("features", "Feature flags.", "string"), int("verification_level", "0–4."), int("explicit_content_filter", "0–2."), int("mfa_level", "0 none, 1 elevated."), int("nsfw_level", "0–3."),
      int("premium_tier", "Boost tier 0–3."), int("premium_subscription_count", "Boosts.", { nullable: true }), str("preferred_locale", "Locale."), str("vanity_url_code", "Vanity invite code.", { nullable: true }),
      int("approximate_member_count", "Members."), int("approximate_presence_count", "Online members."), int("roles_count", "Number of roles."), int("emojis_count", "Number of custom emojis."),
      dt("created_at", "Creation time from the snowflake."), str("icon_url", "Icon URL.", { nullable: true }),
    ],
    example: { id: "81384788765712384", name: "Discord API", description: null, icon: "f64c482b807da4f539cff778d174971c", banner: null, splash: null, owner_id: "53908232506183680", features: ["COMMUNITY"], verification_level: 3, explicit_content_filter: 2, mfa_level: 1, nsfw_level: 0, premium_tier: 3, premium_subscription_count: 30, preferred_locale: "en-US", vanity_url_code: "discord-api", approximate_member_count: 100000, approximate_presence_count: 20000, roles_count: 40, emojis_count: 100, created_at: "2015-05-08T21:16:20.000Z", icon_url: "https://cdn.discordapp.com/icons/81384788765712384/f64c482b807da4f539cff778d174971c.png?size=1024" },
    errors: { FORBIDDEN: "No configured bot is a member of this guild.", NOT_FOUND: "Unknown guild." },
    handler: async ({ params }) => {
      const g = await dc(`/guilds/${params.guildId}`, { with_counts: true }, { fallbackOnAccess: true });
      return { data: { ...pick(g, ["id", "name", "description", "icon", "banner", "splash", "owner_id", "features", "verification_level", "explicit_content_filter", "mfa_level", "nsfw_level", "premium_tier", "premium_subscription_count", "preferred_locale", "vanity_url_code", "approximate_member_count", "approximate_presence_count"]),
        roles_count: g.roles?.length ?? 0, emojis_count: g.emojis?.length ?? 0, created_at: createdAt(g.id), icon_url: cdn("icons", g.id, g.icon) } };
    },
  },
  {
    id: "discord.guilds.preview", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/preview",
    summary: "Public server preview", description: "Limited public data for guilds that are discoverable, or that a bot is in. Works without membership for Server Discovery guilds.",
    params: [guildId], credential: bot, cacheTtl: 300, batchable: true,
    fields: [str("id", "Snowflake."), str("name", "Name."), str("description", "Description.", { nullable: true }), str("icon", "Icon hash.", { nullable: true }), str("splash", "Splash hash.", { nullable: true }), str("discovery_splash", "Discovery splash hash.", { nullable: true }),
      prim("features", "Feature flags.", "string"), int("approximate_member_count", "Members."), int("approximate_presence_count", "Online."),
      arrOf("emojis", "Custom emojis.", [str("id", "Emoji ID."), str("name", "Name."), bool("animated", "Animated.")])],
    example: { id: "81384788765712384", name: "Discord API", description: null, icon: null, splash: null, discovery_splash: null, features: ["DISCOVERABLE"], approximate_member_count: 100000, approximate_presence_count: 20000, emojis: [{ id: "41771983429993937", name: "LUL", animated: false }] },
    errors: { FORBIDDEN: "The guild is not discoverable and no bot is a member.", NOT_FOUND: "Unknown guild." },
    handler: async ({ params }) => {
      const g = await dc(`/guilds/${params.guildId}/preview`, undefined, { fallbackOnAccess: true });
      return { data: { ...pick(g, ["id", "name", "description", "icon", "splash", "discovery_splash", "features", "approximate_member_count", "approximate_presence_count"]),
        emojis: ((g.emojis ?? []) as Record<string, unknown>[]).map((e) => pick(e, ["id", "name", "animated"])) } };
    },
  },
  {
    id: "discord.guilds.channels", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/channels",
    summary: "Server channels", description: "All channels the bot can see in the guild (threads excluded).",
    params: [guildId], credential: bot, cacheTtl: 60, batchable: true,
    fields: [str("id", "Snowflake."), int("type", "Channel type code."), str("type_name", "Readable channel type.", { nullable: true }), str("name", "Name."), int("position", "Sort position."), str("parent_id", "Category ID.", { nullable: true }), str("topic", "Topic.", { nullable: true }), bool("nsfw", "Age-restricted."), int("bitrate", "Voice bitrate."), int("user_limit", "Voice user limit."), int("rate_limit_per_user", "Slowmode seconds.")],
    example: [{ id: "41771983423143937", type: 0, type_name: "GUILD_TEXT", name: "general", position: 0, parent_id: null, topic: "Chat", nsfw: false, rate_limit_per_user: 0 }],
    errors: { FORBIDDEN: "No configured bot is a member of this guild." },
    handler: async ({ params }) => ({ data: ((await dc(`/guilds/${params.guildId}/channels`, undefined, { fallbackOnAccess: true })) as Record<string, unknown>[])
      .map((c) => ({ ...pick(c, ["id", "type", "name", "position", "parent_id", "topic", "nsfw", "bitrate", "user_limit", "rate_limit_per_user"]), type_name: CHANNEL_TYPES[c.type as number] ?? null })) }),
  },
  {
    id: "discord.guilds.roles", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/roles",
    summary: "Server roles", description: "All roles with colors and permission bitfields.",
    params: [guildId], credential: bot, cacheTtl: 60, batchable: true,
    fields: [str("id", "Snowflake."), str("name", "Name."), int("color", "RGB integer, 0 = none."), bool("hoist", "Listed separately."), int("position", "Position."), str("permissions", "Permission bitfield string."), bool("managed", "Managed by an integration."), bool("mentionable", "Mentionable."), str("icon", "Icon hash.", { nullable: true }), str("unicode_emoji", "Emoji.", { nullable: true })],
    example: [{ id: "41771983423143936", name: "@everyone", color: 0, hoist: false, position: 0, permissions: "1071698660929", managed: false, mentionable: false, icon: null, unicode_emoji: null }],
    errors: { FORBIDDEN: "No configured bot is a member of this guild." },
    handler: async ({ params }) => ({ data: ((await dc(`/guilds/${params.guildId}/roles`, undefined, { fallbackOnAccess: true })) as Record<string, unknown>[])
      .map((r) => pick(r, ["id", "name", "color", "hoist", "position", "permissions", "managed", "mentionable", "icon", "unicode_emoji"])) }),
  },
  {
    id: "discord.guilds.emojis", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/emojis",
    summary: "Custom emojis", description: "Custom emojis with ready-to-use image URLs.",
    params: [guildId], credential: bot, cacheTtl: 120, batchable: true,
    fields: [str("id", "Snowflake."), str("name", "Name.", { nullable: true }), bool("animated", "Animated."), bool("available", "Usable (false when boost level dropped)."), bool("managed", "Managed by an integration."), prim("roles", "Role IDs allowed to use it.", "string"), str("url", "Image URL.")],
    example: [{ id: "41771983429993937", name: "LUL", animated: false, available: true, managed: false, roles: [], url: "https://cdn.discordapp.com/emojis/41771983429993937.png" }],
    errors: { FORBIDDEN: "No configured bot is a member of this guild." },
    handler: async ({ params }) => ({ data: ((await dc(`/guilds/${params.guildId}/emojis`, undefined, { fallbackOnAccess: true })) as Record<string, unknown>[])
      .map((e) => ({ ...pick(e, ["id", "name", "animated", "available", "managed", "roles"]), url: `https://cdn.discordapp.com/emojis/${e.id}.${e.animated ? "gif" : "png"}` })) }),
  },
  {
    id: "discord.guilds.members", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/members",
    summary: "List members", description: "Members in ascending ID order. Discord only serves this to bots with the privileged Server Members Intent enabled; without it the call fails with FORBIDDEN.",
    params: [guildId], credential: bot, cacheTtl: 30, batchable: true,
    pagination: { default: 100, max: 1000, cursorNote: SNOWFLAKE_CURSOR },
    fields: memberFields, example: [MEMBER_EX],
    errors: { FORBIDDEN: "The bot is not in the guild or lacks the Server Members Intent." },
    list: async (c, { cursor, limit }) => {
      const r = (await dc(`/guilds/${c.params.guildId}/members`, { limit, after: cursor ?? undefined }, { fallbackOnAccess: true })) as Record<string, unknown>[];
      const items = r.map(memberPick);
      return { items, nextCursor: items.length === limit ? String((items[items.length - 1].user as { id: string }).id) : null };
    },
  },
  {
    id: "discord.guilds.member", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/members/{userId}",
    summary: "Get one member", description: "Server-specific data (nickname, roles, join date) for one user.",
    params: [guildId, userRef(true)], credential: bot, cacheTtl: 30, batchable: true,
    fields: memberFields, example: MEMBER_EX,
    errors: { NOT_FOUND: "The user is not a member of the guild.", FORBIDDEN: "No configured bot is a member of this guild." },
    handler: async ({ params }) => ({ data: memberPick(await dc(`/guilds/${params.guildId}/members/${params.userId}`, undefined, { fallbackOnAccess: true })) }),
  },
  {
    id: "discord.guilds.widget", service: "discord", tag: "Guilds", method: "GET", path: "/api/discord/guilds/{guildId}/widget",
    summary: "Public widget", description: "The guild's public widget (voice channels and online members) when the owner enabled it. Needs no bot. Member ids in the widget are anonymised by Discord.",
    params: [guildId], credential: { service: "discord", mode: "none", note: "Public Discord endpoint, called without a token." }, cacheTtl: 60, batchable: true,
    fields: [str("id", "Guild snowflake."), str("name", "Name."), str("instant_invite", "Invite URL.", { nullable: true }), int("presence_count", "Online members."),
      arrOf("channels", "Voice channels.", [str("id", "Snowflake."), str("name", "Name."), int("position", "Position.")]),
      arrOf("members", "Online members (up to 100).", [str("id", "Anonymised ID."), str("username", "Username."), str("status", "online | idle | dnd."), str("avatar_url", "Avatar URL.")])],
    example: { id: "81384788765712384", name: "Discord API", instant_invite: "https://discord.com/invite/discord-api", presence_count: 2000, channels: [{ id: "1", name: "Lounge", position: 0 }], members: [{ id: "0", username: "nelly", status: "online", avatar_url: "https://cdn.discordapp.com/widget-avatars/x.png" }] },
    errors: { PRIVATE: "The widget is disabled by the guild.", NOT_FOUND: "Unknown guild." },
    handler: async ({ params }) => {
      const w = await dc(`/guilds/${params.guildId}/widget.json`, undefined, { auth: "none", forbiddenAs: "PRIVATE" });
      return { data: { ...pick(w, ["id", "name", "instant_invite", "presence_count"]),
        channels: ((w.channels ?? []) as Record<string, unknown>[]).map((c) => pick(c, ["id", "name", "position"])),
        members: ((w.members ?? []) as Record<string, unknown>[]).map((m) => pick(m, ["id", "username", "status", "avatar_url"])) } };
    },
  },
  /* ───────── Invites & channels ───────── */
  {
    id: "discord.invites.get", service: "discord", tag: "Invites", method: "GET", path: "/api/discord/invites/{code}",
    summary: "Resolve an invite", description: "Server, channel, inviter and member counts behind an invite code.",
    params: [{ name: "code", in: "path", type: "string", required: true, pattern: "^[A-Za-z0-9-]{2,32}$", description: "Invite code (the part after discord.gg/).", example: "discord-api" }],
    credential: { service: "discord", mode: "optional", note: "Works with or without a bot token." }, cacheTtl: 120, batchable: true,
    fields: [str("code", "Invite code."), dt("expires_at", "Expiry, null if permanent.", { nullable: true }), int("approximate_member_count", "Members."), int("approximate_presence_count", "Online."),
      obj("guild", "Target server.", [str("id", "Snowflake."), str("name", "Name."), str("description", "Description.", { nullable: true }), str("icon", "Icon hash.", { nullable: true }), str("banner", "Banner hash.", { nullable: true }), str("splash", "Splash hash.", { nullable: true }), prim("features", "Feature flags.", "string"), int("verification_level", "0–4."), str("vanity_url_code", "Vanity code.", { nullable: true }), int("premium_subscription_count", "Boosts.", { nullable: true })], { nullable: true }),
      obj("channel", "Target channel.", [str("id", "Snowflake."), int("type", "Type code."), str("name", "Name.")], { nullable: true }),
      obj("inviter", "Creator, null if hidden.", userBrief, { nullable: true })],
    example: { code: "discord-api", expires_at: null, approximate_member_count: 100000, approximate_presence_count: 20000, guild: { id: "81384788765712384", name: "Discord API", description: null, icon: null, banner: null, splash: null, features: ["COMMUNITY"], verification_level: 3, vanity_url_code: "discord-api", premium_subscription_count: 30 }, channel: { id: "381870553235193857", type: 0, name: "rules" }, inviter: null },
    errors: { NOT_FOUND: "Unknown or expired invite." },
    handler: async ({ params }) => {
      const i = await dc(`/invites/${params.code}`, { with_counts: true, with_expiration: true }, { auth: "optional" });
      return { data: { ...pick(i, ["code", "expires_at", "approximate_member_count", "approximate_presence_count"]),
        guild: i.guild ? pick(i.guild, ["id", "name", "description", "icon", "banner", "splash", "features", "verification_level", "vanity_url_code", "premium_subscription_count"]) : null,
        channel: i.channel ? pick(i.channel, ["id", "type", "name"]) : null, inviter: i.inviter ? userPick(i.inviter) : null } };
    },
  },
  {
    id: "discord.channels.get", service: "discord", tag: "Channels", method: "GET", path: "/api/discord/channels/{channelId}",
    summary: "Get a channel", description: "Channel or thread details. The bot needs access to the channel.",
    params: [snowflake("channelId", "Channel snowflake.", "41771983423143937")], credential: bot, cacheTtl: 60, batchable: true,
    fields: [str("id", "Snowflake."), int("type", "Type code."), str("type_name", "Readable type.", { nullable: true }), str("guild_id", "Guild ID.", { nullable: true }), str("name", "Name.", { nullable: true }), int("position", "Position."), str("topic", "Topic.", { nullable: true }), bool("nsfw", "Age-restricted."), str("parent_id", "Category/parent ID.", { nullable: true }), str("last_message_id", "Latest message ID.", { nullable: true }), int("rate_limit_per_user", "Slowmode seconds."), int("member_count", "Thread members."), int("message_count", "Thread messages.")],
    example: { id: "41771983423143937", type: 0, type_name: "GUILD_TEXT", guild_id: "41771983423143937", name: "general", position: 0, topic: null, nsfw: false, parent_id: null, last_message_id: "155117677105512449", rate_limit_per_user: 0 },
    errors: { FORBIDDEN: "No configured bot can see this channel.", NOT_FOUND: "Unknown channel." },
    handler: async ({ params }) => {
      const c = await dc(`/channels/${params.channelId}`, undefined, { fallbackOnAccess: true });
      return { data: { ...pick(c, ["id", "type", "guild_id", "name", "position", "topic", "nsfw", "parent_id", "last_message_id", "rate_limit_per_user", "member_count", "message_count"]), type_name: CHANNEL_TYPES[c.type] ?? null } };
    },
  },
  {
    id: "discord.channels.messages", service: "discord", tag: "Channels", method: "GET", path: "/api/discord/channels/{channelId}/messages",
    summary: "Recent messages", description: "Newest-first messages. Needs View Channel + Read Message History. Message `content` is empty for bots without the Message Content Intent (except DMs, mentions and the bot's own messages).",
    params: [snowflake("channelId", "Channel snowflake.", "41771983423143937")], credential: bot, cacheTtl: 15, batchable: true,
    pagination: { default: 50, max: 100, cursorNote: "Cursors are message IDs; the next page contains older messages." },
    fields: [str("id", "Snowflake."), str("channel_id", "Channel ID."), obj("author", "Author.", userBrief), str("content", "Text (see note on intents)."), dt("timestamp", "Sent at."), dt("edited_timestamp", "Last edit.", { nullable: true }), bool("pinned", "Pinned."), int("type", "Message type code."), bool("mention_everyone", "Mentions @everyone."), int("embeds_count", "Number of embeds."),
      arrOf("attachments", "Files.", [str("id", "Snowflake."), str("filename", "File name."), str("content_type", "MIME type."), int("size", "Bytes."), str("url", "CDN URL.")]),
      arrOf("reactions", "Reaction summary.", [int("count", "Total."), obj("emoji", "Emoji.", [str("id", "ID, null for Unicode.", { nullable: true }), str("name", "Name or Unicode character.", { nullable: true })])])],
    example: [{ id: "155117677105512449", channel_id: "41771983423143937", author: { id: "80351110224678912", username: "nelly", discriminator: "0", global_name: "Nelly", avatar: null }, content: "Hello", timestamp: SF, edited_timestamp: null, pinned: false, type: 0, mention_everyone: false, embeds_count: 0, attachments: [], reactions: [] }],
    errors: { FORBIDDEN: "No configured bot can read this channel.", NOT_FOUND: "Unknown channel." },
    list: async (c, { cursor, limit }) => {
      const r = (await dc(`/channels/${c.params.channelId}/messages`, { limit, before: cursor ?? undefined }, { fallbackOnAccess: true })) as Record<string, unknown>[];
      const items: Record<string, unknown>[] = r.map((m) => ({
        ...pick(m, ["id", "channel_id", "content", "timestamp", "edited_timestamp", "pinned", "type", "mention_everyone"]),
        author: userPick((m.author ?? {}) as Record<string, unknown>), embeds_count: ((m.embeds as unknown[]) ?? []).length,
        attachments: ((m.attachments ?? []) as Record<string, unknown>[]).map((a) => pick(a, ["id", "filename", "content_type", "size", "url"])),
        reactions: ((m.reactions ?? []) as { count: number; emoji: Record<string, unknown> }[]).map((x) => ({ count: x.count, emoji: pick(x.emoji, ["id", "name"]) })),
      }));
      return { items, nextCursor: items.length === limit ? String(items[items.length - 1].id) : null };
    },
  },
];

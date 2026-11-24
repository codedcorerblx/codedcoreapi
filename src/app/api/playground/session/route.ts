import { SESSION_COOKIE, SESSION_TTL_S, createSessionToken, readCookie, verifyApiKey, verifySessionToken } from "@/lib/auth";
import { ApiError } from "@/lib/errors";
import { errorBody, jsonResponse } from "@/lib/envelope";

export const dynamic = "force-dynamic";
const cookie = (value: string, maxAge: number) =>
  `${SESSION_COOKIE}=${value}; Path=/api/playground; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`;
const meta = { responseTime: 0, requestId: "playground" };
const unauth = (e: ApiError) => jsonResponse(errorBody(e, meta), e.status);

/** Unlock: validates the one API key and issues a signed, HttpOnly, 1-hour session cookie. The key is never stored. */
export async function POST(req: Request) {
  const err = verifyApiKey(req.headers.get("x-api-key"));
  if (err) return unauth(err);
  return jsonResponse({ success: true, data: { authenticated: true, expiresInSeconds: SESSION_TTL_S }, error: null, nextCursor: null, metadata: { timestamp: new Date().toISOString(), ...meta } }, 200,
    { "set-cookie": cookie(createSessionToken(), SESSION_TTL_S) });
}

export async function GET(req: Request) {
  if (!verifySessionToken(readCookie(req.headers.get("cookie"), SESSION_COOKIE))) return unauth(new ApiError("UNAUTHORIZED", "Playground is locked"));
  return jsonResponse({ success: true, data: { authenticated: true }, error: null, nextCursor: null, metadata: { timestamp: new Date().toISOString(), ...meta } }, 200);
}

export async function DELETE() {
  return jsonResponse({ success: true, data: { authenticated: false }, error: null, nextCursor: null, metadata: { timestamp: new Date().toISOString(), ...meta } }, 200, { "set-cookie": cookie("", 0) });
}

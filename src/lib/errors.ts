export const ERROR_INFO = {
  UNAUTHORIZED: { status: 401, description: "The x-api-key header is missing or does not match the private API key." },
  INVALID_REQUEST: { status: 400, description: "A path parameter, query parameter or JSON body failed validation." },
  ENDPOINT_NOT_ALLOWED: { status: 400, description: "Batch only: the sub-request targets an endpoint that batches may not call (for example a nested /api/batch)." },
  NOT_FOUND: { status: 404, description: "The route, or the requested user/group/guild/etc., does not exist." },
  METHOD_NOT_ALLOWED: { status: 405, description: "The route exists but not for this HTTP method." },
  PAYLOAD_TOO_LARGE: { status: 413, description: "The request body exceeds the size limit." },
  PRIVATE: { status: 403, description: "The data exists but its owner hides it (for example a private Roblox inventory or a Discord widget that is disabled)." },
  FORBIDDEN: { status: 403, description: "The configured credentials lack the membership, permission or intent needed to read this data." },
  UNSUPPORTED: { status: 501, description: "The option is not supported by the proxy or by the upstream API." },
  RATE_LIMITED: { status: 429, description: "Every usable credential is rate limited upstream. Retry after the Retry-After header." },
  CREDENTIALS_UNAVAILABLE: { status: 503, description: "No usable upstream credential is configured, or all configured ones are invalid." },
  UPSTREAM_TIMEOUT: { status: 504, description: "The upstream API (or the batch/auto-pagination time budget) timed out." },
  UPSTREAM_ERROR: { status: 502, description: "The upstream API failed or returned an unexpected response." },
  INTERNAL_ERROR: { status: 500, description: "Unexpected proxy error." },
  CONFIG_ERROR: { status: 500, description: "The server is missing required configuration (API_SECRET)." },
} as const;

export type ErrorCode = keyof typeof ERROR_INFO;

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly retryAfter?: number;
  readonly details?: unknown;
  constructor(code: ErrorCode, message: string, opts: { retryAfter?: number; details?: unknown } = {}) {
    super(message);
    this.code = code;
    this.status = ERROR_INFO[code].status;
    this.retryAfter = opts.retryAfter;
    this.details = opts.details;
  }
}

export function toApiError(e: unknown): ApiError {
  if (e instanceof ApiError) return e;
  console.error("[api] unexpected error:", e instanceof Error ? e.message : "unknown");
  return new ApiError("INTERNAL_ERROR", "Unexpected internal error");
}

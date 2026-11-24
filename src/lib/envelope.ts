import type { ApiError } from "./errors";

export interface PaginationMeta {
  mode: "manual" | "auto";
  pages: number;
  itemCount: number;
  truncated: boolean;
  reason: string | null;
}
export interface Metadata {
  timestamp: string;
  cached?: boolean;
  responseTime: number;
  requestId: string;
  availability?: "available" | "empty" | "partial";
  pagination?: PaginationMeta;
}
export interface ApiBody {
  success: boolean;
  data: unknown;
  error: { code: string; message: string; details?: unknown } | null;
  nextCursor: string | null;
  metadata: Metadata;
}

export function successBody(
  data: unknown,
  nextCursor: string | null,
  meta: Omit<Metadata, "timestamp">,
): ApiBody {
  return { success: true, data, error: null, nextCursor, metadata: { timestamp: new Date().toISOString(), ...meta } };
}

export function errorBody(err: ApiError, meta: Pick<Metadata, "responseTime" | "requestId">): ApiBody {
  return {
    success: false,
    data: null,
    error: { code: err.code, message: err.message, ...(err.details !== undefined ? { details: err.details } : {}) },
    nextCursor: null,
    metadata: { timestamp: new Date().toISOString(), ...meta },
  };
}

export function jsonResponse(body: unknown, status: number, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers },
  });
}

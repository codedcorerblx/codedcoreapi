import type { ErrorCode } from "../errors";

export type ParamType = "string" | "integer" | "number" | "boolean" | "array" | "object";
export type Service = "roblox" | "discord" | "system";
export type Method = "GET" | "POST";

export interface ParamDef {
  name: string;
  in: "path" | "query" | "body";
  type: ParamType;
  description: string;
  required?: boolean;
  default?: string | number | boolean;
  example?: string | number | boolean | unknown[] | Record<string, unknown>;
  enum?: string[];
  min?: number;
  max?: number;
  maxItems?: number;
  maxLength?: number;
  pattern?: string;
  items?: "string" | "integer";
  /** Path param that accepts an ID or a username; the pipeline resolves it to an ID before the handler runs. */
  resolve?: "robloxUser" | "discordUser";
}

/** Documents one field of the `data` payload (or of each item when the endpoint is a list). */
export type FieldType = "string" | "integer" | "number" | "boolean" | "object" | "array" | "base64" | "datetime";
export interface FieldDef {
  name: string;
  type: FieldType;
  description: string;
  nullable?: boolean;
  /** element type when type = array of primitives */
  items?: Exclude<FieldType, "array" | "object">;
  /** nested fields (object, or array of objects). A single child named "*" documents a map keyed by arbitrary strings. */
  children?: FieldDef[];
}

export interface PaginationDef {
  default: number;
  max: number;
  /** Roblox only accepts specific page sizes; requests snap down to the nearest allowed value. */
  allowed?: number[];
  cursorNote: string;
}

export interface HandlerContext {
  params: Record<string, string>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: Record<string, any>;
  body: unknown;
  requestId: string;
  apiKey: string | null;
  source: "direct" | "batch" | "playground";
  emitLog: (e: import("../pipeline").LogEntry) => void;
}
export interface SingleResult { data: unknown; availability?: "available" | "empty" | "partial"; warnings?: string[] }
export interface PageArgs { cursor: string | null; limit: number }
export interface PageResult { items: unknown[]; nextCursor: string | null; warnings?: string[] }

export interface EndpointDefInput {
  id: string;
  service: Service;
  tag: string;
  method: Method;
  /** Full path with {param} placeholders, e.g. /api/roblox/users/{userId} */
  path: string;
  summary: string;
  description: string;
  params: ParamDef[];
  credential: { service: "roblox" | "discord" | "none"; mode: "none" | "optional" | "required"; note?: string };
  /** Seconds. 0 disables caching and de-duplication. */
  cacheTtl: number;
  batchable: boolean;
  pagination?: PaginationDef;
  /** Fields of `data` (items for lists). */
  fields: FieldDef[];
  /** Example of `data` (an array for lists). */
  example: unknown;
  bodyExample?: unknown;
  /** Extra error codes beyond the universal ones, with endpoint-specific wording. */
  errors?: Partial<Record<ErrorCode, string>>;
  notes?: string[];
  handler?: (ctx: HandlerContext) => Promise<SingleResult>;
  list?: (ctx: HandlerContext, args: PageArgs) => Promise<PageResult>;
}
export interface EndpointDef extends EndpointDefInput {
  errorCodes: { code: ErrorCode; note?: string }[];
  isList: boolean;
}
/** Handler-free copy that is safe to ship to the browser. */
export type PublicEndpoint = Omit<EndpointDef, "handler" | "list">;

export const typeLabel = (f: Pick<FieldDef, "type" | "items" | "nullable" | "children">): string => {
  const base =
    f.type === "array" ? `array<${f.items ?? (f.children ? "object" : "any")}>`
    : f.type === "base64" ? "Base64"
    : f.type === "datetime" ? "string (ISO-8601)"
    : f.type;
  return f.nullable ? `${base} | null` : base;
};

import { ERROR_INFO, type ErrorCode } from "./errors";
import { endpoints, exampleEnvelope, exampleError, type EndpointDef, type FieldDef, type ParamDef } from "./registry";

type Json = Record<string, unknown>;

function fieldSchema(f: FieldDef): Json {
  let s: Json;
  switch (f.type) {
    case "base64": s = { type: "string", contentEncoding: "base64" }; break;
    case "datetime": s = { type: "string", format: "date-time" }; break;
    case "array": s = { type: "array", items: f.children ? objectSchema(f.children) : { type: f.items ?? "string" } }; break;
    case "object": s = f.children ? (f.children.length === 1 && f.children[0].name === "*" ? { type: "object", additionalProperties: fieldSchema(f.children[0]) } : objectSchema(f.children)) : { type: "object", additionalProperties: true }; break;
    default: s = { type: f.type };
  }
  if (f.nullable) s = { ...s, type: Array.isArray(s.type) ? s.type : [s.type as string, "null"] };
  return { ...s, description: f.description };
}
function objectSchema(fields: FieldDef[]): Json {
  return { type: "object", properties: Object.fromEntries(fields.map((f) => [f.name, fieldSchema(f)])), required: fields.filter((f) => !f.nullable).map((f) => f.name) };
}
function paramSchema(p: ParamDef): Json {
  const s: Json = p.type === "array" ? { type: "array", items: { type: p.items ?? "string" }, maxItems: p.maxItems } : { type: p.type };
  if (p.enum) s.enum = p.type === "integer" ? p.enum.map(Number) : p.enum;
  if (p.default !== undefined) s.default = p.default;
  if (p.min !== undefined) s.minimum = p.min;
  if (p.max !== undefined) s.maximum = p.max;
  if (p.pattern) s.pattern = p.pattern;
  if (p.maxLength) s.maxLength = p.maxLength;
  return s;
}

function operation(d: EndpointDef): Json {
  const parameters = d.params.filter((p) => p.in !== "body").map((p) => ({
    name: p.name, in: p.in, required: p.in === "path" || Boolean(p.required), description: p.description, schema: paramSchema(p),
    ...(p.example !== undefined ? { example: p.example } : {}), ...(p.type === "array" ? { style: "form", explode: false } : {}),
  }));
  const bodyParams = d.params.filter((p) => p.in === "body");
  const dataSchema = d.isList ? { type: "array", items: objectSchema(d.fields) } : d.fields.length ? objectSchema(d.fields) : { type: "object" };

  const responses: Json = {
    "200": {
      description: "Success",
      content: { "application/json": {
        schema: { allOf: [{ $ref: "#/components/schemas/SuccessEnvelope" }, { type: "object", properties: { data: dataSchema } }] },
        example: exampleEnvelope(d),
      } },
    },
  };
  const byStatus = new Map<number, ErrorCode[]>();
  for (const { code } of d.errorCodes) byStatus.set(ERROR_INFO[code].status, [...(byStatus.get(ERROR_INFO[code].status) ?? []), code]);
  for (const [status, codes] of byStatus)
    responses[String(status)] = {
      description: codes.map((c) => ERROR_INFO[c].description).join(" "),
      content: { "application/json": { schema: { $ref: "#/components/schemas/ErrorEnvelope" },
        examples: Object.fromEntries(codes.map((c) => [c, { value: exampleError(c) }])) } },
    };

  return {
    operationId: d.id, tags: [d.service], summary: d.summary,
    description: [d.description, `**Upstream credential:** ${d.credential.mode === "none" ? "none" : `${d.credential.service} (${d.credential.mode})`}. ${d.credential.note ?? ""}`, ...(d.notes ?? []).map((n) => `- ${n}`)].join("\n\n"),
    security: [{ ApiKeyAuth: [] }],
    ...(parameters.length ? { parameters } : {}),
    ...(bodyParams.length ? { requestBody: { required: true, content: { "application/json": {
      schema: { type: "object", properties: Object.fromEntries(bodyParams.map((p) => [p.name, { ...paramSchema(p), description: p.description }])), required: bodyParams.filter((p) => p.required).map((p) => p.name) },
      example: d.bodyExample } } } } : {}),
    responses,
  };
}

export function buildOpenApi(baseUrl: string): Json {
  const paths: Record<string, Json> = {};
  for (const d of endpoints) (paths[d.path] ??= {})[d.method.toLowerCase()] = operation(d);
  return {
    openapi: "3.1.0",
    info: {
      title: "CodedCore API", version: "1.0.0",
      description: "Private proxy over official Roblox and Discord APIs. Every request needs the single private key in the `x-api-key` header. All responses use one envelope: `{ success, data, error, nextCursor, metadata }`. Generated from the same endpoint registry as the documentation, playground and batch validation.",
    },
    servers: [{ url: baseUrl }],
    tags: [{ name: "roblox", description: "Roblox public data" }, { name: "discord", description: "Discord data available to bots" }, { name: "system", description: "Batch and credential state" }],
    security: [{ ApiKeyAuth: [] }],
    paths,
    components: {
      securitySchemes: { ApiKeyAuth: { type: "apiKey", in: "header", name: "x-api-key", description: "The one private API key (server env API_SECRET). Missing or wrong → HTTP 401 UNAUTHORIZED." } },
      schemas: {
        Metadata: { type: "object", required: ["timestamp", "responseTime", "requestId"], properties: {
          timestamp: { type: "string", format: "date-time" }, cached: { type: "boolean", description: "Served from the in-memory cache." },
          responseTime: { type: "integer", description: "Milliseconds spent in the proxy." }, requestId: { type: "string" },
          availability: { type: "string", enum: ["available", "empty", "partial"], description: "empty = valid request, nothing to return; partial = some sections failed." },
          count: { type: "integer", description: "Number of entries when data is an array." }, warnings: { type: "array", items: { type: "string" }, description: "Non-fatal problems, e.g. some names could not be looked up (then availability is partial)." },
          pagination: { type: "object", properties: { mode: { type: "string", enum: ["manual", "auto"] }, pages: { type: "integer" }, itemCount: { type: "integer" }, truncated: { type: "boolean" }, reason: { type: ["string", "null"], description: "MAX_ITEMS, MAX_PAGES, TIMEOUT or an error code when truncated." } } },
        } },
        SuccessEnvelope: { type: "object", required: ["success", "data", "error", "nextCursor", "metadata"], properties: {
          success: { type: "boolean", const: true }, data: {}, error: { type: "null" }, nextCursor: { type: ["string", "null"] }, metadata: { $ref: "#/components/schemas/Metadata" } } },
        ErrorEnvelope: { type: "object", required: ["success", "data", "error", "nextCursor", "metadata"], properties: {
          success: { type: "boolean", const: false }, data: { type: "null" },
          error: { type: "object", required: ["code", "message"], properties: { code: { type: "string", enum: Object.keys(ERROR_INFO) }, message: { type: "string" }, details: {} } },
          nextCursor: { type: "null" }, metadata: { $ref: "#/components/schemas/Metadata" } } },
      },
    },
  };
}

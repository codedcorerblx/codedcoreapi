import { neon } from "@neondatabase/serverless";

const url = () => process.env.DATABASE_URL || process.env.POSTGRES_URL || "";
export const dbEnabled = () => Boolean(url());

type Sql = ReturnType<typeof neon>;
const g = globalThis as unknown as { __sql?: Sql; __schema?: Promise<void> };

function client(): Sql {
  return (g.__sql ??= neon(url()));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function dbQuery<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
  if (!dbEnabled()) throw new Error("DATABASE_URL is not configured");
  await ensureSchema();
  return (await client().query(text, params)) as T[];
}

/** Idempotent schema bootstrap – runs once per server instance. */
export function ensureSchema(): Promise<void> {
  return (g.__schema ??= (async () => {
    const sql = client();
    await sql.query(`CREATE TABLE IF NOT EXISTS request_logs (
      id BIGSERIAL PRIMARY KEY,
      ts TIMESTAMPTZ NOT NULL DEFAULT now(),
      endpoint_id TEXT NOT NULL,
      method TEXT NOT NULL,
      route TEXT NOT NULL,
      status INT NOT NULL,
      success BOOLEAN NOT NULL,
      error_code TEXT,
      latency_ms INT NOT NULL,
      cached BOOLEAN NOT NULL DEFAULT false,
      source TEXT NOT NULL DEFAULT 'direct'
    )`);
    await sql.query(`CREATE INDEX IF NOT EXISTS request_logs_ts_idx ON request_logs (ts DESC)`);
    await sql.query(`CREATE INDEX IF NOT EXISTS request_logs_ep_ts_idx ON request_logs (endpoint_id, ts DESC)`);
    await sql.query(`CREATE TABLE IF NOT EXISTS credential_state (
      service TEXT NOT NULL,
      cred_id TEXT NOT NULL,
      cooldown_until TIMESTAMPTZ NOT NULL,
      PRIMARY KEY (service, cred_id)
    )`);
  })().catch((e) => {
    g.__schema = undefined; // retry on next call
    throw e;
  }));
}

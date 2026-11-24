const num = (key: string, fallback: number): number => {
  const v = Number(process.env[key]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};

/** Split a comma-separated env value, trim whitespace and drop empty entries. */
export function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  /** Read lazily so the value is never captured in a bundle. */
  get apiSecret(): string {
    return (process.env.API_SECRET ?? "").trim();
  },
  upstreamTimeoutMs: num("UPSTREAM_TIMEOUT_MS", 8000),
  upstreamRetries: Math.floor(num("UPSTREAM_RETRIES", 2)),
  autoMaxItems: num("AUTO_PAGINATION_MAX_ITEMS", 5000),
  autoMaxPages: num("AUTO_PAGINATION_MAX_PAGES", 50),
  autoTimeoutMs: num("AUTO_PAGINATION_TIMEOUT_MS", 25000),
  batchMaxSize: Math.floor(num("BATCH_MAX_SIZE", 25)),
  batchDefaultConcurrency: Math.floor(num("BATCH_DEFAULT_CONCURRENCY", 5)),
  batchMaxConcurrency: Math.floor(num("BATCH_MAX_CONCURRENCY", 10)),
  batchTimeoutMs: num("BATCH_TIMEOUT_MS", 50000),
  cacheMaxEntries: Math.floor(num("CACHE_MAX_ENTRIES", 500)),
  logRetentionDays: num("LOG_RETENTION_DAYS", 7),
  maxBodyBytes: 256 * 1024,
  maxImageBytes: 2 * 1024 * 1024,
};

import { config } from "./config";

interface Entry { value: unknown; expires: number }
const g = globalThis as unknown as { __cache?: Map<string, Entry>; __inflight?: Map<string, Promise<unknown>> };
const store = (g.__cache ??= new Map());
const inflight = (g.__inflight ??= new Map());

export function cacheGet<T>(key: string): T | undefined {
  const e = store.get(key);
  if (!e) return undefined;
  if (e.expires < Date.now()) { store.delete(key); return undefined; }
  return e.value as T;
}

export function cacheSet(key: string, value: unknown, ttlSeconds: number) {
  if (store.size >= config.cacheMaxEntries) {
    const now = Date.now();
    for (const [k, v] of store) if (v.expires < now) store.delete(k);
    while (store.size >= config.cacheMaxEntries) store.delete(store.keys().next().value as string); // oldest first
  }
  store.set(key, { value, expires: Date.now() + ttlSeconds * 1000 });
}

/** Concurrent identical requests share one upstream computation. */
export async function dedupe<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inflight.get(key) as Promise<T> | undefined;
  if (existing) return existing;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

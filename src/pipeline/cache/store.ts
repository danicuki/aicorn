import type { CacheEntry } from "./types";

export async function readCache(kv: KVNamespace, key: string): Promise<CacheEntry | null> {
  return kv.get<CacheEntry>(key, "json");
}

export async function writeCache(kv: KVNamespace, key: string, entry: CacheEntry): Promise<void> {
  await kv.put(key, JSON.stringify(entry));
}

export async function bumpHitCount(kv: KVNamespace, key: string): Promise<CacheEntry | null> {
  const entry = await readCache(kv, key);
  if (!entry) return null;
  entry.hit_count += 1;
  await writeCache(kv, key, entry);
  return entry;
}

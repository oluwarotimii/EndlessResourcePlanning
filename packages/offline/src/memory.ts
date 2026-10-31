import type { KvStore, QueueItem, QueueStore, Storage } from "./types";

export function createMemoryStorage(): Storage {
  const items = new Map<string, QueueItem>();
  const kv = new Map<string, unknown>();
  const queue: QueueStore = {
    put: async (i) => { items.set(i.id, structuredClone(i)); },
    getAll: async () => [...items.values()].map((i) => structuredClone(i)),
    delete: async (id) => { items.delete(id); },
  };
  const kvStore: KvStore = {
    get: async <T,>(k: string) => (kv.has(k) ? (structuredClone(kv.get(k)) as T) : undefined),
    set: async (k, v) => { kv.set(k, structuredClone(v)); },
    delete: async (k) => { kv.delete(k); },
    list: async <T,>(prefix: string) => [...kv.entries()].filter(([k]) => k.startsWith(prefix)).map(([, v]) => structuredClone(v) as T),
  };
  return { queue, kv: kvStore, kind: "memory" };
}

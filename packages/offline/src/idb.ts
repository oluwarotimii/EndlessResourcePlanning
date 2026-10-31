import type { KvStore, QueueItem, QueueStore, Storage } from "./types";

const req = <T,>(r: IDBRequest<T>) => new Promise<T>((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
const done = (tx: IDBTransaction) => new Promise<void>((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error); });

/** IndexedDB-backed storage: survives reloads, power cuts and closing the browser. */
export async function openIdbStorage(name = "erp-offline"): Promise<Storage> {
  const db = await new Promise<IDBDatabase>((res, rej) => {
    const open = indexedDB.open(name, 1);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("queue", { keyPath: "id" });
      open.result.createObjectStore("kv");
    };
    open.onsuccess = () => res(open.result);
    open.onerror = () => rej(open.error);
  });
  const queue: QueueStore = {
    async put(item) { const tx = db.transaction("queue", "readwrite"); tx.objectStore("queue").put(item); await done(tx); },
    async getAll() { return (await req(db.transaction("queue").objectStore("queue").getAll())) as QueueItem[]; },
    async delete(id) { const tx = db.transaction("queue", "readwrite"); tx.objectStore("queue").delete(id); await done(tx); },
  };
  const kv: KvStore = {
    async get<T,>(key: string) { return (await req(db.transaction("kv").objectStore("kv").get(key))) as T | undefined; },
    async set(key, value) { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").put(value, key); await done(tx); },
    async delete(key) { const tx = db.transaction("kv", "readwrite"); tx.objectStore("kv").delete(key); await done(tx); },
    async list<T,>(prefix: string) {
      return (await req(db.transaction("kv").objectStore("kv").getAll(IDBKeyRange.bound(prefix, prefix + "￿")))) as T[];
    },
  };
  return { queue, kv, kind: "indexeddb" };
}

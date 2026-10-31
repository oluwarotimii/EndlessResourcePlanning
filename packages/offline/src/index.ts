import { openIdbStorage } from "./idb";
import { createMemoryStorage } from "./memory";
import type { Storage } from "./types";

export * from "./types";
export * from "./queue";
export { createMemoryStorage } from "./memory";
export { openIdbStorage } from "./idb";

/** IndexedDB when the browser allows it; memory otherwise (private windows, blocked storage). */
export async function openStorage(): Promise<Storage> {
  try { return await openIdbStorage(); } catch { return createMemoryStorage(); }
}

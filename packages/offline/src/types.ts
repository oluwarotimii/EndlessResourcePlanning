export type QueueItemType = "sale.create" | "shift.open" | "shift.close" | "print.log" | "transfer.dispatch" | "transfer.receive" | "count.submit" | "delivery.proof";

export interface QueueItem {
  /** The idempotency key. Replaying the same item can never post twice. */
  id: string;
  type: QueueItemType;
  /** Items for the same record (e.g. one shift) replay strictly in order. */
  recordKey: string;
  /** Who created it. It is only ever replayed under this identity. */
  userId: string;
  /** Display only, so the sync tray can say whose item is waiting. */
  userName?: string;
  payload: unknown;
  status: "pending" | "failed";
  attempts: number;
  createdAt: number;
  lastError?: string;
}

export interface QueueStore {
  put(item: QueueItem): Promise<void>;
  getAll(): Promise<QueueItem[]>;
  delete(id: string): Promise<void>;
}

/** Small key-value store for the catalogue, parked sales, shift state and recent sales. */
export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  /** All values whose key starts with the prefix. */
  list<T>(prefix: string): Promise<T[]>;
}

export interface Storage { queue: QueueStore; kv: KvStore; kind: "indexeddb" | "memory" }

import type { QueueItem, QueueStore } from "./types";

/** Why a send failed decides what happens to the item. */
export class SendError extends Error {
  constructor(public readonly kind: "transient" | "auth" | "permanent", message: string) { super(message); }
}
/** "ok" and "duplicate" both mean the server has it: remove from the queue. */
export type SendResult = "ok" | "duplicate";
export type Sender = (item: QueueItem) => Promise<SendResult>;

export interface FlushReport { sent: number; failed: number; stopped: "network" | "auth" | null }

export interface Queue {
  enqueue(item: Omit<QueueItem, "status" | "attempts" | "createdAt"> & { createdAt?: number }): Promise<QueueItem>;
  /** Replay this user's items in order. Items of other users are never touched. */
  flush(userId: string, send: Sender): Promise<FlushReport>;
  /** Put a failed item back to pending so the next flush tries again. */
  retry(id: string): Promise<void>;
  snapshot(): readonly QueueItem[];
  subscribe(cb: () => void): () => void;
  refresh(): Promise<void>;
}

export function createQueue(store: QueueStore): Queue {
  let items: QueueItem[] = [];
  const listeners = new Set<() => void>();
  let running: Promise<FlushReport> | null = null;

  const sort = (list: QueueItem[]) => list.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  const publish = (next: QueueItem[]) => { items = sort(next); listeners.forEach((l) => l()); };
  const refresh = async () => publish(await store.getAll());

  async function runFlush(userId: string, send: Sender): Promise<FlushReport> {
    const report: FlushReport = { sent: 0, failed: 0, stopped: null };
    const mine = items.filter((i) => i.userId === userId && i.status === "pending");
    const blocked = new Set<string>(); // record keys whose earlier item failed: later ones must wait
    for (const item of mine) {
      if (blocked.has(item.recordKey)) continue;
      try {
        await send(item);
        await store.delete(item.id);
        report.sent++;
      } catch (e) {
        const err = e instanceof SendError ? e : new SendError("transient", String(e));
        const updated: QueueItem = { ...item, attempts: item.attempts + 1, lastError: err.message };
        if (err.kind === "transient" || err.kind === "auth") {
          await store.put(updated); // stays pending; try again when reachable / signed in
          report.stopped = err.kind === "auth" ? "auth" : "network";
          break;
        }
        await store.put({ ...updated, status: "failed" }); // visible for review, never silently dropped
        blocked.add(item.recordKey);
        report.failed++;
      }
    }
    await refresh();
    return report;
  }

  return {
    async enqueue(partial) {
      const item: QueueItem = { status: "pending", attempts: 0, createdAt: Date.now(), ...partial };
      await store.put(item);
      await refresh();
      return item;
    },
    flush(userId, send) {
      // One flush at a time so a retry can never overlap itself.
      running ??= runFlush(userId, send).finally(() => { running = null; });
      return running;
    },
    async retry(id) {
      const item = items.find((i) => i.id === id);
      if (item) { await store.put({ ...item, status: "pending", lastError: undefined }); await refresh(); }
    },
    snapshot: () => items,
    subscribe(cb) { listeners.add(cb); return () => listeners.delete(cb); },
    refresh,
  };
}

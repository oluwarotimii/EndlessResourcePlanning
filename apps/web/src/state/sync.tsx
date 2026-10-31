import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { PrintLogInput, SaleInput, ShiftCloseInput, ShiftOpenInput } from "@erp/api-contract";
import { SendError, createQueue, type FlushReport, type QueueItem, type QueueItemType, type Sender, type Storage } from "@erp/offline";
import { ApiFailure, type ApiClient } from "../api/client";
import { saleKey, type LocalSale } from "../features/shift/shift";
import { useSession } from "./session";

export type ConnectionState = "online" | "offline" | "syncing";

interface SyncApi {
  storage: Storage;
  queue: readonly QueueItem[];
  state: ConnectionState;
  /** Items still waiting to reach the server (pending, not failed). */
  pending: number;
  failed: number;
  simulated: boolean;
  setSimulated(v: boolean): void;
  enqueue(item: { id: string; type: QueueItemType; recordKey: string; payload: unknown }): Promise<void>;
  flushNow(): Promise<FlushReport | undefined>;
  retry(id: string): Promise<void>;
}
const Ctx = createContext<SyncApi | null>(null);

function toSendError(e: unknown): SendError {
  if (e instanceof ApiFailure) {
    if (e.code === "unavailable") return new SendError("transient", e.message);
    if (e.code === "unauthenticated") return new SendError("auth", e.message);
    return new SendError("permanent", e.message);
  }
  return new SendError("transient", String(e));
}

/** Turns a queued item into the matching API call. The idempotency key makes every one safe to retry. */
export function makeSender(api: ApiClient, token: string, storage: Storage, userId: string, isOffline: () => boolean): Sender {
  return async (item) => {
    if (isOffline()) throw new SendError("transient", "offline");
    try {
      switch (item.type) {
        case "sale.create": {
          const res = await api.createSale(token, SaleInput.parse(item.payload));
          const key = saleKey(userId, item.id);
          const local = await storage.kv.get<LocalSale>(key);
          if (local) await storage.kv.set(key, { ...local, synced: true, invoiceNo: res.sale.invoiceNo } satisfies LocalSale);
          return res.duplicate ? "duplicate" : "ok";
        }
        case "shift.open": return (await api.openShift(token, ShiftOpenInput.parse(item.payload))).duplicate ? "duplicate" : "ok";
        case "shift.close": return (await api.closeShift(token, ShiftCloseInput.parse(item.payload))).duplicate ? "duplicate" : "ok";
        case "print.log": await api.logPrint(token, PrintLogInput.parse(item.payload)); return "ok";
      }
    } catch (e) {
      if (e instanceof SendError) throw e;
      if (e instanceof Error && e.name === "ZodError") throw new SendError("permanent", "This item is malformed and cannot be sent.");
      throw toSendError(e);
    }
  };
}

export function SyncProvider({ storage, children }: { storage: Storage; children: ReactNode }) {
  const { api, token, caps } = useSession();
  const queue = useMemo(() => createQueue(storage.queue), [storage]);
  const items = useSyncExternalStore(queue.subscribe, queue.snapshot);
  const [simulated, setSimulated] = useState(false);
  const [browserOnline, setBrowserOnline] = useState(() => navigator.onLine);
  const [reachable, setReachable] = useState(true);
  const [flushing, setFlushing] = useState(false);
  const simRef = useRef(false);
  simRef.current = simulated;

  useEffect(() => { void queue.refresh(); }, [queue]);
  useEffect(() => {
    const up = () => setBrowserOnline(true), down = () => setBrowserOnline(false);
    window.addEventListener("online", up); window.addEventListener("offline", down);
    return () => { window.removeEventListener("online", up); window.removeEventListener("offline", down); };
  }, []);

  const flushNow = useCallback(async () => {
    if (!token || !caps) return undefined;
    const isOffline = () => simRef.current || !navigator.onLine;
    setFlushing(true);
    try {
      // Only this user's items are replayed, under this user's identity.
      const report = await queue.flush(caps.user.id, makeSender(api, token, storage, caps.user.id, isOffline));
      setReachable(report.stopped !== "network");
      return report;
    } finally { setFlushing(false); }
  }, [api, token, caps, queue, storage]);

  // Replay when we sign in, when the network returns, and on a timer while anything is waiting.
  useEffect(() => { void flushNow(); }, [flushNow, browserOnline, simulated]);
  const waiting = items.some((i) => i.status === "pending" && i.userId === caps?.user.id);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void flushNow(), 15_000);
    return () => clearInterval(id);
  }, [waiting, flushNow]);

  const enqueue = useCallback<SyncApi["enqueue"]>(async (item) => {
    if (!caps) throw new Error("Not signed in");
    await queue.enqueue({ ...item, userId: caps.user.id, userName: caps.user.name });
    void flushNow();
  }, [caps, queue, flushNow]);

  const pending = items.filter((i) => i.status === "pending").length;
  const failed = items.filter((i) => i.status === "failed").length;
  const isOffline = simulated || !browserOnline || !reachable;
  const state: ConnectionState = isOffline ? "offline" : pending > 0 || flushing ? "syncing" : "online";
  const value = useMemo<SyncApi>(
    () => ({ storage, queue: items, state, pending, failed, simulated, setSimulated, enqueue, flushNow, retry: async (id) => { await queue.retry(id); void flushNow(); } }),
    [storage, items, state, pending, failed, simulated, enqueue, flushNow, queue],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export function useSync(): SyncApi {
  const v = useContext(Ctx);
  if (!v) throw new Error("SyncProvider missing");
  return v;
}

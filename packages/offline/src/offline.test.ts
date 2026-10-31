import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { SendError, createMemoryStorage, createQueue, openIdbStorage, type QueueItem, type Sender } from "./index";

const mk = (id: string, over: Partial<QueueItem> = {}) => ({
  id, type: "sale.create" as const, recordKey: "shift-1", userId: "u1", payload: { id }, ...over,
});
const sentOrder: string[] = [];
const ok: Sender = async (i) => { sentOrder.push(i.id); return "ok"; };

describe("offline queue", () => {
  it("replays in order per record", async () => {
    sentOrder.length = 0;
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("a", { createdAt: 1 })); await q.enqueue(mk("b", { createdAt: 2 })); await q.enqueue(mk("c", { createdAt: 3 }));
    const r = await q.flush("u1", ok);
    expect(sentOrder).toEqual(["a", "b", "c"]);
    expect(r.sent).toBe(3);
    expect(q.snapshot()).toHaveLength(0);
  });

  it("keeps items pending and stops when the network is down, then resumes", async () => {
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("a", { createdAt: 1 })); await q.enqueue(mk("b", { createdAt: 2 }));
    const down: Sender = async () => { throw new SendError("transient", "offline"); };
    const r1 = await q.flush("u1", down);
    expect(r1.stopped).toBe("network");
    expect(q.snapshot().map((i) => [i.id, i.status, i.attempts])).toEqual([["a", "pending", 1], ["b", "pending", 0]]);
    sentOrder.length = 0;
    await q.flush("u1", ok);
    expect(sentOrder).toEqual(["a", "b"]);
  });

  it("treats a duplicate as success: removed from the queue", async () => {
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("a"));
    await q.flush("u1", async () => "duplicate");
    expect(q.snapshot()).toHaveLength(0);
  });

  it("a permanent failure is kept visible and blocks later items of the same record only", async () => {
    sentOrder.length = 0;
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("bad", { createdAt: 1 }));
    await q.enqueue(mk("after", { createdAt: 2 }));
    await q.enqueue(mk("other", { createdAt: 3, recordKey: "shift-2" }));
    const send: Sender = async (i) => { if (i.id === "bad") throw new SendError("permanent", "Shift is closed"); sentOrder.push(i.id); return "ok"; };
    const r = await q.flush("u1", send);
    expect(r.failed).toBe(1);
    expect(sentOrder).toEqual(["other"]);
    const left = Object.fromEntries(q.snapshot().map((i) => [i.id, i.status]));
    expect(left).toEqual({ bad: "failed", after: "pending" });
    expect(q.snapshot().find((i) => i.id === "bad")?.lastError).toBe("Shift is closed");
    await q.retry("bad");
    expect(q.snapshot().find((i) => i.id === "bad")?.status).toBe("pending");
  });

  it("never replays under another identity", async () => {
    sentOrder.length = 0;
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("amaka", { userId: "u-cashier" }));
    await q.enqueue(mk("tunde", { userId: "u-manager" }));
    await q.flush("u-manager", ok);
    expect(sentOrder).toEqual(["tunde"]);
    expect(q.snapshot().map((i) => i.id)).toEqual(["amaka"]);
  });

  it("an auth failure stops the flush and leaves items pending", async () => {
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("a"));
    const r = await q.flush("u1", async () => { throw new SendError("auth", "expired"); });
    expect(r.stopped).toBe("auth");
    expect(q.snapshot()[0]?.status).toBe("pending");
  });

  it("does not run two flushes at once", async () => {
    const q = createQueue(createMemoryStorage().queue);
    await q.enqueue(mk("a"));
    let calls = 0;
    const slow: Sender = async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return "ok"; };
    await Promise.all([q.flush("u1", slow), q.flush("u1", slow)]);
    expect(calls).toBe(1);
  });
});

describe("IndexedDB storage", () => {
  it("survives re-opening the database (reload / power cut)", async () => {
    const first = await openIdbStorage("t-reopen");
    await createQueue(first.queue).enqueue(mk("kept"));
    await first.kv.set("parked:u1:1", { n: 1 });
    await first.kv.set("parked:u1:2", { n: 2 });
    await first.kv.set("other", { n: 3 });
    const second = await openIdbStorage("t-reopen");
    const q = createQueue(second.queue);
    await q.refresh();
    expect(q.snapshot().map((i) => i.id)).toEqual(["kept"]);
    expect((await second.kv.list<{ n: number }>("parked:u1:")).map((v) => v.n)).toEqual([1, 2]);
    expect(await second.kv.get("other")).toEqual({ n: 3 });
    await second.kv.delete("other");
    expect(await second.kv.get("other")).toBeUndefined();
  });
});

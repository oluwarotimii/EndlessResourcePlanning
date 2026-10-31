import type { QueueItem } from "@erp/offline";

export type SaleBlock = "cap" | "syncWindow" | null;

/**
 * Offline safety limits from tenant.json: a cap on unsynced sales per till and a mandatory sync window.
 * Pure, so it is easy to test.
 */
export function saleBlock(
  queue: readonly QueueItem[],
  limits: { maxOfflineSalesPerTill: number; syncWindowHours: number },
  now = Date.now(),
): SaleBlock {
  const pending = queue.filter((i) => i.type === "sale.create");
  if (pending.length >= limits.maxOfflineSalesPerTill) return "cap";
  const oldest = Math.min(...pending.map((i) => i.createdAt), Infinity);
  if (pending.length > 0 && now - oldest > limits.syncWindowHours * 3_600_000) return "syncWindow";
  return null;
}

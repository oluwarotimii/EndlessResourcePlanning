import type { Customer } from "@erp/api-contract";
import type { Storage } from "@erp/offline";
import type { ApiClient } from "../../api/client";

const KEY = "customers";

/**
 * Online: ask the server and remember what came back. Offline (or on error): search what this device has seen.
 * Cached balances can be stale; the server re-checks the credit limit when the sale syncs.
 */
export async function searchCustomers(
  api: ApiClient, token: string, storage: Storage, q: string, online: boolean,
): Promise<{ customers: Customer[]; fromCache: boolean }> {
  const cache = (await storage.kv.get<Record<string, Customer>>(KEY)) ?? {};
  if (online) {
    try {
      const { customers } = await api.customers(token, q);
      for (const c of customers) cache[c.id] = c;
      await storage.kv.set(KEY, cache);
      return { customers, fromCache: false };
    } catch { /* fall through to the cache */ }
  }
  const needle = q.trim().toLowerCase();
  const hits = Object.values(cache).filter((c) => !needle || c.name.toLowerCase().includes(needle) || (c.phone ?? "").includes(needle));
  return { customers: hits, fromCache: true };
}

/** What a customer can still take on credit; undefined when they have no credit terms. */
export const availableCredit = (c: Pick<Customer, "creditLimit" | "balance"> | undefined): number | undefined =>
  c?.creditLimit === undefined ? undefined : Math.max(0, c.creditLimit - (c.balance ?? 0));

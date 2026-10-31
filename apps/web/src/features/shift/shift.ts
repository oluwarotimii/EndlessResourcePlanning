import { cashOf, type Payment, type VatMode } from "@erp/api-contract";
import type { Storage } from "@erp/offline";

/** Local truth for the till; the server gets the same facts through the queue. */
export interface LocalShift {
  id: string;
  status: "open" | "closed";
  openingFloat: number;
  openedAt: string;
  closedAt?: string;
  countedCash?: number;
}

export interface LocalSale {
  key: string;
  shiftId: string;
  lines: Array<{ productId: string; name: string; unitPrice: number; qty: number }>;
  subtotal: number;
  vatMode: VatMode;
  vat: number;
  total: number;
  /** Whole naira taken off the gross subtotal by an approved discount. */
  discount?: number;
  discountPercent?: number;
  discountApprovalId?: string;
  payments: Payment[];
  customerName?: string;
  cashierName: string;
  createdAt: string;
  /** Shown on the receipt until the server issues the real invoice number. */
  provisionalNo: string;
  invoiceNo?: string;
  synced: boolean;
}

export const shiftKey = (userId: string) => `shift:${userId}`;
export const saleKey = (userId: string, key: string) => `sale:${userId}:${key}`;
export const salePrefix = (userId: string) => `sale:${userId}:`;

export const getShift = (s: Storage, userId: string) => s.kv.get<LocalShift>(shiftKey(userId));
export const listSales = async (s: Storage, userId: string) =>
  (await s.kv.list<LocalSale>(salePrefix(userId))).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

/** Expected cash in the drawer: opening float plus the CASH payments of this shift (card, transfer and credit never enter the drawer). */
export function expectedCash(shift: LocalShift, sales: readonly LocalSale[]): number {
  return shift.openingFloat + sales.filter((x) => x.shiftId === shift.id).reduce((n, x) => n + cashOf(x.payments), 0);
}
export const provisionalNumber = (key: string) => `OFF-${key.replace(/-/g, "").slice(0, 6).toUpperCase()}`;

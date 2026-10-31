import type { Payment, VatMode } from "@erp/api-contract";

export interface PrintDoc {
  kind: "invoice" | "receipt";
  number: string;
  /** True until the sale has reached the server: the copy carries a COPY label. */
  copy: boolean;
  date: string;
  cashier: string;
  customer?: string;
  lines: Array<{ name: string; unitPrice: number; qty: number }>;
  subtotal: number;
  vatMode: VatMode;
  vat: number;
  total: number;
  payments: Payment[];
}

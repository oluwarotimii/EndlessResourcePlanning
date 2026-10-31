import { Printer } from "lucide-react";
import { useState } from "react";
import { computeTotals } from "@erp/api-contract";
import { t } from "../i18n";
import { useTenant } from "../state/tenant";
import { SaleDocument } from "../features/print/SaleDocument";
import { usePrint } from "../features/print/PrintProvider";
import type { PrintDoc } from "../features/print/types";
import { Button } from "../ui/Button";

/** Preview of the A5 templates with sample data. Delivery and transfer notes, statements and payout advice follow in their sprints. */
const SAMPLE: PrintDoc = {
  kind: "invoice", number: "INV-000123", copy: false, date: "31/10/2026, 10:30", cashier: "Amaka Obi", customer: "Ade Stores",
  lines: [{ name: "Phone charger 20W", unitPrice: 6500, qty: 2 }, { name: "USB-C cable 1m", unitPrice: 2500, qty: 3 }, { name: "Screen protector", unitPrice: 1500, qty: 1 }],
  subtotal: 22000, vatMode: "inclusive", vat: 1535, total: 22000,
  payments: [{ method: "cash", amount: 12000 }, { method: "credit", amount: 10000 }],
};

export function PrintTemplatesPage() {
  const { print } = usePrint();
  const [kind, setKind] = useState<PrintDoc["kind"]>("invoice");
  const [copy, setCopy] = useState(false);
  const tenant = useTenant();
  // The preview follows the company's VAT setting so you can see exactly what customers get.
  const totals = computeTotals(SAMPLE.subtotal, tenant.tax.mode, tenant.tax.vatRate);
  const payments = SAMPLE.payments.map((p) => (p.method === "credit" ? { ...p, amount: totals.total - 12000 } : p));
  const doc: PrintDoc = { ...SAMPLE, ...totals, vatMode: tenant.tax.mode, payments, kind, copy, number: kind === "invoice" ? SAMPLE.number : "RCT-000123" };
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("templates.title")}</h1>
      <div className="flex flex-wrap gap-2">
        {(["invoice", "receipt"] as const).map((k) => (
          <Button key={k} variant={kind === k ? "primary" : "subtle"} aria-pressed={kind === k} onClick={() => setKind(k)}>{t(k === "invoice" ? "doc.invoice" : "doc.receipt")}</Button>
        ))}
        <Button variant={copy ? "primary" : "subtle"} aria-pressed={copy} onClick={() => setCopy(!copy)}>{t("templates.copy")}</Button>
        <Button variant="secondary" onClick={() => print(doc)}><Printer className="h-5 w-5" aria-hidden="true" />{t("templates.print")}</Button>
      </div>
      <div className="rounded-2xl border border-border bg-fill p-4"><SaleDocument doc={doc} /></div>
    </div>
  );
}

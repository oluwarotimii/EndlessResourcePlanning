import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product, PurchaseOrder } from "@erp/api-contract";
import { t } from "../i18n";
import { cacheCatalog, loadCachedCatalog } from "../features/till/catalog";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ScanBox } from "../ui/ScanBox";

/**
 * H01. Receive goods from a supplier against a purchase order: pick an order, scan each item as it comes off the
 * truck, then confirm. Receiving less than ordered is normal (the rest may arrive in a later delivery); receiving
 * more than the order plus the configured allowance is refused. Works offline: the receipt is queued with an
 * idempotency key. Raising a purchase order is a later screen (R01); orders arrive here already open.
 */
export function GoodsReceiptPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const tenant = useTenant();
  const { data, failed, retry, update } = useCachedReport<{ purchaseOrders: PurchaseOrder[] }>("purchase-orders", (tk) => api.purchaseOrders(tk));
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState<PurchaseOrder | null>(null);
  const [received, setReceived] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      const cached = await loadCachedCatalog(sync.storage);
      if (live && cached) setProducts(cached.products);
      if (sync.state === "offline") return;
      try { const fresh = await api.products(token); await cacheCatalog(sync.storage, fresh); if (live) setProducts(fresh.products); } catch { /* saved list still works */ }
    })();
    return () => { live = false; };
  }, [api, token, sync.storage, sync.state]);

  const waiting = data?.purchaseOrders.filter((x) => x.status !== "received") ?? [];
  const recent = data?.purchaseOrders.filter((x) => x.status === "received").slice(0, 5) ?? [];
  /** How many more of this line the officer may enter this visit, including the configured over-receipt allowance. */
  const roomFor = (l: PurchaseOrder["lines"][number]) => Math.max(0, Math.floor(l.qtyOrdered * (1 + tenant.stock.overReceiptAllowancePercent / 100)) - l.qtyReceived);
  const left = open ? open.lines.reduce((n, l) => n + Math.max(0, l.qtyOrdered - l.qtyReceived - (received[l.productId] ?? 0)), 0) : 0;

  const start = (x: PurchaseOrder) => { setOpen(x); setReceived({}); setNote(""); setMessage(null); setDone(false); };
  const bump = (productId: string, by: number, max: number) => setReceived((c) => ({ ...c, [productId]: Math.min(max, Math.max(0, (c[productId] ?? 0) + by)) }));

  const onCode = (code: string) => {
    if (!open) return;
    const product = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    const line = product && open.lines.find((l) => l.productId === product.id);
    if (!line) { setMessage(t("scan.unknown", { code })); return; }
    const max = roomFor(line);
    if ((received[line.productId] ?? 0) >= max) { setMessage(t("goods.full", { name: line.name })); return; }
    setMessage(null);
    bump(line.productId, 1, max);
  };

  async function confirm() {
    if (!open || busy) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const lines = open.lines.filter((l) => l.qtyReceived < l.qtyOrdered).map((l) => ({ productId: l.productId, qty: received[l.productId] ?? 0 })); // every line still open is counted, even as zero
      await sync.enqueue({ id, type: "goods_receipt.submit", recordKey: `purchase-order:${open.id}`, payload: { idempotencyKey: id, purchaseOrderId: open.id, lines, note: note.trim() || undefined } });
      await update((d) => ({
        purchaseOrders: d.purchaseOrders.map((x) => {
          if (x.id !== open.id) return x;
          const newLines = x.lines.map((l) => ({ ...l, qtyReceived: l.qtyReceived + (received[l.productId] ?? 0) }));
          const status = newLines.every((l) => l.qtyReceived >= l.qtyOrdered) ? "received" : newLines.some((l) => l.qtyReceived > 0) ? "partially_received" : "open";
          return { ...x, lines: newLines, status: status as PurchaseOrder["status"] };
        }),
      }));
      setDone(true);
      setOpen(null);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("goods.title")}</h1>
        <p className="text-text-muted">{t("goods.subtitle")}</p>
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {done && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("goods.done")}</p>}

      {!open ? (
        <>
          {data && waiting.length === 0 && <p className="text-text-muted">{t("goods.none")}</p>}
          <ul className="space-y-3">
            {waiting.map((x) => (
              <li key={x.id}>
                <Card className="space-y-2 p-4" data-testid={`po-${x.id}`}>
                  <p className="tabular text-lg font-bold">{x.id}</p>
                  <p className="text-text-muted">{t("goods.from", { supplier: x.supplierName, ago: ago(x.createdAt) })}{x.reference ? ` · ${t("goods.reference", { reference: x.reference })}` : ""}</p>
                  <ul className="tabular">{x.lines.map((l) => <li key={l.productId}>{l.qtyReceived} / {l.qtyOrdered} × {l.name}</li>)}</ul>
                  <Button till className="w-full" onClick={() => start(x)}>{t("goods.open")}</Button>
                </Card>
              </li>
            ))}
          </ul>
          {recent.length > 0 && (
            <section aria-labelledby="recent" className="space-y-2">
              <h2 id="recent" className="text-xl font-bold">{t("goods.recent")}</h2>
              <ul className="space-y-2">
                {recent.map((x) => (
                  <li key={x.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`received-${x.id}`}>
                      <span className="tabular font-semibold">{x.id}</span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-success-subtle px-3 py-1 font-semibold text-success-ink">{t("goods.complete")}</span>
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between"><p className="tabular text-xl font-bold">{open.id}</p><Button variant="ghost" onClick={() => setOpen(null)}>{t("goods.back")}</Button></div>
          <ScanBox onCode={onCode} autoFocusKey={open.id} />
          <p role="status" className="min-h-[1.5rem] font-medium text-danger-ink">{message}</p>
          <ul className="divide-y divide-border">
            {open.lines.map((l) => {
              if (l.qtyReceived >= l.qtyOrdered) return null; // already fully received on an earlier visit
              const max = roomFor(l);
              const n = received[l.productId] ?? 0;
              return (
                <li key={l.productId} className="flex items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.name}</p>
                    <p className="tabular text-text-muted">{t("goods.counted", { received: l.qtyReceived + n, ordered: l.qtyOrdered })}</p>
                  </div>
                  <Button variant="subtle" icon disabled={n <= 0} aria-label={t("goods.less", { name: l.name })} onClick={() => bump(l.productId, -1, max)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-8 text-center text-lg font-bold" aria-label={`${n} ${l.name}`}>{n}</span>
                  <Button variant="subtle" icon disabled={n >= max} aria-label={t("goods.more", { name: l.name })} onClick={() => bump(l.productId, 1, max)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
          <p role="status" className={`rounded-xl p-3 font-semibold tabular ${left > 0 ? "bg-warning-subtle text-warning-ink" : "bg-success-subtle text-success-ink"}`} data-testid="left">
            {left > 0 ? t("goods.stillToCome", { n: left }) : t("goods.allIn")}
          </p>
          <label className="block"><span className="font-semibold">{t("goods.note")}</span>
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
          </label>
          <Button till className="w-full" disabled={busy} onClick={() => void confirm()}>{t("goods.confirm")}</Button>
        </Card>
      )}
    </div>
  );
}

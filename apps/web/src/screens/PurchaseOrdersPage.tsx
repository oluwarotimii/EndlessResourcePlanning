import { Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product, PurchaseOrder } from "@erp/api-contract";
import { t } from "../i18n";
import { ago } from "../features/stock/time";
import { ApiFailure } from "../api/client";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/**
 * R01. Raise a purchase order with a supplier. Who may is a permission (the Procurement area), so it can be given to
 * any person, whatever their job title; the screen only appears for people who hold it, and the server checks again.
 * Needs a connection (an order is a commitment to a supplier). The retry key is kept until the order is accepted.
 */
export function PurchaseOrdersPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const offline = sync.state === "offline";
  const { data, update } = useCachedReport<{ purchaseOrders: PurchaseOrder[] }>("purchase-orders", (tk) => api.purchaseOrders(tk));
  const [products, setProducts] = useState<Product[]>([]);
  const [supplier, setSupplier] = useState("");
  const [reference, setReference] = useState("");
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState(1);
  const [lines, setLines] = useState<Array<{ productId: string; name: string; qty: number }>>([]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!token) return;
    let live = true;
    void api.products(token).then((r) => { if (live) setProducts(r.products); }).catch(() => undefined);
    return () => { live = false; };
  }, [api, token]);

  const add = () => {
    const product = products.find((p) => p.id === pick);
    if (!product || qty < 1) return;
    setLines((ls) => (ls.some((l) => l.productId === product.id) ? ls.map((l) => (l.productId === product.id ? { ...l, qty: l.qty + qty } : l)) : [...ls, { productId: product.id, name: product.name, qty }]));
    setPick(""); setQty(1); setMessage(null);
  };

  async function send() {
    if (!token || busy) return;
    if (supplier.trim().length < 2 || lines.length === 0) { setMessage({ ok: false, text: t("po.empty") }); return; }
    setBusy(true);
    try {
      const res = await api.raisePurchaseOrder(token, { idempotencyKey: key, supplierName: supplier.trim(), reference: reference.trim() || undefined, lines: lines.map(({ productId, qty: q }) => ({ productId, qty: q })) });
      await update((d) => ({ purchaseOrders: [res.purchaseOrder, ...d.purchaseOrders.filter((x) => x.id !== res.purchaseOrder.id)] }));
      setMessage({ ok: true, text: t("po.done", { id: res.purchaseOrder.id, supplier: res.purchaseOrder.supplierName }) });
      setSupplier(""); setReference(""); setLines([]); setKey(crypto.randomUUID());
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiFailure && e.code === "forbidden" ? t("po.forbidden") : e instanceof ApiFailure ? e.message : t("report.loadFailed") });
    } finally { setBusy(false); }
  }

  const statusLabel = (s: PurchaseOrder["status"]) => t(`po.status.${s}`);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("po.title")}</h1>
        <p className="text-text-muted">{t("po.subtitle")}</p>
      </div>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("po.offline")}</p>}
      <Card className="space-y-4 p-5">
        <label className="block"><span className="font-semibold">{t("po.supplier")}</span>
          <input value={supplier} maxLength={120} onChange={(e) => setSupplier(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
        </label>
        <label className="block"><span className="font-semibold">{t("po.reference")}</span>
          <input value={reference} maxLength={60} onChange={(e) => setReference(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
        </label>
        <div className="flex flex-wrap items-end gap-2">
          <label className="block min-w-0 flex-1"><span className="font-semibold">{t("po.item")}</span>
            <select value={pick} onChange={(e) => setPick(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3">
              <option value="">{t("po.choose")}</option>
              {products.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="block"><span className="font-semibold">{t("po.qty")}</span>
            <input type="number" inputMode="numeric" min={1} value={qty} onChange={(e) => setQty(Math.max(1, Math.floor(Number(e.target.value) || 1)))} className="tabular mt-1 min-h-touch w-28 rounded-xl border border-border-strong bg-surface-raised px-3" />
          </label>
          <Button variant="subtle" disabled={!pick} onClick={add}>{t("po.add")}</Button>
        </div>
        <ul className="divide-y divide-border">
          {lines.map((l) => (
            <li key={l.productId} className="flex items-center gap-2 py-2">
              <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
              <span className="tabular font-bold">× {l.qty}</span>
              <Button variant="ghost" icon aria-label={t("po.remove", { name: l.name })} onClick={() => setLines((ls) => ls.filter((x) => x.productId !== l.productId))}><Trash2 className="h-5 w-5" aria-hidden="true" /></Button>
            </li>
          ))}
        </ul>
        {message && <p role="status" className={`rounded-xl p-3 font-semibold ${message.ok ? "bg-success-subtle text-success-ink" : "bg-danger-subtle text-danger-ink"}`}>{message.text}</p>}
        <Button till className="w-full" disabled={busy || offline} onClick={() => void send()}>{t("po.send")}</Button>
      </Card>
      {data && data.purchaseOrders.length > 0 && (
        <section aria-labelledby="po-recent" className="space-y-2">
          <h2 id="po-recent" className="text-xl font-bold">{t("po.recent")}</h2>
          <ul className="space-y-2">
            {data.purchaseOrders.slice(0, 8).map((x) => (
              <li key={x.id}>
                <Card className="space-y-1 p-4" data-testid={`po-${x.id}`}>
                  <p className="flex flex-wrap items-center justify-between gap-2"><span className="tabular text-lg font-bold">{x.id}</span><span className="rounded-full border border-border bg-surface-sunken px-3 py-1 font-semibold">{statusLabel(x.status)}</span></p>
                  <p className="text-text-muted">{x.supplierName} · {ago(x.createdAt)}{x.raisedBy ? ` · ${t("po.by", { name: x.raisedBy.name })}` : ""}</p>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

import { CheckCircle2, Clock, Minus, Plus, XCircle } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { Customer, Product, SalesOrder } from "@erp/api-contract";
import { t } from "../i18n";
import { ApiFailure } from "../api/client";
import { cacheCatalog, loadCachedCatalog } from "../features/till/catalog";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ScanBox } from "../ui/ScanBox";

interface Line { productId: string; name: string; unitPrice: number; qty: number }

/**
 * S06. A sales attendant builds an order on a phone or tablet, as the customer shops, and sends it. The cashier sees it
 * under Parked sales and orders, picks it up with every line already filled in, and only takes payment. Prices come from
 * the server when the order is made. Items that come in variants must be scanned, never tapped, so the right one is sold.
 * Needs a connection: the order has to reach the cashier's device.
 */
export function BuildOrderPage() {
  const { api, token, caps } = useSession();
  const sync = useSync();
  const tenant = useTenant();
  const money = useMoney();
  const offline = sync.state === "offline";
  const mine = useCachedReport<{ orders: SalesOrder[] }>("orders", (tk) => api.orders(tk));
  const [products, setProducts] = useState<Product[]>([]);
  const [term, setTerm] = useState("");
  const [lines, setLines] = useState<Line[]>([]);
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [custTerm, setCustTerm] = useState("");
  const [custResults, setCustResults] = useState<Customer[]>([]);
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [key, setKey] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      const cached = await loadCachedCatalog(sync.storage);
      if (live && cached) setProducts(cached.products);
      if (sync.state === "offline") return;
      try { const fresh = await api.products(token); await cacheCatalog(sync.storage, fresh); if (live) setProducts(fresh.products); } catch { /* the saved list still works */ }
    })();
    return () => { live = false; };
  }, [api, token, sync.storage, sync.state]);

  const mustScan = (p: Product) => tenant.till.scanRequiredForVariants && !!p.family;
  const results = useMemo(() => {
    const q = term.trim().toLowerCase();
    return q ? products.filter((p) => p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q)).slice(0, 8) : [];
  }, [products, term]);
  const total = lines.reduce((n, l) => n + l.unitPrice * l.qty, 0);

  const add = (p: Product) => {
    setMessage(null);
    setLines((ls) => (ls.some((l) => l.productId === p.id) ? ls.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...ls, { productId: p.id, name: p.name, unitPrice: p.price, qty: 1 }]));
  };
  const onCode = (code: string) => {
    const p = products.find((x) => x.barcode === code || x.sku.toLowerCase() === code.toLowerCase());
    if (!p) { setMessage({ ok: false, text: t("scan.unknown", { code }) }); return; }
    add(p);
  };
  const setQty = (id: string, qty: number) => setLines((ls) => (qty <= 0 ? ls.filter((l) => l.productId !== id) : ls.map((l) => (l.productId === id ? { ...l, qty } : l))));

  async function findCustomer(q: string) {
    setCustTerm(q);
    if (!token || q.trim().length < 2 || offline) { setCustResults([]); return; }
    try { setCustResults((await api.customers(token, q)).customers.filter((c) => c.kind !== "partner").slice(0, 5)); } catch { setCustResults([]); }
  }

  async function send() {
    if (!token || busy || lines.length === 0) return;
    setBusy(true);
    try {
      const res = await api.createOrder(token, { idempotencyKey: key, lines: lines.map(({ productId, qty }) => ({ productId, qty })), customerId: customer?.id, note: note.trim() || undefined });
      await mine.update((d) => ({ orders: [res.order, ...d.orders.filter((o) => o.id !== res.order.id)] }));
      setMessage({ ok: true, text: t("orders.sent", { id: res.order.id }) });
      setLines([]); setCustomer(null); setCustTerm(""); setCustResults([]); setNote(""); setTerm(""); setKey(crypto.randomUUID());
    } catch (e) {
      setMessage({ ok: false, text: e instanceof ApiFailure ? e.message : t("report.loadFailed") });
    } finally { setBusy(false); }
  }
  async function cancel(o: SalesOrder) {
    if (!token) return;
    try {
      const res = await api.cancelOrder(token, o.id);
      await mine.update((d) => ({ orders: d.orders.map((x) => (x.id === o.id ? res.order : x)) }));
    } catch (e) { setMessage({ ok: false, text: e instanceof ApiFailure ? e.message : t("report.loadFailed") }); }
  }

  const myOrders = mine.data?.orders.filter((o) => o.createdBy.id === caps?.user.id).slice(0, 8) ?? [];
  const statusBadge = (s: SalesOrder["status"]) => {
    const Icon = s === "paid" ? CheckCircle2 : s === "cancelled" ? XCircle : Clock;
    const tone = s === "paid" ? "bg-success-subtle text-success-ink" : s === "cancelled" ? "bg-danger-subtle text-danger-ink" : "bg-warning-subtle text-warning-ink";
    return <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold ${tone}`}><Icon className="h-5 w-5" aria-hidden="true" />{t(`orders.status.${s}`)}</span>;
  };

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("orders.title")}</h1>
        <p className="text-text-muted">{t("orders.subtitle")}</p>
      </div>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("orders.offline")}</p>}
      <Card className="space-y-3 p-5">
        <ScanBox onCode={onCode} />
        <label className="block"><span className="sr-only">{t("till.scanLabel")}</span>
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("till.scanPlaceholder")} className="min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
        </label>
        {results.length > 0 && (
          <ul className="grid gap-2 sm:grid-cols-2">
            {results.map((p) => (
              <li key={p.id}>
                <button type="button" onClick={() => !mustScan(p) && add(p)} aria-disabled={mustScan(p)} className={`btn-spring glass-card flex min-h-touch w-full flex-col items-start rounded-xl p-3 text-left ${mustScan(p) ? "opacity-80" : "glass-card-lift"}`}>
                  <span className="font-semibold">{p.name}</span>
                  <span className="tabular text-text-muted">{money(p.price)}</span>
                  {mustScan(p) && <span className="text-text-muted">{t("till.scanToAdd")}</span>}
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card className="space-y-3 p-5">
        {lines.length === 0 ? <p className="text-text-muted">{t("orders.empty")}</p> : (
          <ul className="divide-y divide-border">
            {lines.map((l) => (
              <li key={l.productId} className="flex items-center gap-2 py-2">
                <div className="min-w-0 flex-1"><p className="truncate font-semibold">{l.name}</p><p className="tabular text-text-muted">{money(l.unitPrice)}</p></div>
                <Button variant="subtle" icon aria-label={t("orders.less", { name: l.name })} onClick={() => setQty(l.productId, l.qty - 1)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                <span className="tabular w-8 text-center text-lg font-bold" aria-label={`${l.qty} ${l.name}`}>{l.qty}</span>
                <Button variant="subtle" icon aria-label={t("orders.more", { name: l.name })} onClick={() => setQty(l.productId, l.qty + 1)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
              </li>
            ))}
          </ul>
        )}
        <p className="flex justify-between text-xl font-bold"><span>{t("orders.total")}</span><span className="tabular">{money(total)}</span></p>
        <div>
          <p className="font-semibold">{t("orders.customer")}</p>
          {customer ? (
            <p className="flex items-center justify-between gap-2"><span>{customer.name}</span><Button variant="ghost" onClick={() => setCustomer(null)}>{t("orders.noCustomer")}</Button></p>
          ) : (
            <>
              <input value={custTerm} onChange={(e) => void findCustomer(e.target.value)} placeholder={t("orders.customerSearch")} aria-label={t("orders.customerSearch")} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
              <ul>{custResults.map((c) => <li key={c.id}><button type="button" className="btn-spring min-h-touch w-full rounded-lg px-2 text-left hover:bg-fill" onClick={() => { setCustomer(c); setCustResults([]); }}>{c.name}</button></li>)}</ul>
            </>
          )}
        </div>
        <label className="block"><span className="font-semibold">{t("orders.note")}</span>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
        </label>
        {message && <p role="status" className={`rounded-xl p-3 font-semibold ${message.ok ? "bg-success-subtle text-success-ink" : "bg-danger-subtle text-danger-ink"}`}>{message.text}</p>}
        <Button till className="w-full" disabled={busy || offline || lines.length === 0} onClick={() => void send()}>{t("orders.send")}</Button>
      </Card>
      {myOrders.length > 0 && (
        <section aria-labelledby="my-orders" className="space-y-2">
          <h2 id="my-orders" className="text-xl font-bold">{t("orders.mine")}</h2>
          <ul className="space-y-2">
            {myOrders.map((o) => (
              <li key={o.id}>
                <Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`my-order-${o.id}`}>
                  <span><span className="tabular text-lg font-bold">{o.id}</span> <span className="text-text-muted">{ago(o.createdAt)}{o.customerName ? ` · ${o.customerName}` : ""}</span></span>
                  <span className="flex items-center gap-2">{statusBadge(o.status)}{o.status === "open" && <Button variant="ghost" aria-label={t("orders.cancel", { id: o.id })} onClick={() => void cancel(o)}>{t("orders.cancelShort")}</Button>}</span>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

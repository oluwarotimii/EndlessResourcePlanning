import { Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product, StockRequest } from "@erp/api-contract";
import { t } from "../i18n";
import { cacheCatalog, loadCachedCatalog } from "../features/till/catalog";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ScanBox } from "../ui/ScanBox";
import { StockStatusBadge } from "../ui/StockStatusBadge";

/**
 * H03. Pack and send stock. Pick a request, scan each item as it is packed, then send. The warehouse may send less than was
 * asked for. Works offline: the dispatch is queued with an idempotency key and sent when the connection returns.
 */
export function DispatchPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const { data, stale, failed, retry, update } = useCachedReport<{ requests: StockRequest[] }>("stock-requests", (tk) => api.stockRequests(tk));
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState<StockRequest | null>(null);
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  // The item list (for barcodes) comes from this device's saved catalogue, refreshed when online.
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

  const waiting = data?.requests.filter((r) => r.status === "requested") ?? [];
  const totalPicked = Object.values(picked).reduce((n, v) => n + v, 0);

  const start = (r: StockRequest) => { setOpen(r); setPicked({}); setMessage(null); setDone(false); };
  const bump = (productId: string, by: number, asked: number) => setPicked((p) => ({ ...p, [productId]: Math.min(asked, Math.max(0, (p[productId] ?? 0) + by)) }));

  const onCode = (code: string) => {
    if (!open) return;
    const product = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    const line = product && open.lines.find((l) => l.productId === product.id);
    if (!line) { setMessage(t("scan.unknown", { code })); return; }
    if ((picked[line.productId] ?? 0) >= line.qty) { setMessage(t("scan.full", { name: line.name })); return; }
    setMessage(null);
    bump(line.productId, 1, line.qty);
  };

  async function send() {
    if (!open || busy || totalPicked === 0) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const lines = open.lines.filter((l) => (picked[l.productId] ?? 0) > 0).map((l) => ({ productId: l.productId, qty: picked[l.productId]! }));
      await sync.enqueue({ id, type: "transfer.dispatch", recordKey: `request:${open.id}`, payload: { idempotencyKey: id, requestId: open.id, lines } });
      await update((d) => ({ requests: d.requests.map((r) => (r.id === open.id ? { ...r, status: "dispatched" as const } : r)) })); // never pack the same request twice
      setDone(true);
      setOpen(null);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("dispatch.title")}</h1>
        <p className="text-text-muted">{t("dispatch.subtitle")}</p>
        {stale && data && <p className="text-text-muted">{t("dispatch.saved")}</p>}
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {done && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("dispatch.sent")}</p>}

      {!open ? (
        <>
          {data && waiting.length === 0 && <p className="text-text-muted">{t("dispatch.none")}</p>}
          <ul className="space-y-3">
            {waiting.map((r) => (
              <li key={r.id}>
                <Card className="space-y-2 p-4" data-testid={`request-${r.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2"><p className="tabular font-bold">{r.id}</p><StockStatusBadge status={r.status} /></div>
                  <p className="text-text-muted">{t("stock.by", { name: r.requestedBy.name, time: ago(r.requestedAt) })}</p>
                  <ul className="tabular">{r.lines.map((l) => <li key={l.productId}>{l.qty} × {l.name}</li>)}</ul>
                  {r.note && <p className="text-text-muted">{r.note}</p>}
                  <Button till className="w-full" onClick={() => start(r)}>{t("dispatch.open")}</Button>
                </Card>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between"><p className="tabular text-xl font-bold">{open.id}</p><Button variant="ghost" onClick={() => setOpen(null)}>{t("dispatch.back")}</Button></div>
          <ScanBox onCode={onCode} autoFocusKey={open.id} />
          <p role="status" className="min-h-[1.5rem] font-medium text-danger-ink">{message}</p>
          <ul className="divide-y divide-border">
            {open.lines.map((l) => {
              const n = picked[l.productId] ?? 0;
              return (
                <li key={l.productId} className="flex items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.name}</p>
                    <p className="tabular text-text-muted">{t("dispatch.picked", { picked: n, asked: l.qty })}{n < l.qty && n > 0 ? ` · ${t("dispatch.short", { n: l.qty - n })}` : ""}</p>
                  </div>
                  <Button variant="subtle" icon disabled={n <= 0} aria-label={t("dispatch.less", { name: l.name })} onClick={() => bump(l.productId, -1, l.qty)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-8 text-center text-lg font-bold" aria-label={`${n} ${l.name}`}>{n}</span>
                  <Button variant="subtle" icon disabled={n >= l.qty} aria-label={t("dispatch.more", { name: l.name })} onClick={() => bump(l.productId, 1, l.qty)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
          <Button till className="w-full" disabled={busy || totalPicked === 0} onClick={() => void send()}>{t("dispatch.send", { n: totalPicked })}</Button>
        </Card>
      )}
    </div>
  );
}

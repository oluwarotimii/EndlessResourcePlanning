import { AlertTriangle, CheckCircle2, Minus, Plus } from "lucide-react";
import { useEffect, useState } from "react";
import type { Product, Transfer } from "@erp/api-contract";
import { t } from "../i18n";
import { cacheCatalog, loadCachedCatalog } from "../features/till/catalog";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { ScanBox } from "../ui/ScanBox";

/**
 * H04. Receive stock. Pick a transfer, scan each item as it comes out of the box, then confirm. Anything missing is flagged
 * against the transfer. Works offline: the count is queued with an idempotency key. The person who sent it cannot receive it.
 */
export function ReceiveTransferPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const { data, failed, retry, update } = useCachedReport<{ transfers: Transfer[] }>("transfers", (tk) => api.transfers(tk));
  const [products, setProducts] = useState<Product[]>([]);
  const [open, setOpen] = useState<Transfer | null>(null);
  const [counted, setCounted] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [flagged, setFlagged] = useState(false);
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

  const onTheWay = data?.transfers.filter((x) => x.status === "in_transit") ?? [];
  const recent = data?.transfers.filter((x) => x.status === "received").slice(0, 5) ?? [];
  const missing = open ? open.lines.reduce((n, l) => n + l.qtySent - (counted[l.productId] ?? 0), 0) : 0;

  const start = (x: Transfer) => { setOpen(x); setCounted({}); setNote(""); setMessage(null); setDone(false); };
  const bump = (productId: string, by: number, sent: number) => setCounted((c) => ({ ...c, [productId]: Math.min(sent, Math.max(0, (c[productId] ?? 0) + by)) }));

  const onCode = (code: string) => {
    if (!open) return;
    const product = products.find((p) => p.barcode === code || p.sku.toLowerCase() === code.toLowerCase());
    const line = product && open.lines.find((l) => l.productId === product.id);
    if (!line) { setMessage(t("scan.unknown", { code })); return; }
    if ((counted[line.productId] ?? 0) >= line.qtySent) { setMessage(t("scan.full", { name: line.name })); return; }
    setMessage(null);
    bump(line.productId, 1, line.qtySent);
  };

  async function confirm() {
    if (!open || busy) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const lines = open.lines.map((l) => ({ productId: l.productId, qty: counted[l.productId] ?? 0 })); // every line is counted, even as zero
      await sync.enqueue({ id, type: "transfer.receive", recordKey: `transfer:${open.id}`, payload: { idempotencyKey: id, transferId: open.id, lines, note: note.trim() || undefined } });
      await update((d) => ({
        transfers: d.transfers.map((x) => (x.id === open.id ? { ...x, status: "received" as const, shortage: missing, lines: x.lines.map((l) => ({ ...l, qtyReceived: counted[l.productId] ?? 0 })) } : x)),
      }));
      setFlagged(missing > 0);
      setDone(true);
      setOpen(null);
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("receive.title")}</h1>
        <p className="text-text-muted">{t("receive.subtitle")}</p>
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {done && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("receive.done")}{flagged && <span className="mt-1 block">{t("receive.shortFlagged")}</span>}</p>}

      {!open ? (
        <>
          {data && onTheWay.length === 0 && <p className="text-text-muted">{t("receive.none")}</p>}
          <ul className="space-y-3">
            {onTheWay.map((x) => (
              <li key={x.id}>
                <Card className="space-y-2 p-4" data-testid={`transfer-${x.id}`}>
                  <p className="tabular text-lg font-bold">{x.id}</p>
                  <p className="text-text-muted">{t("receive.from", { name: x.dispatchedBy.name, ago: ago(x.dispatchedAt) })}</p>
                  {x.fromBranch && <p className="text-text-muted">{t("stock.source", { name: x.fromBranch })}</p>}
                  <ul className="tabular">{x.lines.map((l) => <li key={l.productId}>{l.qtySent} × {l.name}</li>)}</ul>
                  <Button till className="w-full" onClick={() => start(x)}>{t("receive.open")}</Button>
                </Card>
              </li>
            ))}
          </ul>
          {recent.length > 0 && (
            <section aria-labelledby="recent" className="space-y-2">
              <h2 id="recent" className="text-xl font-bold">{t("receive.recent")}</h2>
              <ul className="space-y-2">
                {recent.map((x) => (
                  <li key={x.id}>
                    <Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`received-${x.id}`}>
                      <span className="tabular font-semibold">{x.id}</span>
                      {x.shortage > 0
                        ? <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-danger-subtle px-3 py-1 font-semibold text-danger-ink"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t("receive.shortage", { n: x.shortage })}</span>
                        : <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-success-subtle px-3 py-1 font-semibold text-success-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t("receive.complete")}</span>}
                    </Card>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      ) : (
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between"><p className="tabular text-xl font-bold">{open.id}</p><Button variant="ghost" onClick={() => setOpen(null)}>{t("receive.back")}</Button></div>
          <ScanBox onCode={onCode} autoFocusKey={open.id} />
          <p role="status" className="min-h-[1.5rem] font-medium text-danger-ink">{message}</p>
          <ul className="divide-y divide-border">
            {open.lines.map((l) => {
              const n = counted[l.productId] ?? 0;
              return (
                <li key={l.productId} className="flex items-center gap-2 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-semibold">{l.name}</p>
                    <p className="tabular text-text-muted">{t("receive.counted", { counted: n, sent: l.qtySent })}{n < l.qtySent ? ` · ${t("receive.short", { n: l.qtySent - n })}` : ""}</p>
                  </div>
                  <Button variant="subtle" icon disabled={n <= 0} aria-label={t("receive.less", { name: l.name })} onClick={() => bump(l.productId, -1, l.qtySent)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-8 text-center text-lg font-bold" aria-label={`${n} ${l.name}`}>{n}</span>
                  <Button variant="subtle" icon disabled={n >= l.qtySent} aria-label={t("receive.more", { name: l.name })} onClick={() => bump(l.productId, 1, l.qtySent)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
          <p role="status" className={`rounded-xl p-3 font-semibold tabular ${missing > 0 ? "bg-warning-subtle text-warning-ink" : "bg-success-subtle text-success-ink"}`} data-testid="missing">
            {missing > 0 ? t("receive.shortTotal", { n: missing }) : t("receive.allThere")}
          </p>
          <label className="block"><span className="font-semibold">{t("receive.note")}</span>
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
          </label>
          <Button till className="w-full" disabled={busy} onClick={() => void confirm()}>{t("receive.confirm")}</Button>
        </Card>
      )}
    </div>
  );
}

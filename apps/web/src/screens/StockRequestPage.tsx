import { Minus, Plus, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Product, StockLevel, StockRequest } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { t } from "../i18n";
import { cacheCatalog, loadCachedCatalog, search } from "../features/till/catalog";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { StockStatusBadge } from "../ui/StockStatusBadge";

/**
 * H02. Branch stock request: ask the warehouse, or a sister branch, for stock and follow the request. Needs a
 * connection. Picking a sister branch shows what it holds, so the request can be aimed at a branch likely to have it.
 */
export function StockRequestPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const offline = sync.state === "offline";
  const [products, setProducts] = useState<Product[]>([]);
  const [term, setTerm] = useState("");
  const [lines, setLines] = useState<Array<{ productId: string; name: string; qty: number }>>([]);
  const [note, setNote] = useState("");
  const [requests, setRequests] = useState<StockRequest[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [branches, setBranches] = useState<string[]>([]);
  /** "warehouse" or a sister branch's name. */
  const [source, setSource] = useState<string>("warehouse");
  const [levels, setLevels] = useState<StockLevel[] | null>(null);
  /** Kept across a failed attempt so a retry can never raise two requests. */
  const key = useRef("");

  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      const cached = await loadCachedCatalog(sync.storage);
      if (live && cached) setProducts(cached.products);
      if (offline) return;
      try {
        const fresh = await api.products(token);
        await cacheCatalog(sync.storage, fresh);
        if (live) setProducts(fresh.products);
      } catch { /* the cached list still works */ }
      try { const r = await api.stockRequests(token); if (live) setRequests(r.requests); }
      catch (e) { if (live) setError(e instanceof ApiFailure && e.code === "forbidden" ? t("stock.forbidden") : t("stock.loadFailed")); }
      try { const b = await api.branches(token); if (live) setBranches(b.branches); } catch { /* no sister branches to offer */ }
    })();
    return () => { live = false; };
  }, [api, token, sync.storage, offline]);

  // See what a chosen sister branch holds before asking it.
  useEffect(() => {
    if (!token || offline || source === "warehouse") { setLevels(null); return; }
    let live = true;
    void (async () => { try { const res = await api.stockLevels(token); if (live) setLevels(res.levels); } catch { /* not critical */ } })();
    return () => { live = false; };
  }, [api, token, offline, source]);
  const atSource = (productId: string) => (source === "warehouse" ? undefined : levels?.find((l) => l.productId === productId)?.branches[source]);

  const results = useMemo(() => (term.trim() ? search(products, term).slice(0, 6) : []), [products, term]);
  const edit = (next: typeof lines) => { setLines(next); key.current = ""; setSent(false); }; // any change is a new request

  const add = (p: Product) => {
    setTerm("");
    edit(lines.some((l) => l.productId === p.id) ? lines.map((l) => (l.productId === p.id ? { ...l, qty: l.qty + 1 } : l)) : [...lines, { productId: p.id, name: p.name, qty: 1 }]);
  };
  const setQty = (id: string, qty: number) => edit(qty <= 0 ? lines.filter((l) => l.productId !== id) : lines.map((l) => (l.productId === id ? { ...l, qty } : l)));

  const sourceLabel = (name?: string) => (!name || name === "warehouse" ? t("stock.warehouseLabel") : name);

  async function submit() {
    if (!token || busy || offline || lines.length === 0) return;
    setBusy(true); setError(null);
    try {
      key.current ||= crypto.randomUUID();
      const fromBranch = source === "warehouse" ? undefined : source;
      const res = await api.createStockRequest(token, { idempotencyKey: key.current, lines: lines.map(({ productId, qty }) => ({ productId, qty })), note: note.trim() || undefined, fromBranch });
      setRequests((list) => [res.request, ...(list ?? []).filter((r) => r.id !== res.request.id)]);
      setLines([]); setNote(""); key.current = ""; setSent(true);
    } catch (e) {
      setError(e instanceof ApiFailure ? (e.code === "unavailable" ? t("error.unavailable") : e.message) : t("error.generic"));
    } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("stock.title")}</h1>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("stock.offline")}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger-subtle p-4 font-medium text-danger-ink">{error}</p>}
      {sent && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("stock.sent", { to: sourceLabel(source) })}</p>}

      <Card className="space-y-4 p-5">
        {branches.length > 0 && (
          <div className="flex flex-wrap gap-2">
            <span className="sr-only">{t("stock.from")}</span>
            <Button till variant={source === "warehouse" ? "primary" : "subtle"} onClick={() => setSource("warehouse")}>{t("stock.warehouseOption")}</Button>
            {branches.map((b) => (
              <Button key={b} till variant={source === b ? "primary" : "subtle"} onClick={() => setSource(b)}>{b}</Button>
            ))}
          </div>
        )}
        <label className="relative block">
          <span className="sr-only">{t("stock.search")}</span>
          <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
          <input value={term} onChange={(e) => setTerm(e.target.value)} placeholder={t("stock.search")} autoComplete="off"
            className="min-h-till w-full rounded-xl border border-border-strong bg-surface-raised pl-12 pr-4 text-lg" />
        </label>
        {results.length > 0 && (
          <ul className="divide-y divide-border rounded-xl border border-border">
            {results.map((p) => {
              const n = atSource(p.id);
              return (
                <li key={p.id}>
                  <button onClick={() => add(p)} className="btn-spring flex min-h-touch w-full items-center justify-between gap-2 px-3 text-left hover:bg-fill">
                    <span>{p.name}</span>
                    {n !== undefined && <span className="tabular text-text-muted">{t("stock.atBranch", { n, name: source })}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {lines.length === 0 ? <p className="text-text-muted">{t("stock.empty")}</p> : (
          <ul className="divide-y divide-border">
            {lines.map((l) => {
              const n = atSource(l.productId);
              return (
                <li key={l.productId} className="flex items-center gap-2 py-2">
                  <span className="min-w-0 flex-1 truncate font-semibold">{l.name}</span>
                  {n !== undefined && <span className="tabular text-text-muted">{t("stock.atBranch", { n, name: source })}</span>}
                  <Button variant="subtle" icon aria-label={t("stock.less", { name: l.name })} onClick={() => setQty(l.productId, l.qty - 1)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <span className="tabular w-10 text-center text-lg font-bold" aria-label={t("stock.qty", { name: l.name, n: l.qty })}>{l.qty}</span>
                  <Button variant="subtle" icon aria-label={t("stock.more", { name: l.name })} onClick={() => setQty(l.productId, l.qty + 1)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                  <Button variant="ghost" icon aria-label={t("stock.remove", { name: l.name })} onClick={() => setQty(l.productId, 0)}><Trash2 className="h-5 w-5" aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
        )}
        <label className="block"><span className="font-semibold">{t("stock.note", { to: sourceLabel(source) })}</span>
          <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
        </label>
        <Button till className="w-full" disabled={busy || offline || lines.length === 0} onClick={() => void submit()}>{t("stock.submit")}</Button>
      </Card>

      <section aria-labelledby="mine" className="space-y-2">
        <h2 id="mine" className="text-xl font-bold">{t("stock.list")}</h2>
        {requests?.length === 0 && <p className="text-text-muted">{t("stock.none")}</p>}
        <ul className="space-y-3">
          {requests?.map((r) => (
            <li key={r.id}>
              <Card className="p-4" data-testid={`request-${r.id}`}>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="tabular font-bold">{r.id}</p>
                  <StockStatusBadge status={r.status} />
                </div>
                <p className="text-text-muted">{t("stock.by", { name: r.requestedBy.name, time: new Date(r.requestedAt).toLocaleString() })}</p>
                {r.fromBranch && <p className="text-text-muted">{t("stock.source", { name: r.fromBranch })}</p>}
                <ul className="tabular mt-1">{r.lines.map((l) => <li key={l.productId}>{l.qty} × {l.name}</li>)}</ul>
                {r.note && <p className="mt-1 text-text-muted">{r.note}</p>}
              </Card>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

import { Minus, Plus } from "lucide-react";
import { useMemo, useState } from "react";
import type { CountLocation, CountSheet, StockCount } from "@erp/api-contract";
import { t } from "../i18n";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { CountStatusBadge } from "../ui/CountStatusBadge";
import { ScanBox } from "../ui/ScanBox";

type Item = CountSheet["items"][number];

/**
 * K01. Physical stock count. A blind count: the sheet has no system quantities. Count by scanning or typing, finish, and
 * anything that differs comes back for a recount by a different person (a setting). Works offline: the count is queued.
 */
export function CountPage() {
  const { api, caps } = useSession();
  const sync = useSync();
  const tenant = useTenant();
  const list = useCachedReport<{ counts: StockCount[] }>("counts", (tk) => api.counts(tk));
  const [location, setLocation] = useState<CountLocation>("branch");
  const [mode, setMode] = useState<"list" | "count" | "recount">("list");
  const [recounting, setRecounting] = useState<StockCount | null>(null);
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const sheet = useCachedReport<CountSheet>(`count-sheet:${location}`, (tk) => api.countSheet(tk, location));

  const items: Item[] = useMemo(() => {
    const all = sheet.data?.items ?? [];
    if (mode === "recount" && recounting) return recounting.lines.filter((l) => l.needsRecount).map((l) => all.find((i) => i.productId === l.productId) ?? { productId: l.productId, name: l.name, sku: "", barcode: "" });
    const needle = search.trim().toLowerCase();
    return needle ? all.filter((i) => i.name.toLowerCase().includes(needle) || i.sku.toLowerCase().includes(needle)) : all;
  }, [sheet.data, mode, recounting, search]);
  const totalItems = mode === "recount" && recounting ? items.length : sheet.data?.items.length ?? 0;
  const touched = Object.keys(quantities).length;

  const reset = () => { setMode("list"); setRecounting(null); setQuantities({}); setNote(""); setSearch(""); setMessage(null); };
  const set = (id: string, qty: number) => setQuantities((q) => ({ ...q, [id]: Math.max(0, qty) }));

  const onCode = (code: string) => {
    const hit = items.find((i) => i.barcode === code || i.sku.toLowerCase() === code.toLowerCase());
    if (!hit) { setMessage(t("scan.unknown", { code })); return; }
    setMessage(null);
    set(hit.productId, (quantities[hit.productId] ?? 0) + 1);
  };

  async function finish() {
    if (busy || touched === 0) return;
    setBusy(true);
    try {
      const id = crypto.randomUUID();
      const lines = Object.entries(quantities).map(([productId, counted]) => ({ productId, counted }));
      await sync.enqueue({
        id, type: "count.submit", recordKey: recounting ? `count:${recounting.id}` : `count:${id}`,
        payload: { idempotencyKey: id, location: recounting?.location ?? location, countId: recounting?.id, lines, countedAt: new Date().toISOString(), note: note.trim() || undefined },
      });
      if (recounting) await list.update((d) => ({ counts: d.counts.map((c) => (c.id === recounting.id ? { ...c, status: "closed" as const, lines: c.lines.map((l) => ({ ...l, needsRecount: false })) } : c)) })); // do not offer the same recount twice
      setSaved(true); reset();
    } finally { setBusy(false); }
  }

  const header = (
    <div>
      <h1 className="text-3xl font-bold tracking-tight">{t("count.title")}</h1>
      <p className="text-text-muted">{t("count.subtitle")}</p>
    </div>
  );

  if (mode !== "list") {
    return (
      <div className="mx-auto max-w-3xl space-y-4">
        {header}
        <Card className="space-y-4 p-5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xl font-bold">{mode === "recount" ? t("count.recount.title") : t(`count.${location}`)}</p>
            <Button variant="ghost" onClick={reset}>{t("count.back")}</Button>
          </div>
          {mode === "recount" && <p className="text-text-muted">{t("count.recount.body")}</p>}
          {sheet.failed && !sheet.data && <p role="alert" className="rounded-xl bg-danger-subtle p-3 text-danger-ink">{t("count.sheetFailed")}</p>}
          <ScanBox onCode={onCode} autoFocusKey={mode} />
          <p role="status" className="min-h-[1.5rem] font-medium text-danger-ink">{message}</p>
          {mode === "count" && (
            <label className="block"><span className="sr-only">{t("lookup.search")}</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("lookup.search")} className="min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
            </label>
          )}
          <p className="tabular font-semibold" data-testid="progress">{t("count.counted", { n: touched, total: totalItems })}</p>
          <ul className="divide-y divide-border">
            {items.map((i) => {
              const n = quantities[i.productId];
              return (
                <li key={i.productId} className="flex items-center gap-2 py-2">
                  <div className="min-w-0 flex-1"><p className="truncate font-semibold">{i.name}</p>{n === undefined && <p className="text-text-muted">{t("count.notCounted")}</p>}</div>
                  <Button variant="subtle" icon disabled={!n} aria-label={t("count.less", { name: i.name })} onClick={() => set(i.productId, (n ?? 0) - 1)}><Minus className="h-5 w-5" aria-hidden="true" /></Button>
                  <input
                    aria-label={t("count.item", { name: i.name })} inputMode="numeric" value={n === undefined ? "" : String(n)} placeholder="–"
                    onChange={(e) => { const v = e.target.value.replace(/\D/g, ""); setQuantities((q) => { if (v === "") { const { [i.productId]: _drop, ...rest } = q; return rest; } return { ...q, [i.productId]: Number(v) }; }); }}
                    className="tabular min-h-touch w-20 rounded-xl border border-border-strong bg-surface-raised px-2 text-center text-lg font-bold"
                  />
                  <Button variant="subtle" icon aria-label={t("count.more", { name: i.name })} onClick={() => set(i.productId, (n ?? 0) + 1)}><Plus className="h-5 w-5" aria-hidden="true" /></Button>
                </li>
              );
            })}
          </ul>
          <label className="block"><span className="font-semibold">{t("count.note")}</span>
            <input value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3" />
          </label>
          <Button till className="w-full" disabled={busy || touched === 0} onClick={() => void finish()}>{t(mode === "recount" ? "count.recount.finish" : "count.finish")}</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      {header}
      {saved && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("count.saved")}</p>}
      <Card className="space-y-3 p-5">
        <p className="text-xl font-bold">{t("count.start")}</p>
        <label className="block"><span className="font-semibold">{t("count.where")}</span>
          <select value={location} onChange={(e) => setLocation(e.target.value as CountLocation)} className="mt-1 min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3 text-lg">
            <option value="branch">{t("count.branch")}</option>
            <option value="warehouse">{t("count.warehouse")}</option>
          </select>
        </label>
        <Button till className="w-full" onClick={() => { setSaved(false); setMode("count"); }}>{t("count.begin")}</Button>
      </Card>

      <section aria-labelledby="counts" className="space-y-2">
        <h2 id="counts" className="text-xl font-bold">{t("count.mine")}</h2>
        {list.data?.counts.length === 0 && <p className="text-text-muted">{t("count.none")}</p>}
        <ul className="space-y-3">
          {list.data?.counts.map((c) => {
            const mustBeSomeoneElse = tenant.stock.recountByDifferentPerson && c.countedBy.id === caps?.user.id;
            return (
              <li key={c.id}>
                <Card className="space-y-2 p-4" data-testid={`count-${c.id}`}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="tabular font-bold">{c.id} · {t(`count.${c.location}`)} · {t("count.round", { n: c.round })}</p>
                    <CountStatusBadge status={c.status} />
                  </div>
                  <p className="text-text-muted">{t("count.by", { name: c.countedBy.name, time: ago(c.countedAt) })}</p>
                  {c.status === "needs_recount" && (
                    mustBeSomeoneElse
                      ? <p className="font-medium text-warning-ink">{t("count.recount.other")}</p>
                      : <Button till className="w-full" onClick={() => { setRecounting(c); setQuantities({}); setMessage(null); setMode("recount"); }}>{t("count.recount")}</Button>
                  )}
                </Card>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}

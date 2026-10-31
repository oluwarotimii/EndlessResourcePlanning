import { AlertTriangle, Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { StockLevel } from "@erp/api-contract";
import { t } from "../i18n";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Card } from "../ui/Card";

const LOW = 5;

/** H05. Stock lookup: how many are on the shelf and in the warehouse. Opens offline from the last saved list. */
export function StockLookupPage() {
  const { api, token, caps } = useSession();
  const { storage, state } = useSync();
  const [q, setQ] = useState("");
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [stale, setStale] = useState(false);
  const cacheKey = `stock-levels:${caps?.user.id ?? ""}`;

  useEffect(() => {
    if (!token) return;
    let live = true;
    void (async () => {
      const saved = (await storage.kv.get<StockLevel[]>(cacheKey)) ?? [];
      const needle = q.trim().toLowerCase();
      const fromSaved = () => saved.filter((l) => !needle || l.name.toLowerCase().includes(needle) || l.sku.toLowerCase().includes(needle) || l.barcode.includes(needle));
      if (state === "offline") { if (live) { setLevels(fromSaved()); setStale(true); } return; }
      try {
        const res = await api.stockLevels(token, q);
        if (!q) await storage.kv.set(cacheKey, res.levels); // remember the full list for offline
        if (live) { setLevels(res.levels); setStale(false); }
      } catch { if (live) { setLevels(fromSaved()); setStale(true); } }
    })();
    return () => { live = false; };
  }, [api, token, storage, cacheKey, q, state]);

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("lookup.title")}</h1>
      <label className="relative block">
        <span className="sr-only">{t("lookup.search")}</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("lookup.search")} autoComplete="off" className="min-h-till w-full rounded-xl border border-border-strong bg-surface-raised pl-12 pr-4 text-lg" />
      </label>
      {stale && <p className="text-text-muted">{t("till.customerStale")}</p>}
      {levels.length === 0 && <p className="text-text-muted">{t("lookup.none")}</p>}
      <ul className="space-y-2">
        {levels.map((l) => (
          <li key={l.productId}>
            <Card className="flex flex-wrap items-center gap-x-6 gap-y-1 p-4" data-testid={`level-${l.productId}`}>
              <div className="min-w-0 flex-1"><p className="font-semibold">{l.name}</p><p className="tabular text-text-muted">{l.sku}</p></div>
              <p><span className="text-text-muted">{t("lookup.shelf")} </span><span className="tabular font-bold">{l.branch}</span></p>
              <p><span className="text-text-muted">{t("lookup.warehouse")} </span><span className="tabular font-bold">{l.warehouse}</span></p>
              {l.branch <= LOW && <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-warning-subtle px-3 py-1 font-semibold text-warning-ink"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t("lookup.low")}</span>}
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

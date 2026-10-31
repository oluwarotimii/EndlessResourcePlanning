import { Search } from "lucide-react";
import { useEffect, useState } from "react";
import type { Customer } from "@erp/api-contract";
import { t } from "../i18n";
import { availableCredit, searchCustomers } from "../features/till/customers";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney } from "../state/tenant";
import { Card } from "../ui/Card";

export function CustomerLookupPage() {
  const { api, token } = useSession();
  const { state, storage } = useSync();
  const money = useMoney();
  const [q, setQ] = useState("");
  const [list, setList] = useState<Customer[]>([]);
  const [stale, setStale] = useState(false);
  useEffect(() => {
    if (!token) return;
    let live = true;
    searchCustomers(api, token, storage, q, state !== "offline").then((r) => { if (live) { setList(r.customers); setStale(r.fromCache); } });
    return () => { live = false; };
  }, [api, token, storage, q, state === "offline"]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("customers.title")}</h1>
      <label className="relative block max-w-xl">
        <span className="sr-only">{t("till.customerSearch")}</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("till.customerSearch")} className="min-h-till w-full rounded-xl border border-border-strong bg-surface-raised pl-12 pr-4 text-lg" />
      </label>
      {stale && <p className="text-text-muted">{t("till.customerStale")}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {list.map((c) => <li key={c.id}><Card className="p-4"><p className="text-lg font-semibold">{c.name}</p><p className="tabular text-text-muted">{c.phone}</p><p className="tabular">{availableCredit(c) === undefined ? t("customers.noCredit") : t("customers.credit", { available: money(availableCredit(c) ?? 0), limit: money(c.creditLimit ?? 0) })}</p></Card></li>)}
      </ul>
    </div>
  );
}

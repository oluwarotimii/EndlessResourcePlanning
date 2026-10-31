import { useState } from "react";
import type { DeliveryOrder } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/** L04. The rider hands in the cash collected on delivery. A manager confirms they received it. Needs a connection. */
export function RiderCashPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const money = useMoney();
  const offline = sync.state === "offline";
  const { data, update } = useCachedReport<{ orders: DeliveryOrder[] }>("delivery-orders", (tk) => api.deliveryOrders(tk));
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [keyRef] = useState({ key: "", ids: "" }); // the same key while the same orders are being handed in

  const cod = (data?.orders ?? []).filter((o) => o.status === "delivered" && o.payment === "cash_on_delivery");
  const ready = cod.filter((o) => !o.remitted && !o.remittanceId);
  const waiting = cod.filter((o) => !o.remitted && o.remittanceId);
  const chosen = ready.filter((o) => !unticked.has(o.id));
  const total = chosen.reduce((n, o) => n + (o.cashCollected ?? 0), 0);

  async function submit() {
    if (!token || busy || offline || chosen.length === 0) return;
    setBusy(true); setError(null);
    try {
      const ids = chosen.map((o) => o.id).sort().join(",");
      if (keyRef.ids !== ids) { keyRef.ids = ids; keyRef.key = crypto.randomUUID(); }
      const res = await api.remitCash(token, { idempotencyKey: keyRef.key, orderIds: chosen.map((o) => o.id) });
      await update((d) => ({ orders: d.orders.map((o) => (chosen.some((c) => c.id === o.id) ? { ...o, remittanceId: res.approval.id } : o)) }));
      setSent(true);
    } catch (e) { setError(e instanceof ApiFailure ? (e.code === "unavailable" ? t("error.unavailable") : e.message) : t("error.generic")); } finally { setBusy(false); }
  }

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div><h1 className="text-3xl font-bold tracking-tight">{t("deliv.cash.title")}</h1><p className="text-text-muted">{t("deliv.cash.subtitle")}</p></div>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("deliv.cash.offline")}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger-subtle p-4 font-medium text-danger-ink">{error}</p>}
      {sent && <p role="status" className="rounded-xl bg-success-subtle p-4 font-semibold text-success-ink">{t("deliv.cash.sent")}</p>}
      {data && ready.length === 0 && waiting.length === 0 && <p className="text-text-muted">{t("deliv.cash.none")}</p>}

      {ready.length > 0 && (
        <Card className="space-y-3 p-4">
          <ul className="divide-y divide-border">
            {ready.map((o) => (
              <li key={o.id}>
                <label className="flex min-h-touch items-center gap-3 py-2">
                  <input type="checkbox" className="h-6 w-6" checked={!unticked.has(o.id)} onChange={() => setUnticked((u) => { const n = new Set(u); n.has(o.id) ? n.delete(o.id) : n.add(o.id); return n; })} />
                  <span className="min-w-0 flex-1"><span className="tabular block font-semibold">{o.id} · {o.customerName}</span></span>
                  <span className="tabular font-bold">{money(o.cashCollected ?? 0)}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="flex justify-between border-t border-border-strong pt-3 text-2xl font-bold"><span>{t("deliv.cash.total")}</span><span className="tabular" data-testid="cash-total">{money(total)}</span></p>
          <Button till className="w-full" disabled={busy || offline || chosen.length === 0} onClick={() => void submit()}>{t("deliv.cash.submit", { amount: money(total) })}</Button>
        </Card>
      )}

      {waiting.length > 0 && (
        <section aria-labelledby="waiting" className="space-y-2">
          <h2 id="waiting" className="text-xl font-bold">{t("deliv.cash.waiting")}</h2>
          <ul className="space-y-2">{waiting.map((o) => <li key={o.id}><Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`waiting-${o.id}`}><span className="tabular font-semibold">{o.id} · {o.customerName}</span><span className="tabular font-bold">{money(o.cashCollected ?? 0)}</span></Card></li>)}</ul>
        </section>
      )}
    </div>
  );
}

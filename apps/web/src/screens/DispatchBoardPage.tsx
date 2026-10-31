import { useEffect, useState } from "react";
import type { DeliveryOrder } from "@erp/api-contract";
import { ApiFailure } from "../api/client";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DeliveryStatusBadge, PaymentBadge, itemsText } from "../ui/DeliveryBadges";

/** L01. Dispatch board: give each order to a rider. Failed deliveries come back to be assigned again. Needs a connection to assign. */
export function DispatchBoardPage() {
  const { api, token } = useSession();
  const sync = useSync();
  const offline = sync.state === "offline";
  const { data, failed, retry, update } = useCachedReport<{ orders: DeliveryOrder[] }>("delivery-orders", (tk) => api.deliveryOrders(tk));
  const [riders, setRiders] = useState<Array<{ id: string; name: string }>>([]);
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [keys] = useState(() => new Map<string, string>()); // one key per order and rider, kept across a failed attempt

  useEffect(() => { if (token && !offline) api.riders(token).then((r) => setRiders(r.riders)).catch(() => undefined); }, [api, token, offline]);

  async function assign(o: DeliveryOrder) {
    const riderId = chosen[o.id];
    if (!token || !riderId || busy || offline) return;
    setBusy(o.id); setError(null);
    try {
      const slot = `${o.id}:${riderId}`;
      let key = keys.get(slot);
      if (!key) { key = crypto.randomUUID(); keys.set(slot, key); }
      const res = await api.assignDelivery(token, o.id, { idempotencyKey: key, riderId });
      await update((d) => ({ orders: d.orders.map((x) => (x.id === o.id ? res.order : x)) }));
    } catch (e) { setError(e instanceof ApiFailure ? (e.code === "unavailable" ? t("error.unavailable") : e.message) : t("error.generic")); } finally { setBusy(null); }
  }

  const all = data?.orders ?? [];
  const toAssign = all.filter((o) => o.status === "pending" || o.status === "failed");
  const out = all.filter((o) => o.status === "assigned");
  const done = all.filter((o) => o.status === "delivered");

  const column = (title: string, list: DeliveryOrder[], withAssign = false) => (
    <section aria-label={title} className="space-y-3">
      <h2 className="text-xl font-bold">{title} <span className="tabular text-text-muted">({list.length})</span></h2>
      {list.length === 0 && <p className="text-text-muted">{t("deliv.board.none")}</p>}
      <ul className="space-y-3">
        {list.map((o) => (
          <li key={o.id}>
            <Card className="space-y-2 p-4" data-testid={`order-${o.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="tabular font-bold">{o.id}</p><DeliveryStatusBadge status={o.status} /></div>
              <p className="font-semibold">{o.customerName}</p>
              <p className="text-text-muted">{o.address}</p>
              <p className="tabular">{itemsText(o)}</p>
              <PaymentBadge order={o} />
              {o.status === "failed" && <p className="font-medium text-danger-ink">{t("deliv.board.failedBecause", { reason: o.failedReason ?? "" })}</p>}
              {o.riderName && o.status !== "failed" && <p className="text-text-muted">{t("deliv.by", { name: o.riderName })}</p>}
              {withAssign && (
                <div className="flex flex-wrap gap-2 pt-1">
                  <label className="min-w-0 flex-1"><span className="sr-only">{t("deliv.board.chooseRider")}</span>
                    <select value={chosen[o.id] ?? ""} onChange={(e) => setChosen((c) => ({ ...c, [o.id]: e.target.value }))} className="min-h-touch w-full rounded-xl border border-border-strong bg-surface-raised px-3">
                      <option value="">{t("deliv.board.chooseRider")}</option>
                      {riders.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </label>
                  <Button disabled={!chosen[o.id] || busy === o.id || offline} onClick={() => void assign(o)}>{t("deliv.board.assign")}</Button>
                </div>
              )}
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("deliv.board.title")}</h1>
        <p className="text-text-muted">{t("deliv.board.subtitle")}</p>
      </div>
      {offline && <p role="status" className="rounded-xl bg-warning-subtle p-4 font-medium text-warning-ink">{t("deliv.board.offline")}</p>}
      {error && <p role="alert" className="rounded-xl bg-danger-subtle p-4 font-medium text-danger-ink">{error}</p>}
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      <div className="grid gap-6 lg:grid-cols-3">
        {column(t("deliv.board.toAssign"), toAssign, true)}
        {column(t("deliv.board.out"), out)}
        {column(t("deliv.board.done"), done)}
      </div>
    </div>
  );
}

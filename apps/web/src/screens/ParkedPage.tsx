import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n";
import { computeTotals, type SalesOrder } from "@erp/api-contract";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { cartSubtotal, itemCount, type Cart } from "../features/till/cart";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface Parked { id: string; savedAt: string; cart: Cart }

export function ParkedPage() {
  const { caps, api, token } = useSession();
  const { storage } = useSync();
  const money = useMoney();
  const tenant = useTenant();
  const navigate = useNavigate();
  const userId = caps?.user.id ?? "";
  const [list, setList] = useState<Parked[] | null>(null);
  const [blocked, setBlocked] = useState(false);
  const orders = useCachedReport<{ orders: SalesOrder[] }>("orders", (tk) => api.orders(tk));
  const waiting = orders.data?.orders.filter((o) => o.status === "open") ?? [];

  const load = useCallback(async () => {
    setList((await storage.kv.list<Parked>(`parked:${userId}:`)).sort((a, b) => b.savedAt.localeCompare(a.savedAt)));
  }, [storage, userId]);
  useEffect(() => { void load(); }, [load]);

  async function resume(p: Parked) {
    const active = await storage.kv.get<Cart>(`cart:${userId}`);
    if (active && active.lines.length > 0) { setBlocked(true); return; } // never overwrite a sale in progress
    await storage.kv.set(`cart:${userId}`, p.cart);
    await storage.kv.delete(`parked:${userId}:${p.id}`);
    navigate("/s/S01");
  }
  /** Pick up an order from the floor: its lines and customer go into the till, ready to pay. Nothing to retype. */
  async function take(o: SalesOrder) {
    const active = await storage.kv.get<Cart>(`cart:${userId}`);
    if (active && active.lines.length > 0) { setBlocked(true); return; }
    let customer: Cart["customer"];
    if (o.customerId && token) {
      const found = await api.customers(token, o.customerName ?? "").then((r) => r.customers.find((c) => c.id === o.customerId)).catch(() => undefined);
      customer = found ? { id: found.id, name: found.name, creditLimit: found.creditLimit, balance: found.balance } : { id: o.customerId, name: o.customerName ?? "" };
    }
    await storage.kv.set(`cart:${userId}`, { lines: o.lines.map(({ productId, name, unitPrice, qty }) => ({ productId, name, unitPrice, qty })), customer, orderId: o.id } satisfies Cart);
    navigate("/s/S01");
  }
  async function remove(p: Parked) { await storage.kv.delete(`parked:${userId}:${p.id}`); await load(); }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("parked.title")}</h1>
      {blocked && <p role="alert" className="rounded-xl bg-warning-subtle p-4 font-semibold text-warning-ink">{t("parked.blocked")}</p>}
      <section aria-labelledby="floor-orders" className="space-y-3">
        <h2 id="floor-orders" className="text-xl font-bold">{t("orders.waiting")}</h2>
        {orders.data && waiting.length === 0 && <p className="text-text-muted">{t("orders.none")}</p>}
        <ul className="grid gap-3 md:grid-cols-2">
          {waiting.map((o) => (
            <li key={o.id}>
              <Card className="p-4" data-testid={`order-${o.id}`}>
                <p className="flex items-baseline justify-between gap-2"><span className="tabular text-xl font-bold">{o.id}</span><span className="tabular text-xl font-bold">{money(computeTotals(o.lines.reduce((n, l) => n + l.unitPrice * l.qty, 0), tenant.tax.mode, tenant.tax.vatRate).total)}</span></p>
                <p className="text-text-muted">{t("orders.by", { name: o.createdBy.name })} · {ago(o.createdAt)}{o.customerName ? ` · ${o.customerName}` : ""}</p>
                <ul className="tabular mt-1">{o.lines.map((l) => <li key={l.productId}>{l.qty} × {l.name}</li>)}</ul>
                {o.note && <p className="mt-1 text-text-muted">{o.note}</p>}
                <Button till className="mt-3 w-full" onClick={() => void take(o)}>{t("orders.take")}</Button>
              </Card>
            </li>
          ))}
        </ul>
      </section>
      <h2 className="text-xl font-bold">{t("parked.heading")}</h2>
      {list?.length === 0 && <p className="text-text-muted">{t("parked.none")}</p>}
      <ul className="grid gap-3 md:grid-cols-2">
        {list?.map((p) => (
          <li key={p.id}>
            <Card className="p-4">
              <p className="tabular text-xl font-bold">{money(computeTotals(cartSubtotal(p.cart), tenant.tax.mode, tenant.tax.vatRate).total)}</p>
              <p className="text-text-muted">{t("till.items", { n: itemCount(p.cart) })} · {new Date(p.savedAt).toLocaleTimeString()}{p.cart.customer ? ` · ${p.cart.customer.name}` : ""}</p>
              <p className="truncate text-text-muted">{p.cart.lines.map((l) => l.name).join(", ")}</p>
              <div className="mt-3 flex gap-2">
                <Button till onClick={() => void resume(p)}>{t("parked.resume")}</Button>
                <Button till variant="ghost" onClick={() => void remove(p)}>{t("parked.delete")}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}

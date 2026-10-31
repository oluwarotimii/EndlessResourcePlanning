import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../i18n";
import { computeTotals } from "@erp/api-contract";
import { cartSubtotal, itemCount, type Cart } from "../features/till/cart";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney, useTenant } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

interface Parked { id: string; savedAt: string; cart: Cart }

export function ParkedPage() {
  const { caps } = useSession();
  const { storage } = useSync();
  const money = useMoney();
  const tenant = useTenant();
  const navigate = useNavigate();
  const userId = caps?.user.id ?? "";
  const [list, setList] = useState<Parked[] | null>(null);
  const [blocked, setBlocked] = useState(false);

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
  async function remove(p: Parked) { await storage.kv.delete(`parked:${userId}:${p.id}`); await load(); }

  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("parked.title")}</h1>
      {blocked && <p role="alert" className="rounded-xl bg-warning-subtle p-4 font-semibold text-warning-ink">{t("parked.blocked")}</p>}
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

import { Phone } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import type { DeliveryOrder } from "@erp/api-contract";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { DeliveryStatusBadge, PaymentBadge, itemsText } from "../ui/DeliveryBadges";

/** L02. The rider's deliveries on a phone. Only their own. Opens offline from the saved list. */
export function RiderDeliveriesPage() {
  const { api } = useSession();
  const navigate = useNavigate();
  const { data, failed, retry } = useCachedReport<{ orders: DeliveryOrder[] }>("delivery-orders", (tk) => api.deliveryOrders(tk));
  const todo = data?.orders.filter((o) => o.status === "assigned") ?? [];
  const finished = data?.orders.filter((o) => o.status === "delivered" || o.status === "failed") ?? [];
  const cashWaiting = data?.orders.some((o) => o.status === "delivered" && o.payment === "cash_on_delivery" && !o.remitted && !o.remittanceId) ?? false;

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{t("deliv.mine.title")}</h1>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t("report.loadFailed")}</span><Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>
        </div>
      )}
      {data && todo.length === 0 && <p className="text-text-muted">{t("deliv.mine.none")}</p>}
      <ul className="space-y-3">
        {todo.map((o) => (
          <li key={o.id}>
            <Card className="space-y-2 p-4" data-testid={`order-${o.id}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><p className="tabular text-lg font-bold">{o.id}</p><DeliveryStatusBadge status={o.status} /></div>
              <p className="text-lg font-semibold">{o.customerName}</p>
              <p>{o.address}</p>
              <p className="tabular text-text-muted">{itemsText(o)}</p>
              <PaymentBadge order={o} />
              <div className="grid grid-cols-2 gap-2 pt-1">
                <a href={`tel:${o.phone.replace(/\s/g, "")}`} className="btn-spring inline-flex min-h-till items-center justify-center gap-2 rounded-xl border border-border bg-fill px-3 font-semibold hover:bg-fill-hover"><Phone className="h-5 w-5" aria-hidden="true" />{t("deliv.mine.call", { name: o.customerName.split(" ")[0] ?? "" })}</a>
                <Button till onClick={() => navigate(`/s/L03?order=${o.id}`)}>{t("deliv.mine.deliver")}</Button>
              </div>
            </Card>
          </li>
        ))}
      </ul>
      {cashWaiting && <Link to="/s/L04" className="btn-spring inline-flex min-h-till w-full items-center justify-center rounded-xl bg-primary px-5 font-semibold text-primary-text hover:bg-primary-hover">{t("deliv.mine.cash")}</Link>}
      {finished.length > 0 && (
        <section aria-labelledby="done" className="space-y-2">
          <h2 id="done" className="text-xl font-bold">{t("deliv.mine.done")}</h2>
          <ul className="space-y-2">{finished.map((o) => <li key={o.id}><Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`order-${o.id}`}><span className="tabular font-semibold">{o.id} · {o.customerName}</span><DeliveryStatusBadge status={o.status} /></Card></li>)}</ul>
        </section>
      )}
    </div>
  );
}

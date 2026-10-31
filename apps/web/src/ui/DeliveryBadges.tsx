import { CheckCircle2, Clock, Truck, XCircle, type LucideIcon } from "lucide-react";
import type { DeliveryOrder, DeliveryStatus } from "@erp/api-contract";
import { t, type TextKey } from "../i18n";
import { useMoney } from "../state/tenant";

/** Status is always icon + word + colour. */
const MAP: Record<DeliveryStatus, { icon: LucideIcon; tone: string; key: TextKey }> = {
  pending: { icon: Clock, tone: "bg-info-subtle text-info-ink", key: "deliv.status.pending" },
  assigned: { icon: Truck, tone: "bg-warning-subtle text-warning-ink", key: "deliv.status.assigned" },
  delivered: { icon: CheckCircle2, tone: "bg-success-subtle text-success-ink", key: "deliv.status.delivered" },
  failed: { icon: XCircle, tone: "bg-danger-subtle text-danger-ink", key: "deliv.status.failed" },
};

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
  const { icon: Icon, tone, key } = MAP[status];
  return <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" />{t(key)}</span>;
}

/** Tells the rider at a glance whether to collect cash. */
export function PaymentBadge({ order }: { order: Pick<DeliveryOrder, "payment" | "amountDue"> }) {
  const money = useMoney();
  return order.payment === "cash_on_delivery"
    ? <span className="tabular inline-flex rounded-full border border-border bg-warning-subtle px-3 py-1 font-bold text-warning-ink">{t("deliv.collect", { amount: money(order.amountDue) })}</span>
    : <span className="inline-flex rounded-full border border-border bg-success-subtle px-3 py-1 font-semibold text-success-ink">{t("deliv.paid")}</span>;
}

export const itemsText = (o: Pick<DeliveryOrder, "items">) => o.items.map((i) => `${i.qty} × ${i.name}`).join(", ");

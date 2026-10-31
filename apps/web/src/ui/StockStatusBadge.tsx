import { CheckCircle2, Clock, Truck, XCircle, type LucideIcon } from "lucide-react";
import type { StockRequestStatus } from "@erp/api-contract";
import { t, type TextKey } from "../i18n";

/** Status is always icon + word + colour. */
const MAP: Record<StockRequestStatus, { icon: LucideIcon; tone: string; key: TextKey }> = {
  requested: { icon: Clock, tone: "bg-info-subtle text-info-ink", key: "stock.status.requested" },
  dispatched: { icon: Truck, tone: "bg-warning-subtle text-warning-ink", key: "stock.status.dispatched" },
  received: { icon: CheckCircle2, tone: "bg-success-subtle text-success-ink", key: "stock.status.received" },
  cancelled: { icon: XCircle, tone: "bg-danger-subtle text-danger-ink", key: "stock.status.cancelled" },
};

export function StockStatusBadge({ status }: { status: StockRequestStatus }) {
  const { icon: Icon, tone, key } = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold ${tone}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />{t(key)}
    </span>
  );
}

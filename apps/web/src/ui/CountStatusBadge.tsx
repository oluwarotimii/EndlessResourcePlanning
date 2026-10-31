import { AlertTriangle, CheckCircle2, ClipboardList, Clock, type LucideIcon } from "lucide-react";
import type { CountStatus } from "@erp/api-contract";
import { t, type TextKey } from "../i18n";

/** Status is always icon + word + colour. */
const MAP: Record<CountStatus, { icon: LucideIcon; tone: string; key: TextKey }> = {
  needs_recount: { icon: AlertTriangle, tone: "bg-warning-subtle text-warning-ink", key: "count.status.needs_recount" },
  review: { icon: ClipboardList, tone: "bg-info-subtle text-info-ink", key: "count.status.review" },
  write_off_requested: { icon: Clock, tone: "bg-info-subtle text-info-ink", key: "count.status.write_off_requested" },
  adjusted: { icon: CheckCircle2, tone: "bg-success-subtle text-success-ink", key: "count.status.adjusted" },
  closed: { icon: CheckCircle2, tone: "bg-success-subtle text-success-ink", key: "count.status.closed" },
};

export function CountStatusBadge({ status }: { status: CountStatus }) {
  const { icon: Icon, tone, key } = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold ${tone}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />{t(key)}
    </span>
  );
}

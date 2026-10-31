import { AlertTriangle, CheckCircle2, Clock, Hourglass, type LucideIcon } from "lucide-react";
import type { TaskStatus } from "@erp/api-contract";
import { t, type TextKey } from "../i18n";

/** Status is always icon + word + colour, never colour alone. */
const MAP: Record<TaskStatus, { icon: LucideIcon; tone: string; key: TextKey }> = {
  pending: { icon: Clock, tone: "bg-info-subtle text-info-ink", key: "status.pending" },
  overdue: { icon: AlertTriangle, tone: "bg-danger-subtle text-danger-ink", key: "status.overdue" },
  done: { icon: CheckCircle2, tone: "bg-success-subtle text-success-ink", key: "status.done" },
  blocked: { icon: Hourglass, tone: "bg-warning-subtle text-warning-ink", key: "status.blocked" },
};

export function StatusBadge({ status }: { status: TaskStatus }) {
  const { icon: Icon, tone, key } = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-sm font-semibold ${tone}`}>
      <Icon className="h-4 w-4" aria-hidden="true" />
      {t(key)}
    </span>
  );
}

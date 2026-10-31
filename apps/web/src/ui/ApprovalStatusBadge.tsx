import { CheckCircle2, Clock, XCircle, type LucideIcon } from "lucide-react";
import type { ApprovalStatus } from "@erp/api-contract";
import { t, type TextKey } from "../i18n";

/** Status is always icon + word + colour, never colour alone. */
const MAP: Record<ApprovalStatus, { icon: LucideIcon; tone: string; key: TextKey }> = {
  pending: { icon: Clock, tone: "bg-info-subtle text-info-ink", key: "approval.status.pending" },
  approved: { icon: CheckCircle2, tone: "bg-success-subtle text-success-ink", key: "approval.status.approved" },
  rejected: { icon: XCircle, tone: "bg-danger-subtle text-danger-ink", key: "approval.status.rejected" },
};

export function ApprovalStatusBadge({ status }: { status: ApprovalStatus }) {
  const { icon: Icon, tone, key } = MAP[status];
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold ${tone}`}>
      <Icon className="h-5 w-5" aria-hidden="true" />
      {t(key)}
    </span>
  );
}

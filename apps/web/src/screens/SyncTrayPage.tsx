import { RefreshCw } from "lucide-react";
import { SaleInput } from "@erp/api-contract";
import type { QueueItem } from "@erp/offline";
import { t } from "../i18n";
import { useSession } from "../state/session";
import { useSync } from "../state/sync";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { StatusBadge } from "../ui/StatusBadge";

export function SyncTrayPage() {
  const { caps } = useSession();
  const { queue, flushNow, retry, state } = useSync();
  const money = useMoney();
  const label = (i: QueueItem) => {
    if (i.type === "sale.create") {
      const s = SaleInput.safeParse(i.payload);
      return s.success ? t("tray.sale", { amount: money(s.data.total), method: s.data.payments.length === 1 ? t(`pay.${s.data.payments[0]!.method}`) : t("pay.split") }) : t("tray.sale.bad");
    }
    return t(`tray.${i.type}` as "tray.shift.open");
  };
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-3xl font-bold tracking-tight">{t("tray.title")}</h1>
        <Button variant="subtle" onClick={() => void flushNow()} disabled={state === "offline"}><RefreshCw className="h-5 w-5" aria-hidden="true" />{t("tray.retryAll")}</Button>
      </div>
      {queue.length === 0 && <p className="text-text-muted">{t("tray.empty")}</p>}
      <ul className="space-y-3">
        {queue.map((i) => {
          const mine = i.userId === caps?.user.id;
          return (
            <li key={i.id}>
              <Card className="flex flex-wrap items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="text-lg font-semibold">{label(i)}</p>
                  <p className="tabular text-text-muted">{new Date(i.createdAt).toLocaleString()} · {t("tray.attempts", { n: i.attempts })}</p>
                  {!mine && <p className="font-medium text-warning-ink">{t("tray.waitingFor", { name: i.userName ?? i.userId })}</p>}
                  {i.lastError && <p className="text-danger-ink">{i.lastError}</p>}
                </div>
                <StatusBadge status={i.status === "failed" ? "overdue" : "pending"} />
                {i.status === "failed" && mine && <Button variant="subtle" onClick={() => void retry(i.id)}>{t("tray.retry")}</Button>}
              </Card>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

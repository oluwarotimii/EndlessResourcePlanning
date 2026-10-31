import { AlertTriangle, CheckCircle2 } from "lucide-react";
import type { CodOutstanding } from "@erp/api-contract";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Money } from "../ui/Money";

/** L05. Delivery cash that riders collected and have not handed in, oldest first. Overdue is shown with an icon and a word. */
export function CodOutstandingPage() {
  const { api } = useSession();
  const { data, stale, failed, retry } = useCachedReport<CodOutstanding>("cod-outstanding", (tk) => api.codOutstanding(tk));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("deliv.out.title")}</h1>
        {data && <p className="text-text-muted">{t("deliv.out.subtitle", { hours: data.thresholdHours })}</p>}
        {data && <p className="tabular text-text-muted">{t(stale ? "report.saved" : "report.asOf", { time: new Date(data.asOf).toLocaleTimeString() })}</p>}
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {data?.riders.length === 0 && <p className="text-text-muted">{t("deliv.out.none")}</p>}
      {data && data.riders.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-border-strong text-text-muted">
              <th className="p-3 font-semibold">{t("deliv.out.rider")}</th><th className="p-3 text-right font-semibold">{t("deliv.out.orders")}</th>
              <th className="p-3 text-right font-semibold">{t("deliv.out.amount")}</th><th className="p-3 text-right font-semibold">{t("deliv.out.oldest")}</th><th className="p-3 font-semibold">{t("variance.status")}</th>
            </tr></thead>
            <tbody>
              {data.riders.map((r) => (
                <tr key={r.riderId} className="border-b border-border" data-testid={`cod-${r.riderId}`}>
                  <td className="p-3 font-semibold">{r.riderName}</td>
                  <td className="tabular p-3 text-right">{r.orders}</td>
                  <td className="p-3 text-right"><Money amount={r.amount} /></td>
                  <td className="tabular p-3 text-right">{r.hoursOutstanding}</td>
                  <td className="p-3">
                    {r.overdue
                      ? <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-danger-subtle px-3 py-1 font-semibold text-danger-ink"><AlertTriangle className="h-4 w-4" aria-hidden="true" />{t("deliv.out.overdue")}</span>
                      : <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-success-subtle px-3 py-1 font-semibold text-success-ink"><CheckCircle2 className="h-4 w-4" aria-hidden="true" />{t("deliv.out.ontime")}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

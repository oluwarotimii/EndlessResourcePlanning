import { AlertTriangle, CheckCircle2, TrendingUp } from "lucide-react";
import type { CashUpVarianceReport } from "@erp/api-contract";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/** G01. Cash-up variance by cashier. Short cash is flagged with an icon and a word, never colour alone. */
export function CashUpVarianceReportPage() {
  const { api } = useSession();
  const money = useMoney();
  const { data, stale, failed, retry } = useCachedReport<CashUpVarianceReport>("cashup-variance", (token) => api.cashUpVariance(token));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("variance.title")}</h1>
        <p className="text-text-muted">{t("variance.subtitle")}</p>
        {data && <p className="tabular text-text-muted">{t(stale ? "report.saved" : "report.asOf", { time: new Date(data.asOf).toLocaleTimeString() })}</p>}
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {!data && !failed && <p role="status" className="text-text-muted">{t("app.loading")}</p>}
      {data?.rows.length === 0 && <p className="text-text-muted">{t("variance.empty")}</p>}
      {data && data.rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left">
            <thead>
              <tr className="border-b border-border-strong text-text-muted">
                <th className="p-3 font-semibold">{t("variance.cashier")}</th>
                <th className="p-3 text-right font-semibold">{t("variance.shifts")}</th>
                <th className="p-3 text-right font-semibold">{t("variance.shortShifts")}</th>
                <th className="p-3 text-right font-semibold">{t("variance.largestShort")}</th>
                <th className="p-3 text-right font-semibold">{t("variance.total")}</th>
                <th className="p-3 font-semibold">{t("variance.status")}</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => {
                const state = r.totalVariance < 0 ? "short" : r.totalVariance > 0 ? "over" : "ok";
                const Icon = state === "short" ? AlertTriangle : state === "over" ? TrendingUp : CheckCircle2;
                const tone = state === "short" ? "bg-danger-subtle text-danger-ink" : state === "over" ? "bg-warning-subtle text-warning-ink" : "bg-success-subtle text-success-ink";
                return (
                  <tr key={r.cashierId} className="border-b border-border" data-testid={`variance-${r.cashierId}`}>
                    <td className="p-3 font-semibold">{r.cashierName}</td>
                    <td className="tabular p-3 text-right">{r.shifts}</td>
                    <td className="tabular p-3 text-right">{r.shortShifts}</td>
                    <td className="tabular p-3 text-right">{money(r.largestShort)}</td>
                    <td className="tabular p-3 text-right font-bold">{money(r.totalVariance)}</td>
                    <td className="p-3"><span className={`inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 font-semibold ${tone}`}><Icon className="h-4 w-4" aria-hidden="true" />{t(`variance.${state}`)}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

import { Clock } from "lucide-react";
import type { InTransitReport } from "@erp/api-contract";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";

/** G02. Transfers on the road longer than the alert time. Server-computed; opens offline from the last saved copy. */
export function InTransitReportPage() {
  const { api } = useSession();
  const { data, stale, failed, retry } = useCachedReport<InTransitReport>("in-transit", (token) => api.inTransitReport(token));
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("intransit.title")}</h1>
        {data && <p className="text-text-muted">{t("intransit.subtitle", { hours: data.thresholdHours })}</p>}
        {data && <p className="tabular text-text-muted">{t(stale ? "report.saved" : "report.asOf", { time: new Date(data.asOf).toLocaleTimeString() })}</p>}
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {!data && !failed && <p role="status" className="text-text-muted">{t("app.loading")}</p>}
      {data?.rows.length === 0 && <p className="text-text-muted">{t("intransit.empty")}</p>}
      {data && data.rows.length > 0 && (
        <Card className="overflow-x-auto">
          <table className="w-full text-left">
            <thead><tr className="border-b border-border-strong text-text-muted">
              <th className="p-3 font-semibold">{t("intransit.transfer")}</th><th className="p-3 font-semibold">{t("intransit.sentBy")}</th>
              <th className="p-3 font-semibold">{t("intransit.sentAt")}</th><th className="p-3 text-right font-semibold">{t("intransit.hours")}</th><th className="p-3 text-right font-semibold">{t("intransit.units")}</th>
            </tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.transferId} className="border-b border-border" data-testid={`late-${r.transferId}`}>
                  <td className="tabular p-3 font-semibold">{r.transferId}</td>
                  <td className="p-3">{r.dispatchedBy}</td>
                  <td className="tabular p-3">{new Date(r.dispatchedAt).toLocaleString()}</td>
                  <td className="p-3 text-right"><span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-danger-subtle px-3 py-1 font-semibold text-danger-ink tabular"><Clock className="h-4 w-4" aria-hidden="true" />{r.hoursInTransit}</span></td>
                  <td className="tabular p-3 text-right">{r.units}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  );
}

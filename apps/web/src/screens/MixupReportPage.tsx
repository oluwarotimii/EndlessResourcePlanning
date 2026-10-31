import { t } from "../i18n";
import { ago } from "../features/stock/time";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { useMoney } from "../state/tenant";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import type { MixupReport } from "@erp/api-contract";

/** G11. Sales fixed after a mix-up, by the cashier who made the sale, to coach staff and spot a pattern. */
export function MixupReportPage() {
  const { api } = useSession();
  const money = useMoney();
  const { data, failed, retry } = useCachedReport<MixupReport>("mixup-report", (tk) => api.mixupReport(tk));
  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("mixups.title")}</h1>
        <p className="text-text-muted">{t("mixups.subtitle")}</p>
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {data && data.rows.length === 0 && <p className="text-text-muted">{t("mixups.none")}</p>}
      <ul className="space-y-2">
        {data?.rows.map((r) => (
          <li key={r.cashier.id}>
            <Card className="flex flex-wrap items-center justify-between gap-2 p-4" data-testid={`mixup-row-${r.cashier.id}`}>
              <span className="text-lg font-bold">{r.cashier.name}</span>
              <span className="tabular">{t("mixups.row", { count: r.count, units: r.units, diff: money(r.netDifference) })}</span>
            </Card>
          </li>
        ))}
      </ul>
      {data && data.corrections.length > 0 && (
        <section aria-labelledby="recent-fixes" className="space-y-2">
          <h2 id="recent-fixes" className="text-xl font-bold">{t("mixups.recent")}</h2>
          <ul className="space-y-2">
            {data.corrections.slice(0, 10).map((c) => (
              <li key={c.id}><Card className="p-4"><p className="font-semibold">{c.invoiceNo}: {c.wrongName} → {c.rightName} × {c.qty}</p><p className="text-text-muted">{t("mixups.by", { name: c.fixedBy.name, ago: ago(c.fixedAt) })} · {c.note}</p></Card></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

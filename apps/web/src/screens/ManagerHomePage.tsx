import { ClipboardCheck, FileBarChart, Hourglass, Wallet } from "lucide-react";
import { Link } from "react-router-dom";
import type { BranchSummary } from "@erp/api-contract";
import { t } from "../i18n";
import { useCachedReport } from "../hooks/useCachedReport";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { Money } from "../ui/Money";

/** A02. Branch manager home: what needs a decision, and how the branch is doing. Read-only figures from the server. */
export function ManagerHomePage() {
  const { api } = useSession();
  const { data, stale, failed, retry } = useCachedReport<BranchSummary>("summary", (token) => api.summary(token));

  const tile = "btn-spring block rounded-2xl";
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t("manager.title")}</h1>
        {data && <p className="tabular text-text-muted">{t(stale ? "report.saved" : "report.asOf", { time: new Date(data.asOf).toLocaleTimeString() })}</p>}
      </div>
      {failed && !data && (
        <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
          <span className="font-medium">{t(failed === "forbidden" ? "report.forbidden" : "report.loadFailed")}</span>
          {failed !== "forbidden" && <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>}
        </div>
      )}
      {!data && !failed && <p role="status" className="text-text-muted">{t("app.loading")}</p>}

      {data && (
        <>
          <section aria-label={t("manager.decide")} className="grid gap-4 sm:grid-cols-2">
            <Link to="/s/A01" className={tile}>
              <Card lift className="flex items-center gap-4 p-5">
                <ClipboardCheck className="h-8 w-8 text-primary-ink" aria-hidden="true" />
                <div><p className="text-text-muted">{t("manager.approvals")}</p><p className="tabular text-3xl font-bold" data-testid="pending-approvals">{data.pendingApprovals}</p></div>
              </Card>
            </Link>
            <Link to="/s/Q02" className={tile}>
              <Card lift className="flex items-center gap-4 p-5">
                <Wallet className="h-8 w-8 text-primary-ink" aria-hidden="true" />
                <div><p className="text-text-muted">{t("manager.cashups")}</p><p className="tabular text-3xl font-bold" data-testid="cashups-awaiting">{data.cashUpsAwaiting}</p></div>
              </Card>
            </Link>
          </section>

          <section aria-label={t("manager.sales")} className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card className="p-5"><p className="text-text-muted">{t("manager.salesTotal")}</p><p className="text-2xl"><Money amount={data.salesTotal} /></p><p className="tabular text-text-muted">{t("manager.salesCount", { n: data.salesCount })}</p></Card>
            <Card className="p-5"><p className="text-text-muted">{t("manager.cash")}</p><p className="text-2xl"><Money amount={data.cashTotal} /></p></Card>
            <Card className="p-5"><p className="text-text-muted">{t("manager.credit")}</p><p className="text-2xl"><Money amount={data.creditTotal} /></p></Card>
            <Card className="p-5"><p className="text-text-muted">{t("manager.returns")}</p><p className="text-2xl"><Money amount={data.returnsTotal} /></p></Card>
            <Card className="p-5"><p className="text-text-muted">{t("manager.shortages")}</p><p className="text-2xl"><Money amount={data.shortagesCharged} /></p></Card>
            <Card className="flex items-center gap-3 p-5">
              <Hourglass className="h-7 w-7 text-text-muted" aria-hidden="true" />
              <div><p className="text-text-muted">{t("manager.openShifts")}</p><p className="tabular text-2xl font-bold">{data.openShifts}</p></div>
            </Card>
          </section>
          <Link to="/s/G01" className="btn-spring inline-flex min-h-touch items-center gap-2 rounded-xl border border-border bg-fill px-4 font-semibold hover:bg-fill-hover">
            <FileBarChart className="h-5 w-5" aria-hidden="true" />{t("manager.report")}
          </Link>
        </>
      )}
    </div>
  );
}

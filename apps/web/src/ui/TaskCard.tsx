import { ChevronRight } from "lucide-react";
import { Link } from "react-router-dom";
import type { Task } from "@erp/api-contract";
import { t } from "../i18n";
import { Card } from "./Card";
import { Money } from "./Money";
import { StatusBadge } from "./StatusBadge";

/** Approval-style card: who, what, the amount and the limit. */
export function TaskCard({ task }: { task: Task }) {
  return (
    <Link to={`/s/${task.screenId}`} className="block rounded-2xl">
      <Card lift className="flex items-center gap-4 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-lg font-semibold">{task.title}</h3>
            <StatusBadge status={task.status} />
          </div>
          {task.detail && <p className="text-text-muted">{task.detail}</p>}
          {task.requestedBy && <p className="text-text-muted">{t("home.requestedBy", { name: task.requestedBy })}</p>}
          {task.amount !== undefined && (
            <p className="mt-1 flex flex-wrap gap-x-6">
              <span><span className="text-text-muted">{t("home.amount")} </span><Money amount={task.amount} /></span>
              {task.limit !== undefined && (
                <span>
                  <span className="text-text-muted">{t("home.limit")} </span>
                  {task.limitUnit === "percent" ? <span className="tabular font-bold">{task.limit}%</span> : <Money amount={task.limit} />}
                </span>
              )}
            </p>
          )}
        </div>
        <ChevronRight className="h-6 w-6 shrink-0 text-text-muted" aria-label={t("home.open")} />
      </Card>
    </Link>
  );
}

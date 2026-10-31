import { CloudOff, RefreshCw, Wifi } from "lucide-react";
import { Link } from "react-router-dom";
import { t } from "../i18n";
import { useSync } from "../state/sync";

/** Persistent Online / Offline / Syncing bar with a pending count and a link to the sync tray. */
export function OnlineBar() {
  const { state, pending, failed, simulated, setSimulated } = useSync();
  const tone = { online: "bg-success-subtle text-success-ink", offline: "bg-warning-subtle text-warning-ink", syncing: "bg-info-subtle text-info-ink" }[state];
  const Icon = state === "offline" ? CloudOff : state === "syncing" ? RefreshCw : Wifi;
  return (
    <div className={`border-b border-border ${tone}`}>
      <div role="status" aria-live="polite" className="mx-auto flex min-h-touch max-w-7xl flex-wrap items-center gap-x-4 gap-y-1 px-4 py-1 sm:px-6">
        <span className="inline-flex items-center gap-2 font-semibold">
          <Icon className={`h-5 w-5 ${state === "syncing" ? "animate-spin" : ""}`} aria-hidden="true" />
          {t(`bar.${state}`)}
        </span>
        <span className="tabular">{pending > 0 ? t("bar.pending", { n: pending }) : t("bar.none")}</span>
        {failed > 0 && <span className="font-semibold text-danger-ink tabular">{t("bar.failed", { n: failed })}</span>}
        {state === "offline" && <span className="text-text-muted">{t("bar.offlineHint")}</span>}
        <span className="ml-auto flex gap-2">
          <Link to="/s/P03" className="btn-spring inline-flex min-h-touch items-center rounded-lg px-3 font-medium hover:bg-fill-hover">{t("bar.tray")}</Link>
          {import.meta.env.DEV && (
            <button className="btn-spring min-h-touch rounded-lg px-3 font-medium hover:bg-fill-hover" onClick={() => setSimulated(!simulated)}>
              {simulated ? t("bar.simulateOn") : t("bar.simulate")}
            </button>
          )}
        </span>
      </div>
    </div>
  );
}

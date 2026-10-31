import { ArrowLeft, Lock } from "lucide-react";
import { Suspense } from "react";
import { Link, useParams } from "react-router-dom";
import { SCREENS, isVisible } from "@erp/permissions";
import { t } from "../i18n";
import { useSession } from "../state/session";
import { useTenant } from "../state/tenant";
import { BUILT } from "../screens/registry";
import { Card } from "../ui/Card";

/** Placeholder for every registry screen. Each real screen replaces this in its own sprint. */
export function ScreenPage() {
  const { id } = useParams();
  const { caps } = useSession();
  const tenant = useTenant();
  const screen = SCREENS.find((s) => s.id === id);
  if (!screen || !caps) return <p>{t("screen.notFound")}</p>;

  const back = (
    <Link to="/" className="btn-spring inline-flex min-h-touch items-center gap-2 rounded-xl px-3 font-semibold text-primary-ink hover:bg-primary-subtle">
      <ArrowLeft className="h-5 w-5" aria-hidden="true" />{t("screen.back")}
    </Link>
  );
  // The server is the authority; this stops a guessed URL from rendering a screen the role should not see.
  if (!isVisible(screen, caps, tenant.enabledScopes)) {
    return (
      <div className="space-y-4">{back}
        <Card className="p-6">
          <Lock className="mb-3 h-8 w-8 text-text-muted" aria-hidden="true" />
          <h1 className="text-2xl font-bold">{t("screen.forbidden.title")}</h1>
          <p className="mt-1 text-text-muted">{t("screen.forbidden.body")}</p>
        </Card>
      </div>
    );
  }
  const Built = BUILT[screen.id];
  if (Built) {
    return (
      <div className="space-y-4">{back}
        <Suspense fallback={<p role="status" className="text-text-muted">{t("app.loading")}</p>}><Built /></Suspense>
      </div>
    );
  }
  const rows: Array<[string, string]> = [
    [t("screen.pattern"), screen.pattern], [t("screen.device"), screen.device], [t("screen.offline"), screen.offline],
    [t("screen.erp"), screen.erpnext], [t("screen.verdict"), screen.verdict],
  ];
  return (
    <div className="space-y-4">{back}
      <Card className="p-6">
        <p className="font-semibold text-primary-ink">{screen.id} · {screen.area}</p>
        <h1 className="mt-1 text-3xl font-bold tracking-tight">{screen.title}</h1>
        <p className="mt-1 text-text-muted">{t("screen.plannedFor", { sprint: screen.sprint })}</p>
        <dl className="mt-6 grid gap-3 sm:grid-cols-2">
          {rows.map(([k, v]) => (
            <div key={k} className="rounded-xl bg-fill p-3"><dt className="text-text-muted">{k}</dt><dd className="font-semibold">{v}</dd></div>
          ))}
        </dl>
        <p className="mt-6 text-text-muted">{t("screen.placeholder")}</p>
      </Card>
    </div>
  );
}

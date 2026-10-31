import { Link, useParams } from "react-router-dom";
import { t } from "../i18n";
import { useSession } from "../state/session";
import { Card } from "../ui/Card";
import { destinationTitle } from "./HomePage";

export function DestinationPage() {
  const { key } = useParams();
  const { nav } = useSession();
  const dest = nav?.destinations.find((d) => d.key === key);
  if (!dest) return <p>{t("screen.notFound")}</p>;
  return (
    <div className="space-y-4">
      <h1 className="text-3xl font-bold tracking-tight">{destinationTitle(dest.key)}</h1>
      <div className="grid gap-3 md:grid-cols-2">
        {dest.screens.map((s) => (
          <Link key={s.id} to={`/s/${s.id}`} className="block rounded-2xl">
            <Card lift className="min-h-touch p-4">
              <h2 className="text-lg font-semibold">{s.title}</h2>
              <p className="text-text-muted">{s.pattern} · {s.device}</p>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}

import { Link } from "react-router-dom";
import { t, type TextKey } from "../i18n";
import { useTasks } from "../hooks/useTasks";
import { useSession } from "../state/session";
import { Button } from "../ui/Button";
import { Card } from "../ui/Card";
import { TaskCard } from "../ui/TaskCard";

/** Role home = a task queue. Task roles (cashier, rider) get large tiles and no menu. */
export function HomePage() {
  const { caps, nav } = useSession();
  const { tasks, error, retry } = useTasks();
  if (!caps || !nav) return null;
  const tileScreens = nav.workspace === "tasks" ? nav.destinations.flatMap((d) => d.screens) : [];

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold tracking-tight">{t("home.greeting", { name: caps.user.name.split(" ")[0] ?? caps.user.name })}</h1>

      <section aria-labelledby="tasks-h" className="space-y-3">
        <h2 id="tasks-h" className="text-xl font-bold">{t("home.tasks")}</h2>
        {error && (
          <div role="alert" className="flex flex-wrap items-center gap-3 rounded-xl bg-danger-subtle p-4 text-danger-ink">
            <span className="font-medium">{t(error === "unavailable" ? "error.unavailable" : "home.loadFailed")}</span>
            <Button variant="subtle" onClick={retry}>{t("login.retry")}</Button>
          </div>
        )}
        {!tasks && !error && <p role="status" className="text-text-muted">{t("app.loading")}</p>}
        {tasks?.length === 0 && <p className="text-text-muted">{t("home.noTasks")}</p>}
        <div className="grid gap-3 lg:grid-cols-2">{tasks?.map((task) => <TaskCard key={task.id} task={task} />)}</div>
      </section>

      {tileScreens.length > 0 && (
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {tileScreens.map((s) => (
            <Link key={s.id} to={`/s/${s.id}`} className="btn-spring block rounded-2xl">
              <Card lift className="flex min-h-till items-center p-4 text-lg font-semibold">{s.title}</Card>
            </Link>
          ))}
        </section>
      )}

      {nav.utilities.length > 0 && (
        <section aria-labelledby="util-h" className="space-y-2">
          <h2 id="util-h" className="text-xl font-bold">{t("home.utilities")}</h2>
          <div className="flex flex-wrap gap-2">
            {nav.utilities.filter((u) => u.id !== "P02" && u.id !== "P01").map((u) => (
              <Link key={u.id} to={`/s/${u.id}`} className="btn-spring inline-flex min-h-touch items-center rounded-xl border border-border bg-fill px-4 font-medium hover:bg-fill-hover">{u.title}</Link>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

export const destinationTitle = (key: string) => t(`dest.${key}` as TextKey);

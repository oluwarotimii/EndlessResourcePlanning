import { Moon, Palette, Sun, LogOut, Layers } from "lucide-react";
import { NavLink, Outlet, Navigate, Link } from "react-router-dom";
import { t, type TextKey } from "../i18n";
import { useSession } from "../state/session";
import { useTenant } from "../state/tenant";
import { useTheme } from "../state/theme";
import { OnlineBar } from "./OnlineBar";

export function Shell() {
  const { status, caps, nav, signOut } = useSession();
  const tenant = useTenant();
  const { mode, toggleMode, theme, themes, setTheme } = useTheme();
  if (status === "restoring") return <p className="p-6" role="status">{t("app.loading")}</p>;
  if (status === "signedOut" || !caps || !nav) return <Navigate to="/login" replace />;

  const iconBtn = "btn-spring inline-flex whitespace-nowrap h-touch w-touch items-center justify-center rounded-xl border border-border bg-fill hover:bg-fill-hover";
  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:p-3">{t("shell.skip")}</a>
      <header className="glass-panel sticky top-0 z-40 border-b">
        <div className="mx-auto flex min-h-[4rem] max-w-7xl items-center justify-between gap-3 px-4 sm:px-6">
          <Link to="/" className="flex items-center gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-primary to-secondary text-primary-text shadow-card">
              <Layers className="h-5 w-5" aria-hidden="true" />
            </span>
            <span className="leading-tight">
              <span className="block text-lg font-bold tracking-tight">{tenant.brand.name}<span className="font-normal text-text-muted">{tenant.brand.suffix}</span></span>
              <span className="hidden text-text-muted sm:block">{caps.scope.branch ?? tenant.branch.name}</span>
            </span>
          </Link>

          {nav.workspace === "menu" && (
            <nav aria-label={t("shell.nav")} className="hidden items-center gap-1 rounded-xl border border-border bg-fill p-1 md:flex">
              {nav.destinations.map((d) => (
                <NavLink
                  key={d.key}
                  to={`/d/${d.key}`}
                  className={({ isActive }) => `btn-spring inline-flex min-h-touch items-center rounded-lg px-4 font-semibold ${isActive ? "bg-surface-raised text-text shadow-card" : "text-text-muted hover:text-text"}`}
                >
                  {t(`dest.${d.key}` as TextKey)}
                </NavLink>
              ))}
            </nav>
          )}

          <div className="flex items-center gap-2">
            <label className="relative hidden sm:block">
              <span className="sr-only">{t("shell.theme")}</span>
              <Palette className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-text-muted" aria-hidden="true" />
              <select value={theme} onChange={(e) => setTheme(e.target.value)} className="btn-spring min-h-touch rounded-xl border border-border bg-fill pl-10 pr-3 font-medium text-text">
                {themes.map((x) => <option key={x} value={x}>{x}</option>)}
              </select>
            </label>
            <button className={iconBtn} onClick={toggleMode} aria-label={t(mode === "light" ? "shell.mode.light" : "shell.mode.dark")}>
              {mode === "light" ? <Moon className="h-5 w-5" aria-hidden="true" /> : <Sun className="h-5 w-5" aria-hidden="true" />}
            </button>
            <button className={`${iconBtn} w-auto gap-2 px-4 font-semibold`} onClick={() => signOut()}>
              <LogOut className="h-5 w-5" aria-hidden="true" />
              <span className="hidden sm:inline">{t("shell.signOut")}</span>
            </button>
          </div>
        </div>
        <OnlineBar />
      </header>

      <main id="main" className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 pb-28 sm:px-6 md:pb-6"><Outlet /></main>

      {nav.workspace === "menu" && nav.destinations.length > 0 && (
        <nav aria-label={t("shell.nav")} className="glass-panel fixed inset-x-0 bottom-0 z-40 flex border-t md:hidden">
          {nav.destinations.map((d) => (
            <NavLink
              key={d.key}
              to={`/d/${d.key}`}
              className={({ isActive }) => `btn-spring flex min-h-[3.5rem] flex-1 items-center justify-center px-1 text-center font-semibold ${isActive ? "text-primary-ink" : "text-text-muted"}`}
            >
              {t(`dest.${d.key}` as TextKey)}
            </NavLink>
          ))}
        </nav>
      )}
    </div>
  );
}
